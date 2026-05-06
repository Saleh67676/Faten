from fastapi import APIRouter, Depends
from typing import Optional
from schemas.diagnostics import DiagnosticsRequest, GoalCalcRequest
from services.diagnostics import generate_diagnostics, calc_required_sgpa
from auth.dependencies import get_current_user_optional

router = APIRouter(prefix="/api/diagnostics", tags=["Diagnostics"])

@router.post("/analyze")
async def analyze_diagnostics(
    request: DiagnosticsRequest,
    user_id: Optional[str] = Depends(get_current_user_optional)
):
    """
    Perform full academic diagnostics analysis.
    """
    report = generate_diagnostics(
        semesters=request.semesters,
        goals=request.goals
    )
    return report

@router.post("/calculate-goal")
async def calculate_goal(
    request: GoalCalcRequest,
    user_id: Optional[str] = Depends(get_current_user_optional)
):
    """
    Calculate required SGPA for a specific term to reach a target CGPA.
    """
    result = calc_required_sgpa(
        current_gpa=request.currentGpa,
        earned_hours=request.earnedHours,
        total_points=request.totalPoints,
        target_gpa=request.targetGpa,
        term_hours=request.termHours
    )
    return result
