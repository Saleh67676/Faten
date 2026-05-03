"""
================================================================
UQU Academic Assistant — Pomodoro Router
================================================================
Complete Pomodoro backend: session logging, statistics calculation,
and session fetching. Replaces the Firebase direct-writes and
client-side stat computation from assets/pomodoro.js.

Endpoints:
  POST   /api/pomodoro/log-session      — Log a completed session
  GET    /api/pomodoro/stats            — Get computed stats (sessions, hours, streaks)
  GET    /api/pomodoro/sessions         — Fetch all sessions for the user
  POST   /api/pomodoro/sync-settings    — Save Pomodoro settings to Firestore
"""

import logging
from datetime import datetime, timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import firestore as fb_firestore

from auth.bearer import verify_firebase_token
from db.firestore import get_db
from schemas.pomodoro import (
    PomodoroSessionLog, PomodoroLogResponse, PomodoroStats,
    PomodoroSession, PomodoroSessionListResponse, PomodoroSettings
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pomodoro", tags=["Pomodoro"])


@router.post("/log-session", response_model=PomodoroLogResponse)
async def log_completed_session(
    body: PomodoroSessionLog,
    user_id: str = Depends(verify_firebase_token),
) -> PomodoroLogResponse:
    """Record a completed Pomodoro session to Firestore."""
    db = get_db()
    try:
        doc_payload = {
            "courseCode": body.courseCode or "عام",
            "courseName": body.courseName or "مذاكرة عامة",
            "duration": int(body.duration),
            "type": body.type or "focus",
            "date": body.date or datetime.now().strftime("%Y-%m-%d"),
            "completedAt": body.completedAt or datetime.now().isoformat(),
            "loggedAt": fb_firestore.SERVER_TIMESTAMP,
        }
        ref = (
            db.collection("users")
            .document(user_id)
            .collection("completed_sessions")
            .add(doc_payload)
        )
        doc_ref = ref[1] if isinstance(ref, tuple) else ref
        return PomodoroLogResponse(success=True, id=doc_ref.id)
    except Exception as e:
        logger.error(f"Failed to log pomodoro session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل تسجيل جلسة البومودورو",
        )


@router.get("/stats", response_model=PomodoroStats)
async def get_pomodoro_stats(
    user_id: str = Depends(verify_firebase_token),
) -> PomodoroStats:
    """Compute Pomodoro statistics: total sessions, hours, best streak.
    
    Mirrors the metrics collection from assets/achievements.js,
    but computed server-side for authoritative stats.
    """
    db = get_db()
    try:
        sessions_ref = (
            db.collection("users")
            .document(user_id)
            .collection("completed_sessions")
        )
        docs = sessions_ref.stream()
        sessions = [
            {
                "id": doc.id,
                "date": doc.get("date", ""),
                "duration": doc.get("duration", 0),
                "type": doc.get("type", "focus"),
                "courseName": doc.get("courseName", ""),
            }
            for doc in docs
        ]

        # Filter focus sessions only
        focus_sessions = [s for s in sessions if s.get("type") == "focus"]

        # Compute metrics
        total_sessions = len(focus_sessions)
        total_minutes = sum(s.get("duration", 0) for s in focus_sessions)
        total_hours = total_minutes / 60 if total_minutes else 0

        # Compute best streak
        if focus_sessions:
            dates_set = sorted(set(s["date"] for s in focus_sessions if s.get("date")))
            streak = 1
            best_streak = 1
            for i in range(1, len(dates_set)):
                prev_date = datetime.strptime(dates_set[i - 1], "%Y-%m-%d")
                curr_date = datetime.strptime(dates_set[i], "%Y-%m-%d")
                days_diff = (curr_date - prev_date).days
                if days_diff == 1:
                    streak += 1
                    best_streak = max(best_streak, streak)
                else:
                    streak = 1
        else:
            best_streak = 0

        return PomodoroStats(
            totalSessions=total_sessions,
            totalMinutes=total_minutes,
            totalHours=round(total_hours, 2),
            bestStreak=best_streak,
        )
    except Exception as e:
        logger.error(f"Failed to compute pomodoro stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل حساب إحصائيات البومودورو",
        )


@router.get("/sessions", response_model=PomodoroSessionListResponse)
async def fetch_sessions(
    user_id: str = Depends(verify_firebase_token),
    limit: int = 50,
) -> PomodoroSessionListResponse:
    """Fetch user's recent Pomodoro sessions from Firestore."""
    db = get_db()
    try:
        docs = (
            db.collection("users")
            .document(user_id)
            .collection("completed_sessions")
            .order_by("completedAt", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        sessions = [
            PomodoroSession(
                id=doc.id,
                courseCode=doc.get("courseCode", "عام"),
                courseName=doc.get("courseName", "مذاكرة عامة"),
                duration=doc.get("duration", 0),
                type=doc.get("type", "focus"),
                date=doc.get("date", ""),
                completedAt=doc.get("completedAt", ""),
            )
            for doc in docs
        ]
        return PomodoroSessionListResponse(sessions=sessions)
    except Exception as e:
        logger.error(f"Failed to fetch sessions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل جلب جلسات البومودورو",
        )


@router.post("/sync-settings")
async def sync_pomodoro_settings(
    body: PomodoroSettings,
    user_id: str = Depends(verify_firebase_token),
) -> dict[str, Any]:
    """Save Pomodoro settings (focus duration, break duration, etc.) to Firestore."""
    db = get_db()
    try:
        db.collection("users").document(user_id).update({
            "pomodoroSettings": {
                "focus": body.focus or 25,
                "short": body.short or 5,
                "long": body.long or 15,
                "sound": body.sound if body.sound is not None else True,
                "autoBreak": body.autoBreak if body.autoBreak is not None else True,
                "notify": body.notify if body.notify is not None else True,
                "savedAt": fb_firestore.SERVER_TIMESTAMP,
            }
        })
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to sync settings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل حفظ إعدادات البومودورو",
        )
