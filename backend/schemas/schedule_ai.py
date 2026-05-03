"""
================================================================
UQU Academic Assistant — Schedule AI Schemas
================================================================
1:1 port of the request/response shape used by
assets/ai-service.js (window.AIService.parseScheduleWithAI).
"""

from pydantic import BaseModel, Field


class ScheduleAIRequest(BaseModel):
    """Mirror of parseScheduleWithAI(rawPdfText)."""
    raw_pdf_text: str


class ScheduleSlot(BaseModel):
    """One activity slot from the parsed timetable.
    Field names lifted verbatim from assets/ai-service.js system prompt example."""
    courseCode: str
    courseName: str
    activityType: str
    day: str
    startTime: str
    endTime: str
    room: str = ""
    building: str = ""

    model_config = {"extra": "allow"}


class ScheduleAIResponse(BaseModel):
    """Wraps the JS array response in a `schedule` key (the JS wrapper unwraps it
    before returning to existing callers, preserving their array contract)."""
    schedule: list[ScheduleSlot] = Field(default_factory=list)
