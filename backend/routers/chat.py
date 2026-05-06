"""
================================================================
UQU Academic Assistant — Chat Router
================================================================
Converts: exports.chat from index.js lines 164-230
Dual routes:
  POST /chat     ← Legacy (frontend)
  POST /api/chat ← New FastAPI convention
"""

import time
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1 import Increment

from schemas.chat import ChatRequest, ChatResponse
from auth.dependencies import get_current_user_optional
from db.firestore import get_db
from agent.prompts import build_system_prompt
from agent.loop import run_agent_loop
from services.fallback_brain import get_fallback_response

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])


async def load_student_context(user_id: str, db) -> dict:
    """Load full student context from Firestore.

    Fetches ALL academic data for hyper-contextual prompting:
    - User document (profile, study_preferences, analysis)
    - Latest transcript (courses, semesters)
    - Upcoming exams (not done)
    - Active study plan
    - Semester GPA history (from semesters sub-collection)
    """
    user_ref = db.collection("users").document(user_id)

    # User data (profile + preferences + analysis)
    user_snap = user_ref.get()
    user_data = user_snap.to_dict() if user_snap.exists else {}

    # Latest transcript
    t_snaps = (user_ref.collection("transcripts")
               .order_by("createdAt", direction="DESCENDING")
               .limit(1).get())
    t_docs = list(t_snaps)
    transcript = t_docs[0].to_dict() if t_docs else None

    # Semester GPA history (separate sub-collection)
    sem_snaps = (user_ref.collection("semesters")
                 .order_by("createdAt", direction="ASCENDING")
                 .limit(20).get())
    semesters = [d.to_dict() for d in sem_snaps]

    # Merge semesters into transcript if transcript exists but has no semesters
    if transcript and not transcript.get("semesters") and semesters:
        transcript["semesters"] = semesters
    elif not transcript and semesters:
        transcript = {"courses": [], "semesters": semesters}

    # Upcoming exams (not done, from today)
    today = datetime.now().strftime("%Y-%m-%d")
    e_snaps = (user_ref.collection("exams")
               .where("done", "==", False)
               .where("date", ">=", today)
               .order_by("date")
               .limit(10).get())
    upcoming_exams = [d.to_dict() for d in e_snaps]

    # Active study plan
    p_snaps = (user_ref.collection("study_plans")
               .where("active", "==", True)
               .order_by("createdAt", direction="DESCENDING")
               .limit(1).get())
    p_docs = list(p_snaps)
    active_plan = p_docs[0].to_dict() if p_docs else None

    return {
        "user_data": user_data,
        "transcript": transcript,
        "upcoming_exams": upcoming_exams,
        "active_plan": active_plan,
    }


@router.post("/chat", response_model=ChatResponse)
async def chat_legacy(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_optional),
):
    """Legacy route — POST /chat"""
    return await _chat_logic(request, user_id)


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_optional),
):
    """New route — POST /api/chat"""
    return await _chat_logic(request, user_id)


