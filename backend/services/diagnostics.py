import math
from typing import List, Dict, Any, Optional

# ── Grade scale (mirrors diagnostics.js) ──────────────────────
GRADE_POINTS = {
    'A+': 5.00, 'A': 4.75, 'A-': 4.50,
    'B+': 4.25, 'B': 4.00, 'B-': 3.75,
    'C+': 3.50, 'C': 3.00, 'C-': 2.50,
    'D+': 2.25, 'D': 2.00, 'D-': 1.75, 'F': 0.00
}

def grade_from_score(s: float) -> str:
    if s >= 95: return 'A+'
    if s >= 90: return 'A'
    if s >= 85: return 'A-'
    if s >= 80: return 'B+'
    if s >= 75: return 'B'
    if s >= 70: return 'B-'
    if s >= 65: return 'C+'
    if s >= 60: return 'C'
    if s >= 55: return 'C-'
    if s >= 50: return 'D+'
    if s >= 45: return 'D'
    return 'F'

# Map approximate midpoint scores for each grade letter
GRADE_TO_SCORE = {
    'A+': 97, 'A': 92, 'A-': 87, 'B+': 82, 'B': 77, 'B-': 72,
    'C+': 67, 'C': 62, 'C-': 57, 'D+': 52, 'D': 47, 'D-': 44, 'F': 0
}

