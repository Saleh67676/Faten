"""
================================================================
UQU Academic Assistant — Transcript Router
================================================================
Converts: exports.syncTranscript from index.js lines 281-337
Dual routes:
  POST /syncTranscript      ← Legacy (frontend)
  POST /api/sync-transcript ← New FastAPI convention
"""

import json
import re
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from schemas.transcript import TranscriptPayload, TranscriptResponse
from auth.dependencies import get_current_user
from db.firestore import get_db
from agent.loop import get_openai_client
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Transcript"])


async def _sync_transcript_logic(payload: TranscriptPayload, user_id: str):
    """Core logic shared by both route aliases."""
    try:
        db = get_db()
        settings = get_settings()
        user_ref = db.collection("users").document(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        # ── Save transcript ──
        courses_dicts = [c.model_dump() for c in payload.courses]
        user_ref.collection("transcripts").add({
            "courses":    courses_dicts,
            "cgpa":       payload.cgpa,
            "totalHours": payload.totalHours,
            "createdAt":  now_iso,
        })

        # ── Trigger AI analysis ──
        client = get_openai_client()
        courses_sample = courses_dicts[:30]

        analysis_completion = await client.chat.completions.create(
            model=settings.NVIDIA_MODEL,
            messages=[{
                "role": "user",
                "content": (
                    "حلّل هذا السجل الأكاديمي واستخرج نقاط الضعف (مواد أقل من 3.0) "
                    "ونقاط القوة (مواد 4.5 وما فوق) والتوصيات. السجل:\n"
                    f"{json.dumps(courses_sample, ensure_ascii=False)}\n"
                    'أجب بـ JSON فقط: {"weaknesses":[], "strengths":[], "recommendations":[], "summary":""}'
                ),
            }],
            temperature=1.00,
            top_p=1.00,
            max_tokens=2048,
            extra_body={"chat_template_kwargs": {"thinking": True}},
        )

        # ── Parse AI analysis ──
        analysis_data = {}
        try:
            raw = analysis_completion.choices[0].message.content or ""
            match = re.search(r"\{[\s\S]*\}", raw)
            if match:
                analysis_data = json.loads(match.group(0))
        except (json.JSONDecodeError, IndexError):
            pass

        # ── Save analysis to Firestore ──
        user_ref.update({
            "analysis.weaknesses":      analysis_data.get("weaknesses", []),
            "analysis.strengths":       analysis_data.get("strengths", []),
            "analysis.recommendations": analysis_data.get("recommendations", []),
            "analysis.summary":         analysis_data.get("summary", ""),
            "analysis.updatedAt":       now_iso,
        })

        return TranscriptResponse(success=True, analysis=analysis_data)

    except Exception as err:
        logger.error(f"[syncTranscript] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))


# ── Legacy route ──
@router.post("/syncTranscript", response_model=TranscriptResponse)
async def sync_transcript_legacy(
    payload: TranscriptPayload,
    user_id: str = Depends(get_current_user),
):
    return await _sync_transcript_logic(payload, user_id)


# ── New route ──
@router.post("/api/sync-transcript", response_model=TranscriptResponse)
async def sync_transcript(
    payload: TranscriptPayload,
    user_id: str = Depends(get_current_user),
):
    return await _sync_transcript_logic(payload, user_id)