async def _chat_logic(request: ChatRequest, user_id: str):
    """Main AI Agent logic — shared by both routes.

    Mirrors: exports.chat from index.js lines 164-230
    """
    try:
        db = get_db()

        # ── Load context ──
        ctx = await load_student_context(user_id, db)
        
        logger.info(f"========== CHAT CONTEXT DEBUG ==========")
        logger.info(f"Resolved User UID: {user_id}")
        logger.info(f"User Profile Exists: {bool(ctx.get('user_data'))}")
        logger.info(f"Transcript Exists: {bool(ctx.get('transcript'))}")
        logger.info(f"Upcoming Exams: {len(ctx.get('upcoming_exams', []))} found")
        logger.info(f"Active Plan Exists: {bool(ctx.get('active_plan'))}")
        logger.info(f"========================================")

        # ── Validate messages ──
        if not request.messages:
            raise HTTPException(status_code=400, detail="messages required")

        # ── Fallback Brain: ONLY for trivial greetings/thanks (NOT for academic Qs) ──
        # Previously, this brain intercepted GPA/plan/location questions with hardcoded
        # canned responses, which broke the real AI. Now restricted to pure greetings.
        last_msg = request.messages[-1].content if request.messages else ""
        fallback = get_fallback_response(last_msg, ctx.get("user_data"))

        if fallback:
            logger.info(f"Fallback brain (greeting/thanks) matched: {last_msg[:30]}...")
            return ChatResponse(
                success=True,
                message=fallback["message"],
                actions=fallback["actions"],
                conversationId=request.conversationId or f"conv_{int(time.time() * 1000)}"
            )

        # ── Step 2: Build messages & Run Agent ──
        system_prompt = build_system_prompt(
            ctx["user_data"],
            ctx["transcript"],
            ctx["upcoming_exams"],
            ctx["active_plan"],
        )
        full_messages = [
            {"role": "system", "content": system_prompt},
            *[{"role": m.role, "content": m.content} for m in request.messages],
        ]

        # ── Run agent ──
        try:
            result = await run_agent_loop(full_messages, user_id, db)
            content = result["content"]
            actions_log = result["actions_log"]
        except Exception as agent_err:
            err_str = str(agent_err)
            logger.error(f"[chat] Agent loop failed: {err_str}", exc_info=True)

            # Surface the real failure type to the user so they can fix it
            error_msg = "عذراً، واجه المحرك الذكي صعوبة في معالجة طلبك حالياً."
            low = err_str.lower()
            if "401" in err_str or "unauthorized" in low or "invalid" in low and "key" in low:
                error_msg = "⚠️ مفتاح NVIDIA API غير صالح أو منتهي — راجع backend/.env"
            elif "404" in err_str or "not found" in low or "model" in low:
                error_msg = f"⚠️ موديل الذكاء غير متاح ({err_str[:80]}). تحقق من NVIDIA_MODEL في backend/.env"
            elif "429" in err_str or "rate" in low:
                error_msg = "⚠️ تم تجاوز الحد المسموح من الطلبات — جرّب مرة أخرى بعد دقيقة."
            elif "timeout" in low or "timed out" in low:
                error_msg = "⚠️ المحرك تأخر في الرد — حاول مرة أخرى."
            elif "connection" in low or "network" in low:
                error_msg = "⚠️ تعذّر الاتصال بمزود الذكاء (NVIDIA NIM) — تحقق من اتصال السيرفر بالإنترنت."
            else:
                # Show the actual error tail so user/dev can debug
                error_msg = f"⚠️ خطأ في المحرك الذكي: {err_str[:120]}"

            return ChatResponse(
                success=True,
                message=error_msg,
                actions=[],
                conversationId=request.conversationId or f"conv_{int(time.time() * 1000)}"
            )

        # ── Persist chat history ──
        conv_id = request.conversationId or f"conv_{int(time.time() * 1000)}"
        user_ref = db.collection("users").document(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        # Save user message
        last_user_msg = None
        for m in reversed(request.messages):
            if m.role == "user":
                last_user_msg = m
                break

        if last_user_msg:
            user_ref.collection("chat_history").document(conv_id) \
                .collection("messages").add({
                    "role": "user",
                    "content": last_user_msg.content,
                    "timestamp": now_iso,
                })

        # Save assistant message
        if content:
            user_ref.collection("chat_history").document(conv_id) \
                .collection("messages").add({
                    "role": "assistant",
                    "content": content,
                    "actions": actions_log,
                    "timestamp": now_iso,
                })

            # Update conversation metadata
            user_ref.collection("chat_history").document(conv_id).set({
                "lastMessage": content[:120],
                "updatedAt": now_iso,
                "messageCount": Increment(2),
            }, merge=True)

        return ChatResponse(
            success=True,
            message=content,
            actions=actions_log,
            conversationId=conv_id,
        )

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"[chat] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))

