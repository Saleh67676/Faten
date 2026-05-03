"""
================================================================
UQU AGENT — Agentic Loop with Reasoning Support
================================================================
Converts: runAgentLoop() from index.js lines 95-159
Handles iterative tool calling with NVIDIA kimi-k2.5.
"""

import json
import logging
from openai import AsyncOpenAI

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


async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    db
) -> dict:
    """Run the agentic loop with tool calling and reasoning.

    Mirrors: runAgentLoop() from index.js lines 95-159

    Args:
        messages: Full message list including system prompt
        user_id: Firebase user ID
        db: Firestore client

    Returns:
        dict with keys: content, actions_log, reasoning
    """
    settings = get_settings()
    client = get_openai_client()
    all_messages = list(messages)  # shallow copy
    actions_log = []

    for i in range(MAX_ITERATIONS):
        # ── Call the model ──
        completion = await client.chat.completions.create(
            model=settings.NVIDIA_MODEL,
            messages=all_messages,
            tools=TOOLS_SCHEMA,
            tool_choice="auto",
            temperature=1.00,
            top_p=1.00,
            max_tokens=16384,
            extra_body={
                "chat_template_kwargs": {"thinking": True}
            },
        )

        choice = completion.choices[0]
        message = choice.message

        # ── Preserve reasoning details for next iteration ──
        assistant_message = {
            "role": "assistant",
            "content": message.content or "",
        }

        # Add tool_calls if present
        if message.tool_calls:
            assistant_message["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    }
                }
                for tc in message.tool_calls
            ]

        all_messages.append(assistant_message)

        # ── If the model finished without requesting tools ──
        if choice.finish_reason != "tool_calls" or not message.tool_calls:
            # Extract reasoning if available
            reasoning = None
            if hasattr(message, "reasoning_details"):
                reasoning = message.reasoning_details

            return {
                "content": message.content or "",
                "actions_log": actions_log,
                "reasoning": reasoning,
            }

        # ── Execute requested tools ──
        for tool_call in message.tool_calls:
            try:
                args = json.loads(tool_call.function.arguments)
                result = await execute_tool(
                    tool_call.function.name, args, user_id, db
                )
            except Exception as err:
                logger.error(f"Tool execution error: {err}")
                result = {"success": False, "error": str(err)}

            actions_log.append({
                "tool": tool_call.function.name,
                "args": args if 'args' in dir() else {},
                "result": result,
            })

            all_messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    raise RuntimeError("Agent loop exceeded maximum iterations")
