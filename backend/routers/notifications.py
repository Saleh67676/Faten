"""
================================================================
UQU Academic Assistant — Notifications Router
================================================================
Converts: exports.markNotificationRead from index.js lines 429-446
Dual routes:
  POST /markNotificationRead       ← Legacy (frontend)
  POST /api/mark-notification-read ← New FastAPI convention
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from schemas.transcript import NotificationReadRequest
from auth.dependencies import get_current_user
from db.firestore import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Notifications"])


async def _mark_notification_read_logic(request: NotificationReadRequest, user_id: str):
    """Core logic shared by both route aliases."""
    try:
        db = get_db()
        now_iso = datetime.now(timezone.utc).isoformat()

        db.collection("users").document(user_id) \
            .collection("notifications").document(request.notificationId) \
            .update({
                "read": True,
                "readAt": now_iso,
            })

        return {"success": True}

    except Exception as err:
        logger.error(f"[markNotificationRead] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))


# ── Legacy route ──
@router.post("/markNotificationRead")
async def mark_notification_read_legacy(
    request: NotificationReadRequest,
    user_id: str = Depends(get_current_user),
):
    return await _mark_notification_read_logic(request, user_id)


# ── New route ──
@router.post("/api/mark-notification-read")
async def mark_notification_read(
    request: NotificationReadRequest,
    user_id: str = Depends(get_current_user),
):
    return await _mark_notification_read_logic(request, user_id)

