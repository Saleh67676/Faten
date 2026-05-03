"""
================================================================
UQU Academic Assistant — Profile Router
================================================================
Converts: exports.syncProfile from index.js lines 236-276
Dual routes:
  POST /syncProfile         ← Legacy (frontend uses this)
  POST /api/sync-profile    ← New FastAPI convention
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from schemas.profile import ProfilePayload, ProfileResponse
from auth.dependencies import get_current_user
from db.firestore import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Profile"])


async def _sync_profile_logic(payload: ProfilePayload, user_id: str):
    """Core logic shared by both route aliases."""
    try:
        db = get_db()
        user_ref = db.collection("users").document(user_id)

        update = {
            "profile": {
                "name":        (payload.basic.name if payload.basic else None) or payload.name or "",
                "university":  (payload.basic.university if payload.basic else None) or payload.university or "",
                "major":       (payload.basic.major if payload.basic else None) or payload.major or "",
                "level":       (payload.basic.level if payload.basic else None) or payload.level or "",
                "currentGpa":  payload.goals.currentGpa if payload.goals else None,
                "targetGpa":   payload.goals.targetGpa if payload.goals else None,
                "earnedHours": payload.goals.earnedHours if payload.goals else None,
                "courses":     payload.courses or [],
            },
            "study_preferences": {
                "best_time":    payload.learning.bestTime if payload.learning else "",
                "study_hours":  payload.learning.studyHours if payload.learning else 0,
                "method":       payload.learning.studyStyle if payload.learning else "",
                "focus_length": payload.learning.focusLength if payload.learning else 25,
            },
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

        user_ref.set(update, merge=True)
        return ProfileResponse(success=True)

    except Exception as err:
        logger.error(f"[syncProfile] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))


# ── Legacy route (frontend calls this) ──
@router.post("/syncProfile", response_model=ProfileResponse)
async def sync_profile_legacy(
    payload: ProfilePayload,
    user_id: str = Depends(get_current_user),
):
    return await _sync_profile_logic(payload, user_id)


# ── New route (FastAPI convention) ──
@router.post("/api/sync-profile", response_model=ProfileResponse)
async def sync_profile(
    payload: ProfilePayload,
    user_id: str = Depends(get_current_user),
):
    return await _sync_profile_logic(payload, user_id)

