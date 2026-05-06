"""
================================================================
UQU AGENT — Agentic Loop with Reasoning Support
================================================================
Iterative tool-calling loop on top of OpenAI ChatGPT.

Robust error handling:
  • Network / API errors are logged with full detail (status code,
    response body, retry attempt).
  • If the first call fails, we retry once WITHOUT tools so the user
    still gets a response instead of a generic "engine struggling"
    message.
  • If kimi returns a deflection/apology without calling any tools,
    we automatically fall back to Gemini for a plain-text answer.
  • Tool-call argument JSON failures don't crash the loop.
"""

import json
import logging
from openai import AsyncOpenAI, APIError, APIStatusError, APIConnectionError, APITimeoutError

from config import get_settings
from agent.tools_schema import TOOLS_SCHEMA
from agent.tools_executor import execute_tool

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 6

# ── Patterns that indicate kimi deflected rather than actually helping ──
# We detect these on the first iteration only (before any tools were called)
# and trigger a Gemini fallback automatically.
_DEFLECTION_PATTERNS = [
    "يواجه ضغطاً",
    "المحرك الذكي يواجه",
    "واجه المحرك",
    "خارج قدراتي",
    "لا أستطيع الوصول",
    "لا أملك صلاحية",
    "غير قادر على الوصول",
    "لا يمكنني الوصول إلى البيانات",
    "لا أستطيع تنفيذ",
    "لا أستطيع مساعدتك",
    "I cannot access",
    "I don't have access",
    "I'm unable to",
]


def _is_deflection(text: str, actions_were_taken: bool) -> bool:
    """
    Return True when the model responded with an apology/deflection
    and did NOT execute any tools (i.e. nothing useful happened).
    """
    if not text or actions_were_taken:
        return False
    t = text.strip()
    return any(p in t for p in _DEFLECTION_PATTERNS)


def get_openai_client() -> AsyncOpenAI:
    """Create an AsyncOpenAI client using the project OpenAI key."""
    settings = get_settings()
    if not settings.OPENAI_API_KEY.strip():
        raise RuntimeError("OPENAI_API_KEY must be set in backend/.env")
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


async def _call_model(client, model_name, messages, with_tools: bool):
    """Single completion call. Logs the exact error on failure."""
    settings = get_settings()
    try:
        kwargs = dict(
            model=model_name,
            messages=messages,
            temperature=settings.TEMPERATURE,
            top_p=0.9,
            max_tokens=settings.MAX_TOKENS,
        )
        if with_tools:
            kwargs["tools"] = TOOLS_SCHEMA
            kwargs["tool_choice"] = "auto"
        
        # Log request details
        total_chars = sum(len(str(m.get("content", ""))) for m in messages)
        logger.info(
            "[AGENT] Calling model=%s max_tokens=%d messages=%d total_chars≈%d",
            model_name, settings.MAX_TOKENS, len(messages), total_chars
        )
        
        return await client.chat.completions.create(**kwargs)
    except APIStatusError as e:
        # Handle max_tokens too large error
        if "max_tokens" in str(e).lower() and "too large" in str(e).lower():
            logger.warning("[AGENT] max_tokens too large, reducing to 300")
            kwargs["max_tokens"] = 300
            return await client.chat.completions.create(**kwargs)
        logger.error(
            "[AGENT] OpenAI returned HTTP %s — body=%s",
            e.status_code, getattr(e, "response", None) and e.response.text[:500],
        )
        raise
    except APIConnectionError as e:
        logger.error("[AGENT] OpenAI connection error: %s", e)
        raise
    except APITimeoutError as e:
        logger.error("[AGENT] OpenAI request timed out: %s", e)
        raise
    except APIError as e:
        logger.error("[AGENT] OpenAI API error: %s", e)
        raise


async def _gemini_fallback(messages: list[dict], system_prompt: str) -> str | None:
    """
    Call Gemini as a plain-text fallback.
    Imported lazily to avoid circular imports and keep startup fast.
    """
    try:
        from services.gemini import call_gemini_chat_text
        # Only pass last 6 messages to Gemini to stay within limits
        recent = [m for m in messages if m.get("role") in ("user", "assistant")][-6:]
        result = await call_gemini_chat_text(
            messages=recent,
            system_prompt=system_prompt,
            temperature=0.7,
        )
        if result:
            logger.info("[AGENT] Gemini fallback succeeded (%d chars)", len(result))
        return result
    except Exception as exc:
        logger.error("[AGENT] Gemini fallback error: %s", exc)
        return None