def resolve_grade(course: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns { "grade": 'A+', "points": 5.00, "score": 97 }
    """
    grade = course.get("grade")
    score = float(course.get("score")) if course.get("score") is not None else None
    points = float(course.get("gradePoints")) if course.get("gradePoints") is not None else None

    if not grade and score is not None:
        grade = grade_from_score(score)
    
    if not grade and points is not None:
        for k, v in GRADE_POINTS.items():
            if abs(v - points) < 0.01:
                grade = k
                break
    
    if grade and points is None:
        points = GRADE_POINTS.get(grade)
    
    if grade and score is None:
        score = GRADE_TO_SCORE.get(grade)

    return {
        "grade": grade or '?',
        "points": points if points is not None else 0.0,
        "score": score if score is not None else 0.0
    }

def generate_diagnostics(semesters: List[Dict[str, Any]] = None, goals: Dict[str, Any] = None) -> Dict[str, Any]:
    semesters = semesters or []
    goals = goals or {}

    all_courses = []
    for sem in semesters:
        for c in sem.get("courses", []):
            resolved = resolve_grade(c)
            if resolved["points"] is None:
                continue
            
            credits_val = float(c.get("credits") or c.get("creditHours") or c.get("hours") or 0)
            all_courses.append({
                **c,
                "_grade": resolved["grade"],
                "_points": resolved["points"],
                "_score": resolved["score"],
                "_semName": sem.get("name", ""),
                "_credits": credits_val
            })

    has_semester_data = len(all_courses) > 0

    # ── Strengths: grade A- and above (points >= 4.50) ──────────
    strengths = sorted(
        [c for c in all_courses if c["_points"] >= 4.50],
        key=lambda x: (-x["_points"], -x["_credits"])
    )[:6]

    # ── Weaknesses: D+ and below (points <= 2.25), passed (not F) ──
    weaknesses = sorted(
        [c for c in all_courses if 0 < c["_points"] <= 2.25],
        key=lambda x: x["_points"]
    )[:5]

    # ── Failed courses ──────────────────────────────────────────
    failed = [c for c in all_courses if c["_points"] == 0 and c["_grade"] == 'F']

    # ── Grade distribution ──────────────────────────────────────
    dist = {"excellent": 0, "good": 0, "acceptable": 0, "poor": 0, "failed": 0}
    for c in all_courses:
        p = c["_points"]
        if p >= 4.50: dist["excellent"] += 1
        elif p >= 3.75: dist["good"] += 1
        elif p >= 2.50: dist["acceptable"] += 1
        elif p > 0: dist["poor"] += 1
        else: dist["failed"] += 1

    # ── Semester trend ──────────────────────────────────────────
    sem_trend = []
    for s in semesters:
        gpa = s.get("gpa")
        if gpa is not None:
            try:
                gpa_val = float(gpa)
                sgpa_val = float(s.get("sgpa")) if s.get("sgpa") is not None else gpa_val
                sem_trend.append({
                    "name": s.get("name", "—"),
                    "gpa": gpa_val,
                    "sgpa": sgpa_val
                })
            except (ValueError, TypeError):
                continue

    best_sem = max(sem_trend, key=lambda x: x["sgpa"]) if sem_trend else None
    worst_sem = min(sem_trend, key=lambda x: x["sgpa"]) if sem_trend else None

    # ── GPA trend direction ─────────────────────────────────────
    trend_dir = 'stable'
    if len(sem_trend) >= 2:
        last2 = sem_trend[-2:]
        diff = last2[1]["gpa"] - last2[0]["gpa"]
        if diff > 0.1: trend_dir = 'rising'
        elif diff < -0.1: trend_dir = 'falling'
        else: trend_dir = 'stable'

    # ── Goal calculator ─────────────────────────────────────────
    current_gpa = float(goals.get("currentGpa") or 0)
    earned_hours = float(goals.get("earnedHours") or 0)
    target_gpa = float(goals.get("targetGpa")) if goals.get("targetGpa") is not None else None
    total_points = float(goals.get("totalPoints") or (current_gpa * earned_hours))

    goal_calc_results = []
    if target_gpa:
        for term_hours in [9, 12, 15, 18, 21]:
            # Formula: neededTermGpa = (target*(earned+S) - currentPoints) / S
            current_points = total_points or (current_gpa * earned_hours)
            needed = ((target_gpa * (earned_hours + term_hours)) - current_points) / term_hours
            feasible = 0 <= needed <= 5.0
            
            label = 'غير ممكن' if needed > 5 else \
                    'صعب جداً' if needed > 4.5 else \
                    'محتاج تركيز' if needed > 3.5 else \
                    'ممكن' if needed > 2.5 else 'سهل'
            
            goal_calc_results.append({
                "termHours": term_hours,
                "needed": round(min(5.0, max(0.0, needed)), 2),
                "feasible": feasible,
                "label": label
            })

    # ── Personalized insight sentences ─────────────────────────
    insights = []
    if has_semester_data:
        if strengths:
            top_strengths = " و ".join([c["name"] for c in strengths[:2]])
            insights.append({
                "type": "success",
                "icon": "⭐",
                "text": f"أداؤك استثنائي في {len(strengths)} مادة — أبرزها: {top_strengths}."
            })
        if weaknesses:
            top_weaknesses = " و ".join([c["name"] for c in weaknesses[:2]])
            insights.append({
                "type": "warning",
                "icon": "⚠️",
                "text": f"تحتاج لمراجعة أساسيات: {top_weaknesses}."
            })
        if trend_dir == 'rising':
            insights.append({"type": "success", "icon": "📈", "text": "معدلك في تحسّن مستمر — استمر على هذا المنوال!"})
        elif trend_dir == 'falling':
            insights.append({"type": "danger", "icon": "📉", "text": "معدلك في انخفاض — راجع استراتيجيتك الدراسية."})
        
        if dist["excellent"] > 0:
            pct = round((dist["excellent"] / len(all_courses)) * 100)
            insights.append({"type": "info", "icon": "🏅", "text": f"{pct}% من موادك بتقدير ممتاز (A- أو أعلى)."})
        
        if failed:
            insights.append({"type": "danger", "icon": "🚨", "text": f"لديك {len(failed)} مادة راسب — تأكد من الإعادة أو التحسين."})

    return {
        "hasSemesterData": has_semester_data,
        "allCourses": all_courses,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "failed": failed,
        "dist": dist,
        "semTrend": sem_trend,
        "bestSem": best_sem,
        "worstSem": worst_sem,
        "trendDir": trend_dir,
        "goalCalcResults": goal_calc_results,
        "insights": insights,
        "meta": {
            "currentGpa": current_gpa,
            "earnedHours": earned_hours,
            "targetGpa": target_gpa,
            "totalPoints": total_points
        }
    }

def calc_required_sgpa(current_gpa: float, earned_hours: float, total_points: Optional[float], target_gpa: float, term_hours: float) -> Dict[str, Any]:
    pts = total_points or (current_gpa * earned_hours)
    s = float(term_hours or 15)
    target = float(target_gpa)
    needed = ((target * (earned_hours + s)) - pts) / s
    
    return {
        "needed": round(min(5.0, max(0.0, needed)), 2),
        "feasible": 0 <= needed <= 5.0,
        "impossible": needed > 5.0,
        "easy": needed <= 2.5
    }
