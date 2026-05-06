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

from fastapi import APIRouter, Depends, HTTPException, Request
from google.cloud.firestore_v1 import Increment
from openai import AsyncOpenAI

from schemas.chat import ChatRequest, ChatResponse
from auth.dependencies import get_current_user_optional
from db.firestore import get_db
from agent.prompts import build_system_prompt
from agent.loop import run_agent_loop
from services.fallback_brain import get_fallback_response
from services.student import load_student_context

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat_legacy(
    body: ChatRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user_optional),
):
    """Legacy route — POST /chat"""
    return await _chat_logic(body, user_id, http_request.app.state.openai_client)


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user_optional),
):
    """New route — POST /api/chat"""
    return await _chat_logic(body, user_id, http_request.app.state.openai_client)


async def _chat_logic(request: ChatRequest, user_id: str, openai_client: AsyncOpenAI):
    """Main AI Agent logic — shared by both routes.

    Mirrors: exports.chat from index.js lines 164-230
    """
    try:
        db = get_db()

        # ── Load context ──
        ctx = await load_student_context(user_id, db)
        
        logger.debug(
            "[chat] context loaded — uid=%s profile=%s transcript=%s exams=%d plan=%s",
            user_id, bool(ctx.get("user_data")), bool(ctx.get("transcript")),
            len(ctx.get("upcoming_exams", [])), bool(ctx.get("active_plan")),
        )

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

        # ── Trim conversation history to prevent context overflow ──
        # Keep only the last 6 messages (≈ 3 user↔assistant exchanges) to save tokens.
        MAX_HISTORY = 6
        trimmed = (
            request.messages[-MAX_HISTORY:]
            if len(request.messages) > MAX_HISTORY
            else request.messages
        )
        logger.info(
            "[chat] history: %d msgs → trimmed to %d",
            len(request.messages), len(trimmed),
        )

        full_messages = [
            {"role": "system", "content": system_prompt},
            *[{"role": m.role, "content": m.content} for m in trimmed],
        ]

        # ── Run agent ──
        try:
            result = await run_agent_loop(full_messages, user_id, db, openai_client)
            content = result["content"]
            actions_log = result["actions_log"]
        except Exception as agent_err:
            err_str = str(agent_err)
            logger.error(f"[chat] Agent loop failed: {err_str}", exc_info=True)

            # Surface the real failure type to the user so they can fix it
            error_msg = "عذراً، واجه المحرك الذكي صعوبة في معالجة طلبك حالياً."
            low = err_str.lower()
            if "401" in err_str or "unauthorized" in low or "invalid" in low and "key" in low:
                error_msg = "⚠️ مفتاح OpenAI API غير صالح أو منتهي — راجع backend/.env"
            elif "404" in err_str or "not found" in low or "model" in low:
                error_msg = f"⚠️ موديل الذكاء غير متاح ({err_str[:80]}). تحقق من OPENAI_MODEL أو OPENAI_API_KEY في backend/.env"
            elif "429" in err_str or "rate" in low:
                error_msg = "⚠️ تم تجاوز الحد المسموح من الطلبات — جرّب مرة أخرى بعد دقيقة."
            elif "max_tokens" in low and "too large" in low:
                error_msg = "الرد المطلوب طويل جدًا، تم تقليل الحد الأقصى للتوكنز. حاول مرة أخرى."
            elif "timeout" in low or "timed out" in low:
                error_msg = "⚠️ المحرك تأخر في الرد — حاول مرة أخرى."
            elif "connection" in low or "network" in low:
                error_msg = "⚠️ تعذّر الاتصال بمزود الذكاء (OpenAI) — تحقق من اتصال السيرفر بالإنترنت."
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

