"""
================================================================
UQU Academic Assistant — Schedule AI Router
================================================================
1:1 server-side port of assets/ai-service.js.

Replaces the client-side Gemini call (which exposed the API key
in the browser bundle). The strict-grid Arabic system prompt is
reproduced verbatim from the original JS.

Endpoint:
  POST /api/schedule/analyze-with-ai  (Bearer auth)
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status

from auth.bearer import verify_firebase_token
from schemas.schedule_ai import ScheduleAIRequest, ScheduleAIResponse
from services.gemini import call_gemini

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/schedule", tags=["Schedule AI"])


# Verbatim from assets/ai-service.js lines 15-35.
SYSTEM_PROMPT = """أنت خبير في تحليل الجداول الجامعية المعقدة (خاصة جداول جامعة أم القرى). لقد تم تدمير التنسيق البصري للجدول عند تحويله إلى نص. مهمتك هي إعادة بناء الشبكة (Grid) ذهنياً واستخراج البيانات بدقة.
قواعد التحليل الصارمة (Grid Cross-Verification):

1. منطق الأيام: الجدول يحتوي على 5 أيام (الأحد إلى الخميس). أي مادة تظهر يجب ربطها باليوم المذكور في أعلى العمود التخيلي.
2. منطق الوقت (خط أحمر): المحاضرات تبدأ دائماً على رأس الساعة (مثلاً 08:00، 13:00) وتنتهي في الدقيقة 50 (مثلاً 08:50، 13:50). إذا وجدت وقتاً مثل '13:50' بجانب مادة، فهذا وقت النهاية وليس البداية. ابحث عن وقت البداية المنطقي بناءً على عدد ساعات المادة.
3. الفصل بين النظري والعملي: إذا كان للمادة (مثل 'الرسومات بالحاسب') أوقات متعددة، يجب فصلها إلى كائنين (Objects) مستقلين: واحد للنشاط 'نظري' والآخر 'عملي'، مع تحديد وقت وقاعة كل منهما بدقة.
4. منطق المحاذاة المكانية: لا تعتمد على النص المجاور مباشرة. قم بربط اسم المادة برقم القاعة والوقت الذي يقع في نفس 'الكتلة' (Block) وتأكد من عدم الإزاحة (Offset).

يجب أن تعيد البيانات حصرياً بهذا الهيكل (Array of Objects). يمنع استخدام أي نصوص خارج الـ JSON:
[
  {
    "courseCode": "CS2206",
    "courseName": "الرسومات بالحاسب",
    "activityType": "نظري",
    "day": "الاثنين",
    "startTime": "11:00",
    "endTime": "13:50",
    "room": "1.042",
    "building": "25"
  }
]"""


@router.post("/analyze-with-ai", response_model=ScheduleAIResponse)
async def analyze_schedule_with_ai(
    body: ScheduleAIRequest,
    user_id: str = Depends(verify_firebase_token),
) -> ScheduleAIResponse:
    """Parse a raw timetable PDF text via Gemini.

    Returns the same array shape that assets/ai-service.js used to
    return, wrapped under `schedule` so FastAPI can serialize it
    safely. The JS wrapper unwraps `data.schedule` before returning
    to existing callers.
    """
    user_content = (
        f"قم بتحليل هذا الجدول حسب القواعد الصارمة:\n\n{body.raw_pdf_text}"
    )

    parsed = await call_gemini(
        system_prompt=SYSTEM_PROMPT,
        user_content=user_content,
        temperature=0.1,
        response_mime_type="application/json",  # force structured JSON output
    )

    if not isinstance(parsed, list):
        logger.error(f"Gemini returned non-array schedule: {type(parsed).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل تحليل الهيكل المسترجع من الذكاء الاصطناعي (Invalid JSON).",
        )

    return ScheduleAIResponse(schedule=parsed)
