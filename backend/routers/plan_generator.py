"""
================================================================
UQU Academic Assistant — Plan Generator Router
================================================================
1:1 server-side port of assets/plan-generator.js.

Replaces the client-side Gemini call (which exposed the API key
in the browser bundle). The Arabic "Cerebrum Logic" system
prompt is reproduced verbatim from the original JS.

Endpoint:
  POST /api/plan/generate  (Bearer auth)
"""

import logging
from fastapi import APIRouter, Depends

from auth.bearer import verify_firebase_token
from schemas.plan_generator import PlanGenerationRequest, PlanGenerationResponse, FallbackPlanRequest, FallbackPlanResponse
from services.gemini import call_gemini
import math
import uuid
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plan", tags=["Plan Generator"])


def _build_system_prompt(req: PlanGenerationRequest) -> str:
    """Reproduce the exact Arabic system prompt from
    assets/plan-generator.js (lines 35-78)."""
    prefs = (req.profile.preferences if req.profile and req.profile.preferences else None)
    goals = (req.profile.goals if req.profile and req.profile.goals else None)

    pref_studyTime = (prefs.studyTime if prefs else None) or "غير محدد"
    pref_studyStyle = (prefs.studyStyle if prefs else None) or "غير محدد"
    pref_availableHours = (prefs.availableHours if prefs else None) or "غير محدد"
    pref_stressLevel = (prefs.stressLevel if prefs else None) or "غير محدد"
    pref_learningSpeed = (prefs.learningSpeed if prefs else None) or "متوسط"
    goal_currentGpa = (goals.currentGpa if goals else None) or "غير محدد"
    goal_targetGpa = (goals.targetGpa if goals else None) or "غير محدد"

    # weakSubjects = completedCourses.filter(c => c.grade != null && parseFloat(c.grade) <= 3.5)
    weak_subjects = []
    for c in req.completedCourses:
        if c.grade is None:
            continue
        try:
            grade_val = float(c.grade)
        except (TypeError, ValueError):
            continue
        if grade_val <= 3.5:
            weak_subjects.append(f"{c.name} ({c.grade})")

    if weak_subjects:
        weak_context = (
            "المواد الضعيفة السابقة للطالب (أقل من C+): "
            + "، ".join(weak_subjects)
        )
    else:
        weak_context = "لا يوجد مواد ضعيفة سابقة واضحة."

    courses_lines = "\n".join(
        f"- {c.name} (الصعوبة: {c.difficulty})" for c in req.courses
    )
    slots_lines = "\n".join(
        f"- {s.day} (من {s.time} إلى {s.timeEnd}) في {s.place}" for s in req.slots
    )

    return f"""أنت الذكاء الاصطناعي الأكاديمي لجامعة أم القرى.
مهمتك: صياغة خطة دراسية أسبوعية ذكية 100% مبنية على تحليل عميق لبروفايل الطالب. المخرجات يجب أن تكون بصيغة JSON فقط.

[بيانات الطالب]:
- وقت المذاكرة المفضل: {pref_studyTime}
- أسلوب المذاكرة الافتراضي: {pref_studyStyle}
- أقصى ساعات أسبوعياً: {pref_availableHours}
- مستوى الضغط الدراسي: {pref_stressLevel}
- سرعة الاستيعاب: {pref_learningSpeed}
- المعدل الحالي: {goal_currentGpa} ، المعدل المستهدف: {goal_targetGpa}

[التاريخ الأكاديمي]:
{weak_context}
*** يجب أن تقوم بربط ذكي: إذا كانت هناك مادة حالية في البرمجة أو الرياضيات وكانت موجودة ضعف في السابق، اطلب منه تركيزاً مضاعفاً.

[المواد الحالية المطلوب جدولتها]:
{courses_lines}

[الفترات الزمنية المتاحة للطالب (Slots)]:
{slots_lines}

[منطق بناء الخطة المطلوب - The Cerebrum Logic]:
1. صمم جلسات المذاكرة في الفترات المتاحة للطالب (Slots) فقط.
2. الكثافة (Density): إذا كان "مستوى الضغط مرتفع"، فكثف الجلسات وضع أوقات للمراجعة النشطة (Active Recall).
3. أسلوب الطالب: إذا كان يفضل "الصباح"، ركّز وضع المهام الثقيلة في الفترات الصباحية إن وجدت. صِغ الـ "title" لكل جلسة بدقة، مثال: المذاكرة بأسلوب (خرائط ذهنية) للمتجهات.
4. إعطاء ملاحظة توجيهية (note) لكل جلسة تتناسب مع نقاط ضعف وقوة الطالب.

[المخرجات JSON]:
يجب أن تعيد JSON Object فقط بالتنسيق التالي:
{{
  "reasoning": "رسالة للطالب تشرح باختصار لماذا صممت الخطة بهذا الشكل، مبنية على أوقاته وتفضيلاته ومواده الضعيفة.",
  "tasks": [
    {{
       "day": "الأحد",
       "time": "18:00",
       "timeEnd": "19:00",
       "courseName": "اسم المادة المطابق للمواد الحالية",
       "title": "عنوان الجلسة (مثال: تلخيص الفصل الأول)",
       "note": "نصيحة للجلسة",
       "place": "مكان الجلسة المطابق للـ Slot"
    }}
  ]
}}
هام: المخرجات يجب أن تكون JSON نقي بين أقواس {{}} ولا تسبق بأي كلمات أو رموز ماركداون. الأيام يجب أن تطابق: الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت."""


