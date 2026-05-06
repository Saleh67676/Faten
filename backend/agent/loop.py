"""
================================================================
UQU AGENT — Agentic Loop with Reasoning Support
================================================================
Iterative tool-calling loop on top of NVIDIA NIM (kimi-k2-instruct).

Robust error handling:
  • Network / API errors are logged with full detail (status code,
    response body, retry attempt).
  • If the first call fails, we retry once WITHOUT tools so the user
    still gets a response instead of a generic "engine struggling"
    message.
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


def get_openai_client() -> AsyncOpenAI:
    """Create an async OpenAI client pointing to NVIDIA NIM."""
    settings = get_settings()
    return AsyncOpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=settings.NVIDIA_API_KEY,
    )


async def _call_model(client, model_name, messages, with_tools: bool):
    """Single completion call. Logs the exact error on failure."""
    try:
        kwargs = dict(
            model=model_name,
            messages=messages,
            temperature=0.6,
            top_p=0.9,
            max_tokens=8192,
        )
        if with_tools:
            kwargs["tools"] = TOOLS_SCHEMA
            kwargs["tool_choice"] = "auto"
        return await client.chat.completions.create(**kwargs)
    except APIStatusError as e:
        logger.error(
            "[AGENT] NVIDIA returned HTTP %s — body=%s",
            e.status_code, getattr(e, "response", None) and e.response.text[:500],
        )
        raise
    except APIConnectionError as e:
        logger.error("[AGENT] NVIDIA connection error: %s", e)
        raise
    except APITimeoutError as e:
        logger.error("[AGENT] NVIDIA request timed out: %s", e)
        raise
    except APIError as e:
        logger.error("[AGENT] NVIDIA API error: %s", e)
        raise


async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    db
) -> dict:
    """Run the agentic loop with tool calling.

    Returns dict { content, actions_log, reasoning }.
    Caller should treat exceptions as fatal — the chat router catches
    them and returns a user-friendly message.
    """
    settings = get_settings()
    client = get_openai_client()
    all_messages = list(messages)  # shallow copy
    actions_log: list[dict] = []
    model_name = settings.NVIDIA_MODEL

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
            return {
                "content": message.content or "",
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