async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    db,
    client: AsyncOpenAI | None = None,
) -> dict:
    """Run the agentic loop with tool calling.

    `client` should be the long-lived AsyncOpenAI instance from app.state
    (passed in by the chat router). If omitted, a fresh client is created
    per-call — safe but slightly less efficient.

    Returns dict { content, actions_log, reasoning }.
    Caller should treat exceptions as fatal — the chat router catches
    them and returns a user-friendly message.
    """
    settings = get_settings()
    if client is None:
        client = get_openai_client()
    all_messages = list(messages)  # shallow copy
    actions_log: list[dict] = []
    model_name = settings.get_chat_model()

    # Extract the system prompt for the Gemini fallback (first message if role=system)
    system_prompt_for_fallback = ""
    for m in messages:
        if m.get("role") == "system":
            system_prompt_for_fallback = m.get("content", "")
            break

    logger.info(
        "[AGENT] Starting loop — model=%s msgs=%d user=%s",
        model_name, len(all_messages), user_id,
    )

    for i in range(MAX_ITERATIONS):
        # ── Call the model ──
        try:
            completion = await _call_model(client, model_name, all_messages, with_tools=True)
        except Exception as first_err:
            # Retry once without tools — kimi can choke on the tools schema
            # in some NIM regions, but plain chat usually works fine.
            logger.warning("[AGENT] First call failed (%s) — retrying without tools", type(first_err).__name__)
            try:
                completion = await _call_model(client, model_name, all_messages, with_tools=False)
            except Exception as second_err:
                logger.error("[AGENT] Retry without tools also failed: %s", second_err)
                # Both kimi calls failed — try Gemini as last resort
                fallback = await _gemini_fallback(all_messages, system_prompt_for_fallback)
                if fallback:
                    return {"content": fallback, "actions_log": [], "reasoning": None}
                raise

        choice = completion.choices[0]
        message = choice.message

        logger.info(
            "[AGENT] iter=%d finish=%s tool_calls=%d content_len=%d",
            i, choice.finish_reason,
            len(message.tool_calls) if message.tool_calls else 0,
            len(message.content or ""),
        )

        # ── Preserve assistant turn for next iteration ──
        assistant_message = {
            "role": "assistant",
            "content": message.content or "",
        }
        if message.tool_calls:
            assistant_message["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in message.tool_calls
            ]
        all_messages.append(assistant_message)

        # ── If the model finished without requesting tools ──
        if choice.finish_reason != "tool_calls" or not message.tool_calls:
            content = message.content or ""

            # ── Deflection detection (first iteration, no tools called yet) ──
            if i == 0 and _is_deflection(content, actions_were_taken=bool(actions_log)):
                logger.warning(
                    "[AGENT] kimi deflection detected on iter 0 — trying Gemini fallback. "
                    "Deflected text: %s",
                    content[:120],
                )
                fallback = await _gemini_fallback(all_messages, system_prompt_for_fallback)
                if fallback:
                    return {"content": fallback, "actions_log": [], "reasoning": None}
                # If Gemini also fails, return kimi's deflection rather than nothing
                logger.warning("[AGENT] Gemini fallback also returned nothing — returning kimi text")

            return {
                "content": content,
                "actions_log": actions_log,
                "reasoning": None,
            }

        # ── Execute requested tools ──
        for tool_call in message.tool_calls:
            tool_name = tool_call.function.name
            args: dict = {}
            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError as je:
                logger.warning("[AGENT] tool %s had invalid JSON args: %s", tool_name, je)

            try:
                result = await execute_tool(tool_name, args, user_id, db)
            except Exception as tool_err:
                logger.error("[AGENT] tool %s execution error: %s", tool_name, tool_err)
                result = {"success": False, "error": str(tool_err)}

            actions_log.append({
                "tool": tool_name,
                "args": args,
                "result": result,
            })

            all_messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    # If we exhausted iterations, return whatever the last assistant message held.
    last_assistant_text = ""
    for m in reversed(all_messages):
        if m.get("role") == "assistant" and m.get("content"):
            last_assistant_text = m["content"]
            break
    logger.warning("[AGENT] Hit MAX_ITERATIONS=%d — returning last assistant turn", MAX_ITERATIONS)
    return {
        "content": last_assistant_text or "تم استنفاد عدد محاولات المحرك. حاول إعادة صياغة طلبك بشكل أبسط.",
        "actions_log": actions_log,
        "reasoning": None,
    }
