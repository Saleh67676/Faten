"""
================================================================
UQU Academic Assistant — Profile Schemas
================================================================
"""

from __future__ import annotations
from pydantic import BaseModel


class BasicInfo(BaseModel):
    """Basic student info from localStorage."""
    name: str = ""
    university: str = ""
    major: str = ""
    level: str = ""


class GoalsInfo(BaseModel):
    """Academic goals."""
    currentGpa: float | None = None
    targetGpa: float | None = None
    earnedHours: int | None = None


class LearningInfo(BaseModel):
    """Learning preferences."""
    bestTime: str = ""
    studyHours: int = 0
    studyStyle: str = ""
    focusLength: int = 25
    studySpeed: str = "normal"      # slow, normal, fast
    stressLevel: str = "normal"     # low, normal, high, critical


class ProfilePayload(BaseModel):
    """Request body for POST /api/sync-profile.
    Maps to the localStorage structure sent from the frontend.
    """
    # Structured format (preferred)
    basic: BasicInfo | None = None
    goals: GoalsInfo | None = None
    learning: LearningInfo | None = None
    courses: list[dict] = []

    # Flat format fallback
    name: str = ""
    university: str = ""
    major: str = ""
    level: str = ""


class ProfileResponse(BaseModel):
    """Response body for POST /api/sync-profile."""
    success: bool = True