@router.post("/generate", response_model=PlanGenerationResponse)
async def generate_plan(
    body: PlanGenerationRequest,
    user_id: str = Depends(verify_firebase_token),
) -> PlanGenerationResponse:
    """Generate an AI study plan via Gemini.

    Returns the same { reasoning, tasks } shape that
    assets/plan-generator.js used to return so the
    existing window.GeneratorEngine.generateAIPlan(state) callers
    keep working unchanged.
    """
    system_prompt = _build_system_prompt(body)

    parsed = await call_gemini(
        system_prompt=system_prompt,
        user_content="اصنع الخطة بناءً على القواعد المعطاة.",
        temperature=0.7,
        response_mime_type="application/json",
    )

    if not isinstance(parsed, dict):
        logger.error(f"Gemini returned non-object plan: {type(parsed).__name__}")
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل تحليل الهيكل المسترجع من الذكاء الاصطناعي (Invalid JSON).",
        )

    return PlanGenerationResponse(
        reasoning=parsed.get("reasoning", ""),
        tasks=parsed.get("tasks", []),
    )

def _format_time(mins: int) -> str:
    h = mins // 60
    m = mins % 60
    return f"{h:02d}:{m:02d}"

@router.post("/generate-fallback", response_model=FallbackPlanResponse)
async def generate_fallback_plan(
    body: FallbackPlanRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FallbackPlanResponse:
    slots = body.slots
    courses = body.courses
    session_min = body.sessionMin
    max_weeks = body.weeks
    plan_start = body.planStart

    weekly_sessions_template = []
    day_index = {
        'الأحد': 0, 'الإثنين': 1, 'الاثنين': 1, 'الثلاثاء': 2,
        'الأربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6
    }
    
    for s in slots:
        day = s.get('day', 'الأحد')
        time_str = s.get('time', '00:00')
        time_end_str = s.get('timeEnd', '00:00')
        
        try:
            start_h, start_m = map(int, time_str.split(':'))
            end_h, end_m = map(int, time_end_str.split(':'))
        except:
            start_h, start_m, end_h, end_m = 0, 0, 0, 0
            
        start_mins = start_h * 60 + start_m
        end_mins = end_h * 60 + end_m
        if end_mins < start_mins: end_mins += 24 * 60
        diff = end_mins - start_mins
        
        count = diff // session_min
        for i in range(count):
            s_m = start_mins + i * session_min
            e_m = s_m + session_min
            weekly_sessions_template.append({
                'day': day,
                'startMins': s_m,
                'endMins': e_m,
                'place': s.get('place', '')
            })

    if not weekly_sessions_template:
        return FallbackPlanResponse(success=False, message='الفترات المتاحة قصيرة جداً بالنسبة لمدة الجلسة.')

    demand = {}
    deadline_week = {}
    warnings = []
    weekly_cap = len(weekly_sessions_template)
    try:
        base_date = datetime.strptime(plan_start, "%Y-%m-%d")
    except ValueError:
        base_date = datetime.now()

    for c in courses:
        cid = c.get('id')
        try:
            current = min(100.0, max(0.0, float(c.get('currentProgress') or 0)))
        except:
            current = 0.0
            
        try:
            per_session = max(0.0, float(c.get('progressPerSession') or 0))
        except:
            per_session = 0.0
            
        remaining = max(0.0, 100.0 - current)
        
        if per_session > 0:
            required_sessions = math.ceil(remaining / per_session)
        else:
            try:
                wh = max(1, int(c.get('weeklyHours') or 1))
            except:
                wh = 1
            required_sessions = wh * max_weeks
            
        demand[cid] = required_sessions
        
        exam_date_str = c.get('examDate')
        if exam_date_str:
            try:
                exam_date = datetime.strptime(exam_date_str, "%Y-%m-%d")
                diff_days = (exam_date - base_date).days
                w_idx = 1 if diff_days < 0 else math.floor(diff_days / 7) + 1
                w_idx = min(max_weeks, max(1, w_idx))
                deadline_week[cid] = w_idx
            except ValueError:
                deadline_week[cid] = max_weeks
        else:
            deadline_week[cid] = max_weeks
            
        capacity = weekly_cap * deadline_week[cid]
        if required_sessions > capacity:
            warnings.append(f'المادة "{c.get("name")}" تحتاج تقريبًا {required_sessions} جلسة حتى تصل 100٪، لكن السعة المتاحة هي {capacity} جلسة فقط.')

    study_tasks = []
    
    for w in range(1, max_weeks + 1):
        weekly_quota = {}
        weekly_assigned = {}
        for cid, left in demand.items():
            if left <= 0 or w > deadline_week[cid]:
                weekly_quota[cid] = 0
                weekly_assigned[cid] = 0
                continue
            weeks_remaining = deadline_week[cid] - w + 1
            weekly_quota[cid] = min(left, math.ceil(left / weeks_remaining))
            weekly_assigned[cid] = 0
            
        for sess in weekly_sessions_template:
            chosen_id = None
            best_score = -float('inf')
            
            for cid, left in demand.items():
                if left <= 0 or w > deadline_week[cid]: continue
                quota_left = weekly_quota[cid] - weekly_assigned[cid]
                if quota_left > 0:
                    score = quota_left * 1000 + left
                    if score > best_score:
                        best_score = score
                        chosen_id = cid
                        
            if not chosen_id:
                for cid, left in demand.items():
                    if left <= 0 or w > deadline_week[cid]: continue
                    if left > best_score:
                        best_score = left
                        chosen_id = cid
                        
            if not chosen_id: continue
            
            course = next((c for c in courses if c.get('id') == chosen_id), None)
            if not course: continue
            
            demand[chosen_id] -= 1
            if weekly_quota[chosen_id] > 0:
                weekly_assigned[chosen_id] += 1
                
            offset_days = (w - 1) * 7 + day_index.get(sess['day'], 0)
            d = base_date + timedelta(days=offset_days)
            date_iso = d.strftime("%Y-%m-%d")
            
            study_tip = 'اقرأ وفهم ثم لخص بأسلوبك' # Default tip
            
            study_tasks.append({
                'id': str(uuid.uuid4()),
                'kind': 'study',
                'week': w,
                'day': sess['day'],
                'date': date_iso,
                'time': _format_time(sess['startMins']),
                'timeEnd': _format_time(sess['endMins']),
                'courseId': course.get('id'),
                'courseName': course.get('name', ''),
                'courseColor': course.get('color', ''),
                'title': f"{course.get('name', '')}: جلسة تقدّم دراسي",
                'place': sess.get('place', ''),
                'note': f"💡 {study_tip} — تقدم متوقع: {course.get('progressPerSession', '?')}%"
            })

    return FallbackPlanResponse(success=True, plan=study_tasks, warnings=warnings)
