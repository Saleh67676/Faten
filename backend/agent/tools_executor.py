"""
================================================================
UQU AGENT — Tools Executor (v3.0 — 13 Tools)
================================================================
Executes AI agent tool calls and writes results to Firestore.
Saudi 5-point GPA scale used throughout.
Includes Personalized Semester Planner with learning-style DNA.
"""

from datetime import datetime, timezone, timedelta
from google.cloud.firestore_v1 import ArrayUnion


def _load_latest_transcript(user_ref):
    snaps = (user_ref.collection("transcripts")
             .order_by("createdAt", direction="DESCENDING")
             .limit(1).get())
    docs = list(snaps)
    if docs:
        return docs[0].to_dict()

    snaps = (user_ref.collection("academic_records")
             .where("type", "==", "transcript")
             .order_by("createdAt", direction="DESCENDING")
             .limit(1).get())
    docs = list(snaps)
    return docs[0].to_dict() if docs else None


async def execute_tool(
    tool_name: str,
    args: dict,
    user_id: str,
    db
) -> dict:
    """Execute a tool call and write result to Firestore.

    Args:
        tool_name: Name of the tool to execute
        args: Parsed arguments from the AI model
        user_id: Firebase user ID
        db: Firestore client

    Returns:
        Result dict sent back to the AI model
    """
    user_ref = db.collection("users").document(user_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── 1. Add Exam ──
    if tool_name == "add_upcoming_exam":
        exam = {
            "subject":     args["subject"],
            "date":        args["date"],
            "time":        args.get("time"),
            "course_code": args.get("course_code"),
            "exam_type":   args.get("exam_type", "exam"),
            "notes":       args.get("notes", ""),
            "createdAt":   now_iso,
            "done":        False,
        }
        _, ref = user_ref.collection("exams").add(exam)
        return {
            "success": True,
            "id": ref.id,
            "message": f"تم تسجيل اختبار \"{args['subject']}\" بتاريخ {args['date']}"
        }

    # ── 2. Create Study Plan ──
    elif tool_name == "create_study_plan":
        timestamp = int(datetime.now().timestamp() * 1000)
        tasks = []
        for i, t in enumerate(args.get("tasks", [])):
            tasks.append({
                "id":       f"task_{timestamp}_{i}",
                "title":    t["title"],
                "subject":  t["subject"],
                "duration": t.get("duration", 60),
                "date":     t.get("date", datetime.now().strftime("%Y-%m-%d")),
                "priority": t.get("priority", "medium"),
                "notes":    t.get("notes", ""),
                "done":     False,
            })

        plan = {
            "title":     args["title"],
            "deadline":  args.get("deadline"),
            "tasks":     tasks,
            "createdAt": now_iso,
            "active":    True,
        }
        _, ref = user_ref.collection("study_plans").add(plan)
        return {
            "success": True,
            "id": ref.id,
            "tasks_count": len(tasks),
            "message": f"تم إنشاء الخطة \"{args['title']}\" بـ {len(tasks)} مهام"
        }

    # ── 3. Send Notification ──
    elif tool_name == "send_notification":
        notif_type = args.get("type", "info")
        default_title = "💪 رسالة تحفيز" if notif_type == "motivational" else "🔔 تنبيه"
        notif = {
            "title":     args.get("title", default_title),
            "message":   args["message"],
            "type":      notif_type,
            "read":      False,
            "createdAt": now_iso,
        }
        user_ref.collection("notifications").add(notif)
        return {"success": True, "message": "تم إرسال الإشعار"}

    # ── 4. Get Student Data ──
    elif tool_name == "get_student_data":
        section = args.get("section", "all")
        data = {}

        if section in ("all", "profile"):
            snap = user_ref.get()
            data["profile"] = snap.to_dict() if snap.exists else {}

        if section in ("all", "transcript"):
            data["transcript"] = _load_latest_transcript(user_ref)

        if section in ("all", "exams"):
            snaps = (user_ref.collection("exams")
                     .where("done", "==", False)
                     .order_by("date")
                     .get())
            data["exams"] = [{"id": d.id, **d.to_dict()} for d in snaps]

        if section in ("all", "study_plan"):
            snaps = (user_ref.collection("study_plans")
                     .where("active", "==", True)
                     .order_by("createdAt", direction="DESCENDING")
                     .limit(1).get())
            docs = list(snaps)
            data["study_plan"] = docs[0].to_dict() if docs else None

        if section in ("all", "preferences"):
            snap = user_ref.get()
            doc = snap.to_dict() if snap.exists else {}
            data["preferences"] = doc.get("study_preferences", {})

        return {"success": True, "data": data}

    # ── 5. Analyze Transcript ──
    elif tool_name == "analyze_transcript":
        transcript = _load_latest_transcript(user_ref)
        if not transcript:
            return {"success": False, "message": "لا يوجد سجل أكاديمي محفوظ بعد"}
        courses = transcript.get("courses", [])

        # Grade point mapping (4.0 scale — synced with frontend core.js)
        GP = {
            "A+": 4.00, "A": 4.00, "A-": 3.67,
            "B+": 3.33, "B": 3.00, "B-": 2.67,
            "C+": 2.33, "C": 2.00, "C-": 1.67,
            "D+": 1.33, "D": 1.00, "D-": 0.67,
            "F":  0.00,
        }

        scored = []
        def normalize_grade(g):
            if not g: return ""
            return str(g).strip().upper().replace(" ", "")

        for c in courses:
            raw_grade = c.get("grade") or c.get("letterGrade") or c.get("finalGrade") or c.get("courseGrade") or c.get("result") or ""
            grade_str = normalize_grade(raw_grade)
            
            gp = GP.get(grade_str)
            if gp is None:
                try:
                    gp = float(grade_str)
                except (ValueError, TypeError):
                    gp = 0
            
            # Also check numeric scores if gp is 0 and we have a score
            if gp == 0:
                raw_score = c.get("numericGrade") or c.get("score") or c.get("mark")
                if raw_score:
                    try:
                        score_val = float(raw_score)
                        if score_val >= 95: gp = 4.0
                        elif score_val >= 90: gp = 4.0
                        elif score_val >= 85: gp = 3.67
                        elif score_val >= 80: gp = 3.33
                        elif score_val >= 75: gp = 3.0
                        elif score_val >= 70: gp = 2.67
                        elif score_val >= 65: gp = 2.33
                        elif score_val >= 60: gp = 2.0
                        elif score_val >= 50: gp = 1.0
                    except (ValueError, TypeError):
                        pass

            scored.append({**c, "gp": gp, "norm_grade": grade_str})

        weaknesses = sorted([c for c in scored if c["gp"] < 2.5 and c["gp"] > 0], key=lambda x: x["gp"])
        strengths = [c for c in scored if c["gp"] >= 3.33 or c["norm_grade"] in ["A+", "A", "B+"]]

        if scored:
            total_weighted = sum(c["gp"] * (c.get("credit_hours") or c.get("creditHours") or 3) for c in scored)
            total_hours = sum((c.get("credit_hours") or c.get("creditHours") or 3) for c in scored)
            avg_gpa = round(total_weighted / total_hours, 2) if total_hours else 0
        else:
            avg_gpa = 0

        # Save analysis to Firestore
        user_ref.update({
            "analysis.weaknesses": [c.get("name", "") for c in weaknesses],
            "analysis.strengths":  [c.get("name", "") for c in strengths],
            "analysis.cgpa":       avg_gpa,
            "analysis.updatedAt":  now_iso,
        })

        # Read targetGpa from profile for the response
        profile = user_data.get("profile", {}) if (user_data := user_ref.get().to_dict()) else {}
        target_gpa = profile.get("targetGpa") or 4.0

        return {
            "success": True,
            "focus": args.get("focus", "full"),
            "average_gpa":   str(avg_gpa),
            "currentGpa":    avg_gpa,
            "targetGpa":     float(target_gpa),
            "total_courses": len(courses),
            "gradedCourses": len(scored),
            "weaknesses":    [f"{c.get('name', '')} ({c.get('grade', '')})" for c in weaknesses[:5]],
            "strengths":     [f"{c.get('name', '')} ({c.get('grade', '')})" for c in strengths[:5]],
        }

    # ── 6. Update Profile ──
    elif tool_name == "update_profile":
        field = args["field"]
        value = args["value"]
        user_ref.update({
            f"profile.{field}": value,
            "updatedAt": now_iso,
        })
        return {"success": True, "message": f"تم تحديث {field}"}

    # ── 7. Get Upcoming Exams ──
    elif tool_name == "get_upcoming_exams":
        today = datetime.now().strftime("%Y-%m-%d")
        limit = args.get("limit", 10)
        snaps = (user_ref.collection("exams")
                 .where("date", ">=", today)
                 .where("done", "==", False)
                 .order_by("date")
                 .limit(limit)
                 .get())
        exams = [{"id": d.id, **d.to_dict()} for d in snaps]
        return {"success": True, "exams": exams, "count": len(exams)}

    # ── 8. Add Course ──
    elif tool_name == "add_course":
        # Accept both camelCase (frontend) and snake_case (backend schema)
        credit_hrs = args.get("credit_hours") or args.get("creditHours", 3)
        course = {
            "name":         args["name"],
            "code":         args.get("code", ""),
            "credit_hours": credit_hrs,
            "creditHours":  credit_hrs,  # dual-key for frontend compatibility
            "difficulty":   args.get("difficulty", "medium"),
            "examDate":     args.get("examDate") or args.get("exam_date", ""),
            "addedAt":      now_iso,
        }
        user_ref.update({
            "profile.courses": ArrayUnion([course])
        })
        return {"success": True, "message": f"تمت إضافة مادة \"{args['name']}\""}

    # ── 9. Complete Task ──
    elif tool_name == "complete_task":
        snaps = (user_ref.collection("study_plans")
                 .where("active", "==", True)
                 .order_by("createdAt", direction="DESCENDING")
                 .limit(1).get())
        docs = list(snaps)
        if not docs:
            return {"success": False, "message": "لا توجد خطة نشطة"}

        plan_doc = docs[0]
        plan_data = plan_doc.to_dict()
        tasks = plan_data.get("tasks", [])
        found = False

        # Accept both task_name (backend) and task_title (frontend)
        search_name = args.get("task_name") or args.get("task_title", "")

        updated_tasks = []
        for t in tasks:
            if t.get("id") == args.get("task_id") or (
                search_name and search_name in t.get("title", "")
            ):
                found = True
                updated_tasks.append({**t, "done": True, "doneAt": now_iso})
            else:
                updated_tasks.append(t)

        if not found:
            return {"success": False, "message": "لم يتم العثور على المهمة"}

        plan_doc.reference.update({"tasks": updated_tasks})
        return {"success": True, "message": "تم تحديد المهمة كمنجزة ✅"}

    # ═══════════════════════════════════════════════════════════════
    #  SUPER-AGENT TOOLS (v2.0)
    # ═══════════════════════════════════════════════════════════════

    # ── 10. Modify Study Session ──
    elif tool_name == "modify_study_session":
        snaps = (user_ref.collection("study_plans")
                 .where("active", "==", True)
                 .order_by("createdAt", direction="DESCENDING")
                 .limit(1).get())
        docs = list(snaps)
        if not docs:
            return {"success": False, "message": "لا توجد خطة دراسية نشطة لتعديلها"}

        plan_doc = docs[0]
        plan_data = plan_doc.to_dict()
        tasks = plan_data.get("tasks", [])

        # Find the task to modify
        search_name = args.get("task_name") or args.get("task_id", "")
        found_idx = -1
        for idx, t in enumerate(tasks):
            if t.get("id") == args.get("task_id") or (
                search_name and search_name in t.get("title", "")
            ):
                found_idx = idx
                break

        if found_idx == -1:
            return {"success": False, "message": f"لم أجد مهمة باسم '{search_name}' في الخطة الحالية"}

        # Apply modifications
        task = tasks[found_idx]
        changes = []

        if args.get("new_date"):
            task["date"] = args["new_date"]
            changes.append(f"التاريخ → {args['new_date']}")
        if args.get("new_time"):
            task["time"] = args["new_time"]
            changes.append(f"الوقت → {args['new_time']}")
        if args.get("new_duration"):
            task["duration"] = args["new_duration"]
            changes.append(f"المدة → {args['new_duration']} دقيقة")
        if args.get("new_subject"):
            task["subject"] = args["new_subject"]
            changes.append(f"المادة → {args['new_subject']}")
        if args.get("new_priority"):
            task["priority"] = args["new_priority"]
            changes.append(f"الأولوية → {args['new_priority']}")

        if not changes:
            return {"success": False, "message": "لم يتم تحديد أي تغييرات"}

        # Record modification history
        task["modifiedAt"] = now_iso
        task["modificationReason"] = args.get("reason", "")

        tasks[found_idx] = task
        plan_doc.reference.update({"tasks": tasks})

        changes_str = "، ".join(changes)
        return {
            "success": True,
            "message": f"✏️ تم تعديل \"{task.get('title', '')}\": {changes_str}",
            "modified_task": task,
        }

    # ── 11. Predict GPA Pathway ──
    elif tool_name == "predict_gpa_pathway":
        # Read profile for goals and current courses
        snap = user_ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        profile = user_data.get("profile", {})
        prefs = user_data.get("study_preferences", {})

        # Read transcript for completed courses
        transcript = _load_latest_transcript(user_ref)

        # Grade point mapping (4.0 scale — synced with frontend core.js)
        GP = {
            "A+": 4.00, "A": 4.00, "A-": 3.67,
            "B+": 3.33, "B": 3.00, "B-": 2.67,
            "C+": 2.33, "C": 2.00, "C-": 1.67,
            "D+": 1.33, "D": 1.00, "D-": 0.67,
            "F":  0.00,
        }
        GRADE_LABELS = {
            4.00: "A+", 3.67: "A-",
            3.33: "B+", 3.00: "B",  2.67: "B-",
            2.33: "C+", 2.00: "C",  1.67: "C-",
            1.33: "D+", 1.00: "D",  0.67: "D-",
            0.00: "F",
        }

        # Calculate current quality points from transcript
        completed_hours = 0
        total_quality_points = 0.0

        if transcript:
            for c in transcript.get("courses", []):
                grade_str = c.get("grade", "")
                gp = GP.get(grade_str)
                if gp is None:
                    try:
                        gp = float(grade_str)
                    except (ValueError, TypeError):
                        continue
                hrs = c.get("credit_hours") or c.get("creditHours") or 3
                completed_hours += hrs
                total_quality_points += gp * hrs

        # Also use profile earnedHours/currentGpa if transcript not available
        if completed_hours == 0:
            completed_hours = profile.get("earnedHours", 0) or 0
            current_gpa_val = profile.get("currentGpa", 0) or 0
            total_quality_points = current_gpa_val * completed_hours

        current_gpa = round(total_quality_points / completed_hours, 2) if completed_hours > 0 else 0

        # Target GPA
        target = args.get("target_gpa") or profile.get("targetGpa") or 4.0
        target = float(target)

        # Current semester courses (what the student can still affect)
        current_courses = profile.get("courses", [])
        if not current_courses:
            return {
                "success": False,
                "message": "لا توجد مواد مسجلة في الفصل الحالي لحساب السيناريو"
            }

        current_semester_hours = sum(
            (c.get("credit_hours") or c.get("creditHours") or 3)
            for c in current_courses
        )
        total_planned_hours = completed_hours + current_semester_hours

        # Required total quality points to achieve target
        required_total_qp = target * total_planned_hours
        remaining_qp_needed = required_total_qp - total_quality_points

        if remaining_qp_needed <= 0:
            return {
                "success": True,
                "message": "🎉 أنت بالفعل تتجاوز المعدل المستهدف! استمر هكذا.",
                "current_gpa": str(current_gpa),
                "target_gpa": str(target),
                "status": "already_achieved",
            }

        # Required average GPA this semester
        required_semester_gpa = round(remaining_qp_needed / current_semester_hours, 2)

        if required_semester_gpa > 4.0:
            return {
                "success": True,
                "message": f"⚠️ للأسف، الوصول لمعدل {target} يتطلب معدل فصلي {required_semester_gpa} وهو مستحيل (أعلى من 4.0). جرب هدفاً أقل أو انتظر فصول إضافية.",
                "current_gpa": str(current_gpa),
                "target_gpa": str(target),
                "required_semester_gpa": str(required_semester_gpa),
                "status": "impossible",
            }

        # Generate per-course breakdown based on scenario
        scenario = args.get("scenario", "balanced")
        course_targets = []

        # Find closest grade label
        def closest_grade(gp_val):
            gp_val = max(0, min(4.0, gp_val))
            closest = min(GRADE_LABELS.keys(), key=lambda x: abs(x - gp_val))
            return GRADE_LABELS[closest], closest

        for c in current_courses:
            hrs = c.get("credit_hours") or c.get("creditHours") or 3
            name = c.get("name", "مادة")
            difficulty = c.get("difficulty", "medium")

            if scenario == "minimum":
                # Give harder courses lower targets, easier ones higher
                if difficulty == "hard":
                    needed = min(required_semester_gpa - 0.5, 4.0)
                elif difficulty == "easy":
                    needed = min(required_semester_gpa + 0.5, 4.0)
                else:
                    needed = min(required_semester_gpa, 4.0)
            elif scenario == "ambitious":
                needed = min(required_semester_gpa + 0.5, 4.0)
            else:  # balanced
                needed = min(required_semester_gpa, 4.0)

            grade_label, grade_gp = closest_grade(needed)
            course_targets.append({
                "course": name,
                "credit_hours": hrs,
                "needed_grade": grade_label,
                "needed_gp": grade_gp,
                "difficulty": difficulty,
            })

        return {
            "success": True,
            "current_gpa": str(current_gpa),
            "target_gpa": str(target),
            "completed_hours": completed_hours,
            "current_semester_hours": current_semester_hours,
            "required_semester_gpa": str(required_semester_gpa),
            "scenario": scenario,
            "course_targets": course_targets,
            "status": "achievable",
            "message": f"📊 للوصول لمعدل {target}، تحتاج معدل فصلي {required_semester_gpa} هذا الفصل.",
        }

    # ── 12. Update Learning Preferences ──
    elif tool_name == "update_learning_preferences":
        field = args["field"]
        value = args["value"]
        reason = args.get("reason", "")

        # Validate field names
        valid_fields = {
            "best_time", "study_hours", "method",
            "focus_length", "study_speed", "stress_level",
        }
        if field not in valid_fields:
            return {"success": False, "message": f"حقل غير صالح: {field}"}

        # Convert numeric values
        if field in ("study_hours", "focus_length"):
            try:
                value = int(value)
            except (ValueError, TypeError):
                pass

        user_ref.update({
            f"study_preferences.{field}": value,
            "updatedAt": now_iso,
        })

        # Friendly field names for response
        field_labels = {
            "best_time": "وقت المذاكرة المفضل",
            "study_hours": "ساعات الدراسة اليومية",
            "method": "أسلوب المذاكرة",
            "focus_length": "مدة التركيز",
            "study_speed": "سرعة الدراسة",
            "stress_level": "مستوى التوتر",
        }
        label = field_labels.get(field, field)
        msg = f"✅ تم تحديث {label} إلى: {value}"
        if reason:
            msg += f" (السبب: {reason})"

        return {"success": True, "message": msg}

    # ═══════════════════════════════════════════════════════════════
    #  13. GENERATE SEMESTER MASTER PLAN (Personalized Planner)
    # ═══════════════════════════════════════════════════════════════

    elif tool_name == "generate_semester_master_plan":
        # ── 1. Read student profile & preferences ──
        snap = user_ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        profile = user_data.get("profile", {})
        prefs = user_data.get("study_preferences", {})
        analysis_data = user_data.get("analysis", {})

        courses = profile.get("courses", [])
        if not courses:
            return {
                "success": False,
                "message": "لا توجد مواد مسجلة في الفصل الحالي. أضف موادك أولاً من صفحة البروفايل."
            }

        # ── 2. Extract learning DNA ──
        peak_time = prefs.get("best_time", "evening")        # morning/evening/night
        speed = prefs.get("study_speed", "normal")            # slow/normal/fast
        stress = prefs.get("stress_level", "normal")          # low/normal/high/critical
        focus_mins = prefs.get("focus_length", 25)            # pomodoro length
        daily_study_hours = args.get("daily_hours") or prefs.get("study_hours") or 4
        study_method = prefs.get("method", "")
        total_weeks = int(args.get("weeks", 16))
        include_weekends = args.get("include_weekends", False)
        focus_mode = args.get("focus_mode", "balanced")

        # Speed adjustments
        speed_multiplier = {"slow": 1.4, "normal": 1.0, "fast": 0.8}.get(speed, 1.0)
        break_minutes = {"slow": 15, "normal": 10, "fast": 5}.get(speed, 10)

        # Peak time → preferred slot mapping
        time_slots = {
            "morning": {"hard": "08:00", "medium": "10:00", "easy": "12:00"},
            "evening": {"hard": "16:00", "medium": "18:00", "easy": "20:00"},
            "night":   {"hard": "20:00", "medium": "22:00", "easy": "14:00"},
        }
        slots = time_slots.get(peak_time, time_slots["evening"])

        # ── 3. Read transcript for weakness weighting ──
        GP = {
            "A+": 4.00, "A": 4.00, "A-": 3.67,
            "B+": 3.33, "B": 3.00, "B-": 2.67,
            "C+": 2.33, "C": 2.00, "C-": 1.67,
            "D+": 1.33, "D": 1.00, "D-": 0.67,
            "F":  0.00,
        }

        weak_subjects = set(analysis_data.get("weaknesses", []))

        # Also check transcript directly for subject performance
        t_snaps = (user_ref.collection("transcripts")
                   .order_by("createdAt", direction="DESCENDING")
                   .limit(1).get())
        t_docs = list(t_snaps)
        subject_history = {}  # name -> last grade GP
        if t_docs:
            for c in t_docs[0].to_dict().get("courses", []):
                gp = GP.get(c.get("grade", ""), None)
                if gp is not None:
                    subject_history[c.get("name", "")] = gp

        # ── 4. Compute per-course weight (intelligent allocation) ──
        course_weights = []
        total_weight = 0

        for c in courses:
            name = c.get("name", "")
            difficulty = c.get("difficulty", "medium")
            hrs = c.get("credit_hours") or c.get("creditHours") or 3

            # Base weight from credit hours
            weight = hrs

            # Difficulty multiplier
            diff_mult = {"hard": 1.8, "medium": 1.0, "easy": 0.6}.get(difficulty, 1.0)
            weight *= diff_mult

            # Weakness multiplier: if student historically weak → 2x
            historical_gp = subject_history.get(name)
            is_weak = name in weak_subjects or (historical_gp is not None and historical_gp < 3.0)
            if is_weak:
                weight *= 2.0

            # Focus mode adjustments
            if focus_mode == "weakness_recovery" and is_weak:
                weight *= 1.5
            elif focus_mode == "gpa_boost" and difficulty == "easy":
                weight *= 1.3  # easy wins boost GPA fast

            course_weights.append({
                "course": c,
                "name": name,
                "difficulty": difficulty,
                "weight": weight,
                "is_weak": is_weak,
                "credit_hours": hrs,
            })
            total_weight += weight

        # ── 5. Read exam dates for pressure-aware scheduling ──
        today = datetime.now()
        today_str = today.strftime("%Y-%m-%d")

        try:
            e_snaps = (user_ref.collection("exams")
                       .where("done", "==", False)
                       .where("date", ">=", today_str)
                       .order_by("date")
                       .limit(20).get())
            exams = [{"id": d.id, **d.to_dict()} for d in e_snaps]
        except Exception:
            exams = []

        # Map exam dates by subject
        exam_dates = {}  # subject -> date string
        for ex in exams:
            subj = ex.get("subject", "")
            exam_dates[subj] = ex.get("date", "")

        # ── 6. Generate weekly plan ──
        daily_mins = daily_study_hours * 60
        study_days = 7 if include_weekends else 5  # Sun-Thu (skip Fri/Sat)

        all_tasks = []
        plan_start = today
        timestamp = int(today.timestamp() * 1000)

        # Day name mapping (0=Mon → Arabic calendar starts Sunday)
        DAY_NAMES_AR = [
            "الإثنين", "الثلاثاء", "الأربعاء", "الخميس",
            "الجمعة", "السبت", "الأحد"
        ]

        for week_num in range(total_weeks):
            week_start = plan_start + timedelta(weeks=week_num)

            for day_offset in range(7):
                day_date = week_start + timedelta(days=day_offset)
                weekday = day_date.weekday()  # 0=Mon

                # Skip weekends if not included (Fri=4, Sat=5)
                if not include_weekends and weekday in (4, 5):
                    continue

                date_str = day_date.strftime("%Y-%m-%d")
                day_mins_remaining = daily_mins

                # ── Stress Buffer: light day before exams ──
                is_pre_exam = False
                pre_exam_subject = None
                for subj, ex_date in exam_dates.items():
                    try:
                        ex_dt = datetime.fromisoformat(ex_date)
                        days_to_exam = (ex_dt - day_date).days
                        if 0 <= days_to_exam <= 2:
                            is_pre_exam = True
                            pre_exam_subject = subj
                    except (ValueError, TypeError):
                        pass

                # If high stress + pre-exam → buffer day (lighter load)
                if stress in ("high", "critical") and is_pre_exam:
                    # Dedicate 80% of time to exam subject, rest is break
                    exam_mins = int(daily_mins * 0.8)
                    session_duration = int(focus_mins * speed_multiplier)

                    all_tasks.append({
                        "id": f"task_{timestamp}_{len(all_tasks)}",
                        "title": f"🚨 مراجعة مكثفة: {pre_exam_subject}",
                        "subject": pre_exam_subject,
                        "duration": exam_mins,
                        "date": date_str,
                        "time": slots.get("hard", "16:00"),
                        "priority": "high",
                        "notes": f"يوم تحضيري للاختبار — ركّز على {pre_exam_subject}",
                        "done": False,
                        "type": "exam_prep",
                        "is_buffer": True,
                    })
                    continue  # Skip normal scheduling for this day

                # ── Normal day: distribute by weight ──
                for cw in sorted(course_weights, key=lambda x: -x["weight"]):
                    if day_mins_remaining <= 0:
                        break

                    # Proportion of daily time for this course
                    share = cw["weight"] / total_weight
                    course_mins = int(daily_mins * share)

                    # Speed adjustment
                    course_mins = int(course_mins * speed_multiplier)
                    course_mins = max(focus_mins, min(course_mins, day_mins_remaining))

                    # Determine time slot based on difficulty
                    diff = cw["difficulty"]
                    slot_time = slots.get(diff, slots.get("medium", "16:00"))

                    # Priority from weakness
                    priority = "high" if cw["is_weak"] else (
                        "high" if diff == "hard" else "medium" if diff == "medium" else "low"
                    )

                    # Notes with personality
                    notes_parts = []
                    if cw["is_weak"]:
                        notes_parts.append("⚠️ مادة تحتاج تقوية")
                    if diff == "hard":
                        notes_parts.append(f"🎯 تركيز عميق {focus_mins} دقيقة + راحة {break_minutes} دق")
                    if study_method:
                        notes_parts.append(f"📚 أسلوب: {study_method}")

                    exam_dt_str = exam_dates.get(cw["name"])
                    if exam_dt_str:
                        try:
                            days_to = (datetime.fromisoformat(exam_dt_str) - day_date).days
                            if 0 < days_to <= 7:
                                notes_parts.append(f"🚨 اختبار بعد {days_to} أيام!")
                        except (ValueError, TypeError):
                            pass

                    all_tasks.append({
                        "id": f"task_{timestamp}_{len(all_tasks)}",
                        "title": f"مذاكرة: {cw['name']}",
                        "subject": cw["name"],
                        "duration": course_mins,
                        "date": date_str,
                        "time": slot_time,
                        "priority": priority,
                        "notes": " | ".join(notes_parts) if notes_parts else "",
                        "done": False,
                        "type": "study",
                        "courseCode": cw["course"].get("code", ""),
                    })

                    day_mins_remaining -= course_mins

        # ── 7. Deactivate old plans & save new master plan ──
        old_plans = (user_ref.collection("study_plans")
                     .where("active", "==", True).get())
        for old in old_plans:
            old.reference.update({"active": False})

        plan_title = "🎯 الخطة الفصلية الذكية"
        plan = {
            "title": plan_title,
            "tasks": all_tasks,
            "createdAt": now_iso,
            "active": True,
            "type": "semester_master",
            "weeks": total_weeks,
            "focus_mode": focus_mode,
            "personalization": {
                "peak_time": peak_time,
                "speed": speed,
                "stress": stress,
                "focus_mins": focus_mins,
                "daily_hours": daily_study_hours,
                "method": study_method,
            },
            "subject_weights": [
                {"name": cw["name"], "weight": round(cw["weight"], 1),
                 "is_weak": cw["is_weak"], "difficulty": cw["difficulty"]}
                for cw in course_weights
            ],
        }
        _, ref = user_ref.collection("study_plans").add(plan)

        # ── 8. Build summary ──
        weak_courses = [cw["name"] for cw in course_weights if cw["is_weak"]]
        hard_courses = [cw["name"] for cw in course_weights if cw["difficulty"] == "hard"]

        summary = f"🎯 تم إنشاء خطة فصلية ذكية بـ {len(all_tasks)} جلسة عبر {total_weeks} أسبوع.\n"
        summary += f"⏰ جلساتك في ال{'صباح' if peak_time == 'morning' else 'مساء' if peak_time == 'evening' else 'ليل'} — {daily_study_hours} ساعات/يوم.\n"

        if weak_courses:
            summary += f"⚠️ مواد ضعيفة (وقت مضاعف): {', '.join(weak_courses)}.\n"
        if hard_courses:
            summary += f"📕 مواد صعبة (في وقت الذروة): {', '.join(hard_courses)}.\n"
        if stress in ("high", "critical"):
            summary += "🛡️ تم إضافة أيام تحضيرية مخففة قبل الاختبارات.\n"
        if speed == "slow":
            summary += "🐢 جلسات أطول + استراحات أكثر لتناسب أسلوبك.\n"
        elif speed == "fast":
            summary += "🏃 جلسات مركزة وسريعة لتناسب أسلوبك.\n"

        return {
            "success": True,
            "plan_id": ref.id,
            "total_sessions": len(all_tasks),
            "weeks": total_weeks,
            "focus_mode": focus_mode,
            "weak_courses": weak_courses,
            "hard_courses": hard_courses,
            "message": summary,
        }

    # ── 14. Navigate to Page (client-only — frontend handles the redirect) ──
    elif tool_name == "navigate_to_page":
        pages = {
            "dashboard": "dashboard.html",
            "gpa":       "gpa.html",
            "plan":      "plan.html",
            "pomodoro":  "pomodoro.html",
            "locations": "locations.html",
            "profile":   "profile.html",
            "chat":      "chat.html",
        }
        page = args.get("page", "dashboard")
        url  = pages.get(page, "dashboard.html")
        labels = {
            "dashboard": "اللوحة", "gpa": "المعدل", "plan": "الخطة",
            "pomodoro": "بومودورو", "locations": "القاعات",
            "profile": "الملف الشخصي", "chat": "الدردشة",
        }
        return {
            "success": True,
            "client_only": True,
            "url": url,
            "page": page,
            "message": f"جارٍ فتح صفحة {labels.get(page, page)}...",
        }

    # ── 15. Change Theme (client-only — frontend applies the theme) ──
    elif tool_name == "change_theme":
        theme = args.get("theme", "auto")
        label = {"dark": "الوضع الليلي 🌙", "light": "الوضع النهاري ☀️", "auto": "التلقائي 🌗"}.get(theme, theme)
        return {
            "success": True,
            "client_only": True,
            "theme": theme,
            "message": f"تم التغيير إلى {label}",
        }

    # ── 16. Get GPA History ──
    elif tool_name == "get_gpa_history":
        limit = int(args.get("limit", 20))
        sem_snaps = (user_ref.collection("semesters")
                     .order_by("createdAt", direction="ASCENDING")
                     .limit(limit).get())
        semesters = [{"id": d.id, **d.to_dict()} for d in sem_snaps]
        return {"success": True, "semesters": semesters, "count": len(semesters)}

    # ── 17. Add Semester GPA ──
    elif tool_name == "add_semester_gpa":
        semester = {
            "name":      args["name"],
            "gpa":       float(args["gpa"]),
            "hours":     args.get("hours", 0),
            "createdAt": now_iso,
        }
        _, ref = user_ref.collection("semesters").add(semester)
        # Keep profile.currentGpa in sync
        user_ref.update({
            "profile.currentGpa": float(args["gpa"]),
            "updatedAt": now_iso,
        })
        return {
            "success": True,
            "id": ref.id,
            "message": f"تم تسجيل {args['name']} بمعدل {args['gpa']} / 4.00",
        }

    # ── 18. Update Course Grade ──
    elif tool_name == "update_course_grade":
        import re as _re

        def _norm(s: str) -> str:
            if not s:
                return ""
            s = _re.sub(r"[أإآ]", "ا", s)
            s = _re.sub(r"ة", "ه", s)
            return s.lower().strip()

        snap = user_ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        courses = user_data.get("profile", {}).get("courses", [])

        course_name = args["course_name"]
        grade       = float(args["grade"])

        found = False
        for c in courses:
            if _norm(course_name) in _norm(c.get("name", "")) or \
               _norm(c.get("name", "")) in _norm(course_name):
                c["grade"]     = grade
                c["updatedAt"] = now_iso
                found = True
                break

        if not found:
            return {"success": False, "message": f"لم أجد مادة باسم: {course_name}"}

        user_ref.update({"profile.courses": courses, "updatedAt": now_iso})
        return {
            "success": True,
            "message": f"تم تحديث درجة {course_name} إلى {grade} / 4.00",
        }

    # ── Unknown tool ──
    else:
        return {"success": False, "message": f"أداة غير معروفة: {tool_name}"}

