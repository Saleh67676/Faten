"""
================================================================
UQU Academic Assistant — Engine Compute Router
================================================================
1:1 server-side port of the compute helpers in assets/engine.js:
  - scoreExamPressure       → POST /api/engine/exam-pressure
  - getPlanWarnings         → POST /api/engine/plan-warnings
  - suggestExtraSessionsForCourse → POST /api/engine/suggest-sessions

DateUtils, generateICS, downloadICS, generateSmartPlan, predictRequiredGrade,
and normalizeArabic remain client-side (file generation, plan-already-in-agent,
or pure utilities).

All algorithms are direct ports — same constants, same formulas, same outputs.
"""

import math
import logging
from datetime import date as date_cls, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any

from fastapi import APIRouter, Depends

from auth.bearer import verify_firebase_token
from schemas.engine import (
    ExamPressureRequest,
    ExamPressureResponse,
    PlanWarningsRequest,
    PlanWarningsResponse,
    SuggestSessionsRequest,
    SuggestSessionsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/engine", tags=["Engine"])

RIYADH_TZ = ZoneInfo("Asia/Riyadh")

# Same Arabic day names used by engine.js DateUtils (Sunday-first index).
DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]


def _today(today_iso: str | None) -> date_cls:
    if today_iso:
        try:
            return date_cls.fromisoformat(today_iso)
        except ValueError:
            pass
    return datetime.now(RIYADH_TZ).date()


def _days_until(iso: str | None, today: date_cls) -> int | None:
    if not iso:
        return None
    try:
        target = date_cls.fromisoformat(iso[:10])
    except ValueError:
        return None
    return (target - today).days


def _parse_time(t: str | None) -> int:
    """Mirror DateUtils.parseTime: 'HH:MM' → minutes, missing returns 0."""
    if not t:
        return 0
    try:
        parts = t.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 and parts[1] else 0
        return h * 60 + m
    except (ValueError, IndexError):
        return 0


def _format_time(minutes: int) -> str:
    """Mirror DateUtils.formatTime: minutes → 'HH:MM'."""
    minutes = max(0, minutes)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _to_iso(d: date_cls) -> str:
    return d.isoformat()


def _day_name_for(d: date_cls) -> str:
    """JS getDay(): Sunday=0..Saturday=6.
    Python date.weekday(): Monday=0..Sunday=6 → convert to Sunday=0."""
    js_day = (d.weekday() + 1) % 7
    return DAY_NAMES[js_day]


# ──────────────────────────────────────────────
# 1. EXAM PRESSURE — port of engine.js scoreExamPressure
# ──────────────────────────────────────────────

@router.post("/exam-pressure", response_model=ExamPressureResponse)
async def exam_pressure(
    body: ExamPressureRequest,
    user_id: str = Depends(verify_firebase_token),
) -> ExamPressureResponse:
    if not body.courses:
        return ExamPressureResponse(courses=[])

    today = _today(body.today)
    out: list[dict[str, Any]] = []

    for c in body.courses:
        item = dict(c)  # spread (... copy)
        exam_date = c.get("examDate")
        if not exam_date:
            item["pressure"] = 0
            out.append(item)
            continue

        days = _days_until(exam_date, today)
        if days is None or days < 0:
            item["pressure"] = 0
            out.append(item)
            continue

        difficulty = c.get("difficulty")
        if difficulty == "hard":
            difficulty_factor = 1.4
        elif difficulty == "easy":
            difficulty_factor = 0.7
        else:
            difficulty_factor = 1.0

        try:
            current_progress = float(c.get("currentProgress") or 0)
        except (TypeError, ValueError):
            current_progress = 0.0
        progress_factor = 1 - (current_progress / 100)

        days_factor = math.exp(-days / 10)

        pressure = round(
            min(100, days_factor * 100 * difficulty_factor * (0.4 + 0.6 * progress_factor))
        )

        item["pressure"] = pressure
        item["daysUntil"] = days
        out.append(item)

    out.sort(key=lambda x: x.get("pressure", 0), reverse=True)
    return ExamPressureResponse(courses=out)


# ──────────────────────────────────────────────
# 2. PLAN WARNINGS — port of engine.js getPlanWarnings
# ──────────────────────────────────────────────

