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


def _clean_json_text(text: str) -> str:
    """Strip markdown ```json fences if present (mirrors ai-service.js cleanup)."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[len("```json"):].strip()
        if text.endswith("```"):
            text = text[: -len("```")].strip()
    elif text.startswith("```"):
        text = text[len("```"):].strip()
        if text.endswith("```"):
            text = text[: -len("```")].strip()
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
