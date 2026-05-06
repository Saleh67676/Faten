"""
================================================================
UQU Academic Assistant — Gemini API Service
================================================================
Centralized async client for Google Gemini.
Used by routers/plan_generator.py and routers/schedule_ai.py
to keep the API key off the client browser.

1:1 port of the Gemini call pattern previously duplicated in:
  - assets/ai-service.js
  - assets/plan-generator.js
"""

import json
import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from config import get_settings

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


async def call_gemini_chat_text(
    messages: list[dict],
    system_prompt: str,
    temperature: float = 0.7,
    timeout_seconds: float = 45.0,
) -> str | None:
    """
    Plain-text Gemini chat call (multi-turn).
    Used as fallback when the primary OpenAI model deflects or fails.

    Args:
        messages: List of {role, content} — same shape as OpenAI messages.
                  Roles must be 'user' or 'assistant'.
        system_prompt: System instruction (injected as systemInstruction).
        temperature: Generation temperature (default 0.7).
        timeout_seconds: Request timeout.

    Returns:
        The model's plain-text reply, or None if the call fails.
    """
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        logger.warning("[Gemini fallback] GEMINI_API_KEY not set — skipping")
        return None

    # Convert OpenAI-style messages → Gemini contents array
    contents: list[dict] = []
    for m in messages:
        role = m.get("role", "user")
        if role == "system":
            continue  # system handled via systemInstruction
        gemini_role = "model" if role == "assistant" else "user"
        text = m.get("content", "")
        if not text:
            continue
        # Merge consecutive same-role turns (Gemini requires alternating)
        if contents and contents[-1]["role"] == gemini_role:
            contents[-1]["parts"][0]["text"] += "\n" + text
        else:
            contents.append({"role": gemini_role, "parts": [{"text": text}]})

    if not contents:
        return None

    url = (
        f"{GEMINI_BASE}/{settings.GEMINI_MODEL}:generateContent"
        f"?key={settings.GEMINI_API_KEY}"
    )
    payload = {
        "contents": contents,
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {"temperature": temperature},
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            resp = await client.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload,
            )
    except httpx.RequestError as exc:
        logger.error("[Gemini fallback] Request error: %s", exc)
        return None

    if resp.status_code != 200:
        logger.error(
            "[Gemini fallback] HTTP %s — body=%s",
            resp.status_code,
            resp.text[:300],
        )
        return None

    try:
        data = resp.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [])
        )
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except Exception as exc:
        logger.error("[Gemini fallback] Parse error: %s", exc)
        return None


def _clean_json_text(text: str) -> str:
    """Robust JSON extraction:
    1. Strip leading/trailing whitespace
    2. Strip surrounding markdown fences (```json ... ``` or ``` ... ```)
    3. If the model added prose around the JSON, slice from first { or [ to
       the matching last } or ] (whichever brackets the structure uses).
    """
    text = text.strip()
    if text.startswith("```json"):
        text = text[len("```json"):].strip()
    elif text.startswith("```"):
        text = text[len("```"):].strip()
    if text.endswith("```"):
        text = text[: -len("```")].strip()

    # If there's prose wrapping a JSON object/array, extract just the JSON.
    if text and text[0] not in "{[":
        # Find the first { or [ and slice from there.
        first_brace = text.find("{")
        first_bracket = text.find("[")
        candidates = [c for c in (first_brace, first_bracket) if c != -1]
        if candidates:
            start = min(candidates)
            opener = text[start]
            closer = "}" if opener == "{" else "]"
            end = text.rfind(closer)
            if end > start:
                text = text[start : end + 1]
    return text


async def call_gemini(
    system_prompt: str,
    user_content: str,
    temperature: float,
    response_mime_type: str | None = None,
    timeout_seconds: float = 60.0,
) -> Any:
    """Call Gemini generateContent and return the parsed JSON payload.

    Mirrors the request shape used in assets/ai-service.js and
    assets/plan-generator.js exactly:
      - contents: [{ role: "user", parts: [{ text: user_content }] }]
      - systemInstruction: { parts: [{ text: system_prompt }] }
      - generationConfig: { temperature, [responseMimeType] }

    Returns the parsed JSON object/array — the caller decides what to do with it.
    Raises HTTPException(502) on Gemini errors and HTTPException(500) on
    invalid JSON (matches user-facing error messages from the JS).
    """
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY غير مُعرّف في إعدادات الخادم",
        )

    url = f"{GEMINI_BASE}/{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"

    generation_config: dict[str, Any] = {"temperature": temperature}
    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type

    payload = {
        "contents": [{"role": "user", "parts": [{"text": user_content}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": generation_config,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload,
            )
    except httpx.RequestError as e:
        logger.error(f"Gemini request failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="فشل الاتصال بالمحرك الذكي.",
        )

    if response.status_code != 200:
        try:
            err_body = response.json()
            err_msg = err_body.get("error", {}).get("message") or f"HTTP {response.status_code} failed"
        except Exception:
            err_msg = f"HTTP {response.status_code} failed"
        logger.error(f"Gemini API error: {err_msg}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=err_msg,
        )

    data = response.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="لم يقم نموذج الذكاء الاصطناعي بالرد.",
        )

    parts = candidates[0].get("content", {}).get("parts") or []
    text_content = "".join(p.get("text", "") for p in parts)

    text_content = _clean_json_text(text_content)

    try:
        return json.loads(text_content)
    except json.JSONDecodeError as e:
        logger.error(f"Gemini returned invalid JSON: {e} | raw={text_content[:500]}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل تحليل الهيكل المسترجع من الذكاء الاصطناعي (Invalid JSON).",
        )