@router.post("/plan-warnings", response_model=PlanWarningsResponse)
async def plan_warnings(
    body: PlanWarningsRequest,
    user_id: str = Depends(verify_firebase_token),
) -> PlanWarningsResponse:
    warnings: list[dict[str, Any]] = []
    plan = body.plan or {}
    sessions = plan.get("plan") or []

    if not sessions:
        warnings.append(
            {"type": "empty", "msg": "الخطة فارغة — لا توجد جلسات مجدولة."}
        )
        return PlanWarningsResponse(warnings=warnings)

    today = _today(body.today)

    # Overload: > 6 sessions in any day
    by_date: dict[str, int] = {}
    for s in sessions:
        d = s.get("date")
        if not d:
            continue
        by_date[d] = by_date.get(d, 0) + 1

    for d, count in by_date.items():
        if count > 6:
            warnings.append(
                {"type": "overload", "msg": f"يوم {d} فيه {count} جلسات — قد يكون مرهقاً."}
            )

    # Missing exam sessions (within 3 days)
    profile = body.profile or {}
    courses = (profile.get("courses") or [])
    for c in courses:
        exam_date = c.get("examDate")
        if not exam_date:
            continue
        days = _days_until(exam_date, today)
        if days is None or days < 0 or days > 3:
            continue
        c_id = c.get("id")
        c_name = c.get("name")
        has_session = any(
            (s.get("courseId") == c_id and c_id is not None) or (s.get("courseName") == c_name and c_name is not None)
            for s in sessions
        )
        if not has_session:
            warnings.append({
                "type": "exam_soon",
                "msg": f"اختبار {c_name} بعد {days} يوم — لا يوجد جلسة مذاكرة له في الخطة!",
                "urgent": True,
            })

    # Long gap (> 3 days between consecutive session dates)
    sorted_dates = sorted(by_date.keys())
    for i in range(1, len(sorted_dates)):
        try:
            a = date_cls.fromisoformat(sorted_dates[i - 1])
            b = date_cls.fromisoformat(sorted_dates[i])
        except ValueError:
            continue
        gap = (b - a).days
        if gap > 3:
            warnings.append({
                "type": "gap",
                "msg": f"فجوة {gap} أيام بين {sorted_dates[i-1]} و {sorted_dates[i]} — ربما تحتاج جلسة وسط.",
            })

    return PlanWarningsResponse(warnings=warnings)


# ──────────────────────────────────────────────
# 3. SUGGEST EXTRA SESSIONS — port of engine.js suggestExtraSessionsForCourse
# ──────────────────────────────────────────────

@router.post("/suggest-sessions", response_model=SuggestSessionsResponse)
async def suggest_sessions(
    body: SuggestSessionsRequest,
    user_id: str = Depends(verify_firebase_token),
) -> SuggestSessionsResponse:
    course = body.course
    slots = body.slots
    if not course or not slots:
        return SuggestSessionsResponse(suggestions=[])

    today = _today(body.today)
    plan = body.plan or {}
    plan_sessions = plan.get("plan") or []

    course_id = course.get("id")
    course_name = course.get("name")

    existing_sessions = [
        s for s in plan_sessions
        if s.get("courseName") == course_name or (course_id is not None and s.get("courseId") == course_id)
    ]

    days_left = _days_until(course.get("examDate"), today)
    if days_left is not None:
        max_day = min(days_left - 1, 14)
    else:
        max_day = 14

    suggestions: list[dict[str, Any]] = []
    day_offset = 0
    while day_offset < max_day and len(suggestions) < body.count:
        d = today + timedelta(days=day_offset)
        iso = _to_iso(d)
        dow = _day_name_for(d)

        slot = next((sl for sl in slots if sl.get("day") == dow), None)
        if not slot:
            day_offset += 1
            continue

        slot_from = slot.get("from")
        slot_to = slot.get("to")
        slot_from_min = _parse_time(slot_from)
        slot_to_min = _parse_time(slot_to)

        clash = any(
            s.get("date") == iso
            and _parse_time(s.get("time")) < slot_to_min
            and _parse_time(s.get("timeEnd") or slot_to) > slot_from_min
            for s in plan_sessions
        )
        if clash:
            day_offset += 1
            continue

        if any(s.get("date") == iso for s in existing_sessions):
            day_offset += 1
            continue

        suggestions.append({
            "date": iso,
            "day": dow,
            "time": slot_from,
            "timeEnd": slot_to,
            "courseName": course_name,
            "courseId": course_id,
            "courseColor": course.get("color"),
            "place": slot.get("place") or "غير محدد",
            "kind": "suggested",
        })

        day_offset += 1

    return SuggestSessionsResponse(suggestions=suggestions)
