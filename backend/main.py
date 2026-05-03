"""
================================================================
UQU ACADEMIC ASSISTANT — FastAPI Backend
AI Agent Backend v2.0 (Python/FastAPI)
================================================================
Endpoints:
  POST /api/chat                 — AI Agent (NVIDIA kimi-k2.5 + Function Calling)
  POST /api/sync-profile         — Sync localStorage profile → Firestore
  POST /api/sync-transcript      — OCR + AI analysis of transcript
  GET  /api/student-context      — Fetch full Firestore data for frontend
  POST /api/mark-notification-read — Mark notification as read
  CRON                           — Daily proactive notifications (8 AM Riyadh)
================================================================

📌 Setup:
  1. pip install -r requirements.txt
  2. Place your Firebase serviceAccountKey.json in the backend/ folder
  3. Edit .env with your NVIDIA API key
  4. Run: uvicorn main:app --reload --port 8000
  5. Open: http://localhost:8000/docs (Swagger UI)
================================================================
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import get_settings
from db.firestore import init_firestore

# ── Import Routers ──
from routers.chat import router as chat_router
from routers.profile import router as profile_router
from routers.transcript import router as transcript_router
from routers.student import router as student_router
from routers.notifications import router as notifications_router
from routers.onboarding import router as onboarding_router
from routers.plan_generator import router as plan_generator_router
from routers.schedule_ai import router as schedule_ai_router
from routers.engine import router as engine_router
from routers.pomodoro import router as pomodoro_router
from routers.firebase_writes import router as firebase_writes_router
from routers.achievements import router as achievements_router

# ── Import CRON tasks ──
from tasks.cron import daily_notifications_cron

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── Scheduler ──
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # ── Startup ──
    logger.info("🚀 Starting UQU Academic Assistant Backend...")
    init_firestore()
    logger.info("✅ Firestore initialized")

    # Schedule daily notifications cron (8:00 AM Riyadh = UTC+3)
    scheduler.add_job(
        daily_notifications_cron,
        CronTrigger(hour=8, minute=0, timezone="Asia/Riyadh"),
        id="daily_notifications",
        name="Daily Motivational Notifications",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("⏰ CRON scheduler started (daily at 8:00 AM Riyadh)")

    logger.info("═" * 50)
    logger.info("  UQU Academic Assistant — Backend Ready!")
    logger.info("  📖 Swagger UI: http://localhost:8000/docs")
    logger.info("═" * 50)

    yield

    # ── Shutdown ──
    scheduler.shutdown()
    logger.info("👋 Backend shutting down.")


# ══════════════════════════════════════════════════════════════
#  FastAPI Application
# ══════════════════════════════════════════════════════════════

app = FastAPI(
    title="UQU Academic Assistant API",
    description="المساعد الأكاديمي الذكي لجامعة أم القرى — AI Agent Backend",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS (allow all origins for development) ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # In production, restrict to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register Routers ──
app.include_router(chat_router)
app.include_router(profile_router)
app.include_router(transcript_router)
app.include_router(student_router)
app.include_router(notifications_router)
app.include_router(onboarding_router)
app.include_router(plan_generator_router)
app.include_router(schedule_ai_router)
app.include_router(engine_router)
app.include_router(pomodoro_router)
app.include_router(firebase_writes_router)
app.include_router(achievements_router)


# ── Health Check ──
@app.get("/", tags=["Health"])
async def root():
    """Health check endpoint."""
    return {
        "status": "running",
        "service": "UQU Academic Assistant API",
        "version": "2.0.0",
    }


@app.get("/health", tags=["Health"])
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "firebase": "connected",
        "scheduler": "running" if scheduler.running else "stopped",
    }


# ══════════════════════════════════════════════════════════════
#  Run with: uvicorn main:app --reload --port 8000
# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
