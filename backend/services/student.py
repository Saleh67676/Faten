"""
================================================================
UQU Academic Assistant — Student Context Service
================================================================
Single source of truth for loading a student's full academic
context from Firestore.

Each Firestore call runs in a thread-pool executor via
asyncio.get_running_loop().run_in_executor() so the event loop
is never blocked. Calls are SEQUENTIAL (not concurrent) to avoid
sharing the synchronous Firebase Admin gRPC channel across
multiple threads simultaneously, which is not thread-safe.

Consumers:
  - routers/chat.py   (system prompt construction)
  - routers/student.py (GET /api/student-context)
"""

import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


async def load_student_context(user_id: str, db) -> dict:
    """Load full student context from Firestore without blocking the event loop.

    Runs each Firestore SDK call in the default thread-pool executor
    (one at a time) so the synchronous gRPC channel is never shared
    across concurrent threads.
    """
    loop = asyncio.get_running_loop()
    user_ref = db.collection("users").document(user_id)
    today = datetime.now().strftime("%Y-%m-%d")

    # ── Run each blocking Firestore fetch in the thread pool, sequentially ──

    def _fetch_user():
        snap = user_ref.get()
        return snap.to_dict() if snap.exists else {}

    def _fetch_transcript():
        snaps = (
            user_ref.collection("transcripts")
            .order_by("createdAt", direction="DESCENDING")
            .limit(1)
            .get()
        )
        docs = list(snaps)
        if docs:
            return docs[0].to_dict()

        snaps = (
            user_ref.collection("academic_records")
            .where("type", "==", "transcript")
            .order_by("createdAt", direction="DESCENDING")
            .limit(1)
            .get()
        )
        docs = list(snaps)
        return docs[0].to_dict() if docs else None

    def _fetch_semesters():
        snaps = (
            user_ref.collection("semesters")
            .order_by("createdAt", direction="ASCENDING")
            .limit(20)
            .get()
        )
        semesters = [d.to_dict() for d in snaps]
        if semesters:
            return semesters

        snaps = (
            user_ref.collection("academic_records")
            .where("type", "==", "semester")
            .order_by("createdAt", direction="ASCENDING")
            .get()
        )
        return [d.to_dict() for d in snaps]

    def _fetch_exams():
        snaps = (
            user_ref.collection("exams")
            .where("done", "==", False)
            .where("date", ">=", today)
            .order_by("date")
            .limit(10)
            .get()
        )
        return [d.to_dict() for d in snaps]

    def _fetch_plan():
        snaps = (
            user_ref.collection("study_plans")
            .where("active", "==", True)
            .order_by("createdAt", direction="DESCENDING")
            .limit(1)
            .get()
        )
        docs = list(snaps)
        return docs[0].to_dict() if docs else None

    user_data   = await loop.run_in_executor(None, _fetch_user)
    transcript  = await loop.run_in_executor(None, _fetch_transcript)
    semesters   = await loop.run_in_executor(None, _fetch_semesters)
    upcoming_exams = await loop.run_in_executor(None, _fetch_exams)
    active_plan = await loop.run_in_executor(None, _fetch_plan)

    # ── Merge semesters into transcript ──
    if transcript and not transcript.get("semesters") and semesters:
        transcript["semesters"] = semesters
    elif not transcript and semesters:
        transcript = {"courses": [], "semesters": semesters}

    logger.debug(
        "[student_ctx] uid=%s profile=%s transcript=%s semesters=%d exams=%d plan=%s",
        user_id, bool(user_data), bool(transcript),
        len(semesters), len(upcoming_exams), bool(active_plan),
    )

    return {
        "user_data": user_data,
        "transcript": transcript,
        "upcoming_exams": upcoming_exams,
        "active_plan": active_plan,
    }
