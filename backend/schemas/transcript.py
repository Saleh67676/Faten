"""
================================================================
UQU Academic Assistant — Transcript Schemas
================================================================
"""

from __future__ import annotations
from pydantic import BaseModel


class CourseRecord(BaseModel):
    """A single course from the academic transcript."""
    name: str
    code: str = ""
    grade: str = ""
    credit_hours: int = 3
    creditHours: int | None = None  # frontend camelCase alias

    model_config = {"populate_by_name": True}

    def get_hours(self) -> int:
        return self.creditHours or self.credit_hours


class SemesterRecord(BaseModel):
    """A semester from the academic transcript with GPA."""
    name: str = ""          # "الفصل الأول 1446"
    gpa: float = 0.0
    hours: int = 0
    courses: list[CourseRecord] = []

    model_config = {"populate_by_name": True}


class TranscriptPayload(BaseModel):
    """Request body for POST /api/sync-transcript."""
    courses: list[CourseRecord] = []
    semesters: list[SemesterRecord] = []
    cgpa: float | None = None
    totalHours: int | None = None


class TranscriptResponse(BaseModel):
    """Response body for POST /api/sync-transcript."""
    success: bool = True
    analysis: dict = {}


class NotificationReadRequest(BaseModel):
    """Request body for POST /api/mark-notification-read."""
    notificationId: str
