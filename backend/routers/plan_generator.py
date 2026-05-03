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
from schemas.plan_generator import PlanGenerationRequest, PlanGenerationResponse
from services.gemini import call_gemini

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
