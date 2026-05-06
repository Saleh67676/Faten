"""
================================================================
UQU Academic Assistant — Plan Generator Schemas
================================================================
1:1 port of the request/response shape used by
assets/plan-generator.js (window.GeneratorEngine.generateAIPlan).
Field names match the JS exactly so the existing UI is not broken.
"""

from typing import Any
from pydantic import BaseModel, Field


class PlanCourse(BaseModel):
    """A current course the student wants scheduled."""
    name: str
    difficulty: str | None = None

    model_config = {"extra": "allow"}


class PlanSlot(BaseModel):
    """An available free time block defined by the user."""
    day: str
    time: str
    timeEnd: str
    place: str = ""

    model_config = {"extra": "allow"}


class CompletedCourse(BaseModel):
    """A historical course used to detect weak subjects."""
    name: str
    grade: float | str | None = None

    model_config = {"extra": "allow"}


class PlanProfilePreferences(BaseModel):
    studyTime: str | None = None
    studyStyle: str | None = None
    availableHours: int | str | None = None
    stressLevel: str | None = None
    learningSpeed: str | None = None

    model_config = {"extra": "allow"}


class PlanProfileGoals(BaseModel):
    currentGpa: float | str | None = None
    targetGpa: float | str | None = None

    model_config = {"extra": "allow"}


class PlanProfile(BaseModel):
    preferences: PlanProfilePreferences | None = None
    goals: PlanProfileGoals | None = None

    model_config = {"extra": "allow"}


class PlanGenerationRequest(BaseModel):
    """Mirror of the `state` argument plus the localStorage data
    that assets/plan-generator.js reads inline."""
    courses: list[PlanCourse] = Field(default_factory=list)
    slots: list[PlanSlot] = Field(default_factory=list)
    profile: PlanProfile | None = None
    completedCourses: list[CompletedCourse] = Field(default_factory=list)


class PlanTask(BaseModel):
    day: str
    time: str
    timeEnd: str
    courseName: str
    title: str
    note: str
    place: str

    model_config = {"extra": "allow"}


class PlanGenerationResponse(BaseModel):
    """Exact shape returned by the original JS generateAIPlan(state)."""
    reasoning: str
    tasks: list[PlanTask]

class FallbackPlanRequest(BaseModel):
    slots: list[dict[str, Any]]
    courses: list[dict[str, Any]]
    sessionMin: int = 60
    weeks: int = 1
    planStart: str

class FallbackPlanResponse(BaseModel):
    success: bool
    plan: list[dict[str, Any]] = []
    warnings: list[str] = []
    message: str = ""
