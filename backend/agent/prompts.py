"""
================================================================
UQU AGENT — Hyper-Contextual System Prompts (v2.0)
================================================================
Builds a deeply personalized system prompt that makes the Agent
feel like it truly "knows" the student.
"""

from datetime import datetime


# ── Grade-point mapping (4.0 scale — synced with frontend core.js) ──
GP_MAP = {
    "A+": 4.00, "A": 4.00, "A-": 3.67,
    "B+": 3.33, "B": 3.00, "B-": 2.67,
    "C+": 2.33, "C": 2.00, "C-": 1.67,
    "D+": 1.33, "D": 1.00, "D-": 0.67,
    "F":  0.00,
}


def build_system_prompt(
    user_data: dict | None = None,
    transcript: dict | None = None,
    upcoming_exams: list | None = None,
    active_plan: dict | None = None
) -> str:
    """Build a concise, contextual system prompt.

    Focus on essential info only to save tokens.
    """
    user_data = user_data or {}
    upcoming_exams = upcoming_exams or []

    profile = user_data.get("profile", {})
    prefs = user_data.get("study_preferences", {})

    prompt = """أنت "فطن" — مساعد أكاديمي ذكي لجامعة أم القرى.
• متخصص في النظام السعودي (مقياس 5 نقاط).
• موجز وعملي. استخدم أدواتك لتنفيذ الإجراءات.
• لا تخترع بيانات غير موجودة.
"""

    # Add key student info if available
    if profile.get("name"):
        prompt += f"\nالطالب: {profile['name']}"
    if profile.get("currentGpa"):
        prompt += f" | معدل: {profile['currentGpa']}/4.0"
    if profile.get("targetGpa"):
        prompt += f" | هدف: {profile['targetGpa']}/4.0"
    if profile.get("earnedHours"):
        prompt += f" | ساعات منجزة: {profile['earnedHours']}"
    if profile.get("planHours"):
        remaining = max(0, (profile.get("planHours") or 0) - (profile.get("earnedHours") or 0))
        prompt += f" | ساعات الخطة: {profile['planHours']} | متبقية: {remaining}"
    if profile.get("termPlanHours"):
        prompt += f" | ساعات الفصل: {profile['termPlanHours']}"

    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    analysis = user_data.get("analysis", {})

    # Add upcoming exams if any
    if upcoming_exams:
        prompt += "\nامتحانات قادمة:"
        for exam in upcoming_exams[:3]:  # Limit to 3 exams
            prompt += f" • {exam.get('subject', '')} في {exam.get('date', '')}"

    if prefs:
        prompt += "\n═══ 🧠 شخصية التعلم ═══\n"

        time_map = {"morning": "🌅 صباحي", "evening": "🌆 مسائي", "night": "🌙 ليلي"}
        speed_map = {"slow": "🐢 بطيء ومتأنٍ", "normal": "🚶 معتدل", "fast": "🏃 سريع"}
        stress_map = {
            "low": "😌 مرتاح", "normal": "🙂 طبيعي",
            "high": "😰 مرتفع", "critical": "🔴 حرج — يحتاج دعم فوري"
        }

        if prefs.get("best_time"):
            prompt += f"  • وقت الذروة: {time_map.get(prefs['best_time'], prefs['best_time'])}\n"
        if prefs.get("study_hours"):
            prompt += f"  • ساعات يومية: {prefs['study_hours']} ساعة\n"
        if prefs.get("method"):
            prompt += f"  • أسلوب المذاكرة: {prefs['method']}\n"
        if prefs.get("focus_length"):
            prompt += f"  • مدة التركيز: {prefs['focus_length']} دقيقة (جلسة بومودورو)\n"
        if prefs.get("study_speed"):
            prompt += f"  • سرعة الدراسة: {speed_map.get(prefs['study_speed'], prefs['study_speed'])}\n"
        if prefs.get("stress_level"):
            stress = prefs["stress_level"]
            prompt += f"  • مستوى التوتر: {stress_map.get(stress, stress)}\n"
            if stress in ("high", "critical"):
                prompt += "  ⚠️ تنبيه: الطالب متوتر — كن لطيفاً ومشجعاً بشكل خاص. اقترح تقليل الحمل والراحة.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 4: Current Semester Workload
    # ══════════════════════════════════════════════════
    courses = profile.get("courses", [])
    if courses:
        total_hours = sum(
            (c.get("credit_hours") or c.get("creditHours") or 3)
            for c in courses
        )
        hard_count = sum(1 for c in courses if c.get("difficulty") == "hard")
        easy_count = sum(1 for c in courses if c.get("difficulty") == "easy")
        medium_count = len(courses) - hard_count - easy_count

        prompt += f"\n═══ 📚 عبء الفصل الحالي ({len(courses)} مادة — {total_hours} ساعة) ═══\n"

        if hard_count >= 3:
            prompt += "🔴 تحذير: حمل دراسي ثقيل جداً! أعط أولوية للمواد الصعبة.\n"

        for c in courses:
            code_str = f" ({c.get('code')})" if c.get("code") else ""
            hrs = c.get("credit_hours") or c.get("creditHours") or 3
            line = f"  • {c.get('name', '')}{code_str} — {hrs} ساعة"

            diff = c.get("difficulty", "medium")
            diff_labels = {"hard": "🔴 صعبة", "medium": "🟡 متوسطة", "easy": "🟢 سهلة"}
            line += f" | {diff_labels.get(diff, diff)}"

            exam_date = c.get("examDate") or c.get("exam_date")
            if exam_date:
                try:
                    days = (datetime.fromisoformat(exam_date) - today).days
                    if days <= 0:
                        line += f" | ⚠️ الاختبار اليوم أو فات!"
                    elif days <= 3:
                        line += f" | 🔴 اختبار بعد {days} أيام!"
                    elif days <= 7:
                        line += f" | 🟡 اختبار بعد {days} أيام"
                    else:
                        line += f" | اختبار بعد {days} يوم"
                except (ValueError, TypeError):
                    line += f" | اختبار: {exam_date}"

            if c.get("grade"):
                line += f" | الدرجة الحالية: {c['grade']}"

            prompt += line + "\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 5: GPA History & Trend Analysis
    # ══════════════════════════════════════════════════
    if transcript:
        transcript_courses = transcript.get("courses", [])
        semesters_data = transcript.get("semesters", [])

        if semesters_data:
            prompt += f"\n═══ 📈 مسار المعدل عبر الفصول ({len(semesters_data)} فصل) ═══\n"
            gpas = []
            for sem in semesters_data:
                sem_gpa = sem.get("gpa", 0)
                gpas.append(float(sem_gpa))
                prompt += f"  • {sem.get('name', 'فصل')}: {sem_gpa}\n"

            # Trend analysis
            if len(gpas) >= 2:
                recent = gpas[-1]
                prev = gpas[-2]
                avg_all = sum(gpas) / len(gpas)
                if recent > prev + 0.1:
                    prompt += f"  📊 الاتجاه: صاعد ↗️ (تحسّن بـ {recent - prev:.2f})\n"
                elif recent < prev - 0.1:
                    prompt += f"  📊 الاتجاه: نازل ↘️ (انخفض بـ {prev - recent:.2f}) — يحتاج اهتمام!\n"
                else:
                    prompt += f"  📊 الاتجاه: مستقر ➡️\n"
                prompt += f"  أعلى فصل: {max(gpas):.2f} | أدنى فصل: {min(gpas):.2f} | متوسط: {avg_all:.2f}\n"

        elif transcript_courses:
            prompt += f"\n═══ 📋 ملخص السجل ({len(transcript_courses)} مادة) ═══\n"
            by_grade: dict[str, int] = {}
            for c in transcript_courses:
                g = c.get("grade", "غير محدد")
                by_grade[g] = by_grade.get(g, 0) + 1
            for g, n in sorted(by_grade.items()):
                prompt += f"  • {g}: {n} مادة\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 6: Academic Strengths & Weaknesses
    # ══════════════════════════════════════════════════
    weaknesses = analysis.get("weaknesses", [])
    strengths = analysis.get("strengths", [])
    if weaknesses or strengths:
        prompt += "\n═══ 🎯 التحليل الأكاديمي ═══\n"
        if weaknesses:
            prompt += "نقاط الضعف (تحتاج اهتماماً عاجلاً):\n"
            for w in weaknesses[:5]:
                prompt += f"  ❌ {w}\n"
        if strengths:
            prompt += "نقاط القوة:\n"
            for s in strengths[:5]:
                prompt += f"  ✅ {s}\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 7: Upcoming Exams with Urgency Signals
    # ══════════════════════════════════════════════════
    if upcoming_exams:
        prompt += "\n═══ 📅 الاختبارات القادمة ═══\n"
        critical_exams = []  # ≤ 3 days
        urgent_exams = []    # 4-7 days
        normal_exams = []    # > 7 days

        for e in upcoming_exams[:10]:
            try:
                exam_date = datetime.fromisoformat(e["date"])
                days_left = (exam_date - today).days
                entry = f"{e.get('subject', '?')} — {e['date']} (بعد {days_left} يوم)"

                if days_left <= 3:
                    critical_exams.append(entry)
                elif days_left <= 7:
                    urgent_exams.append(entry)
                else:
                    normal_exams.append(entry)
            except (ValueError, KeyError):
                normal_exams.append(f"{e.get('subject', '?')} — {e.get('date', '?')}")

        if critical_exams:
            prompt += "🔴 حرج (≤ 3 أيام) — ركّز عليها فوراً:\n"
            for ex in critical_exams:
                prompt += f"  🚨 {ex}\n"
        if urgent_exams:
            prompt += "🟡 عاجل (4-7 أيام):\n"
            for ex in urgent_exams:
                prompt += f"  ⚠️ {ex}\n"
        if normal_exams:
            prompt += "🟢 قادمة:\n"
            for ex in normal_exams:
                prompt += f"  📌 {ex}\n"
    else:
        prompt += "\n✅ لا توجد اختبارات قادمة مسجلة.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 8: Active Study Plan Status
    # ══════════════════════════════════════════════════
    if active_plan:
        tasks = active_plan.get("tasks", [])
        pending = [t for t in tasks if not t.get("done")]
        done = [t for t in tasks if t.get("done")]
        completion = round(len(done) / len(tasks) * 100) if tasks else 0

        prompt += f'\n═══ 📋 الخطة الدراسية: "{active_plan.get("title", "")}" ═══\n'
        prompt += f"  التقدم: {len(done)}/{len(tasks)} ({completion}%)\n"

        if pending:
            # Show today's tasks first
            today_tasks = [t for t in pending if t.get("date") == today_str]
            if today_tasks:
                prompt += "  مهام اليوم:\n"
                for t in today_tasks:
                    prompt += f"    ◦ {t.get('title', '')} ({t.get('subject', '')}) — {t.get('duration', 60)} دقيقة\n"

            other = [t for t in pending if t.get("date") != today_str][:5]
            if other:
                prompt += "  قادمة:\n"
                for t in other:
                    prompt += f"    ◦ {t.get('title', '')} — {t.get('date', '')}\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 9: Adaptive Tutoring Persona
    # ══════════════════════════════════════════════════
    prompt += "\n═══ 🎭 أسلوب التدريس التكيفي ═══\n"

    if prefs:
        speed = prefs.get("study_speed", "normal")
        method = prefs.get("method", "")
        stress = prefs.get("stress_level", "normal")

        if speed == "fast":
            prompt += """⚡ الطالب سريع التعلم:
  • قدم شروحات موجزة بنقاط مرقمة.
  • استخدم أمثلة مباشرة بدون مقدمات.
  • اقترح رسوم بيانية / خرائط ذهنية بدلاً من النصوص الطويلة.
  • لا تكرر المعلومات — وقته ثمين.
"""
        elif speed == "slow":
            prompt += """🐢 الطالب يتعلم بالتأني:
  • قدم شروحات مفصلة خطوة بخطوة.
  • استخدم تشبيهات وقصص لتوضيح المفاهيم.
  • كرر النقاط المهمة بصياغات مختلفة.
  • اقترح مراجعة كل مفهوم قبل الانتقال للتالي.
"""
        else:
            prompt += "  • أسلوب متوسط: شرح واضح مع أمثلة عملية.\n"

        if method:
            method_lower = method.lower()
            if any(w in method_lower for w in ["بصري", "visual", "خرائط", "رسم"]):
                prompt += "  📸 يفضل التعلم البصري: اقترح مخططات، رسوم، ألوان، وفيديوهات.\n"
            elif any(w in method_lower for w in ["قراءة", "reading", "كتب", "ملخص"]):
                prompt += "  📖 يفضل القراءة: قدم ملخصات نصية منظمة ونقاط مراجعة.\n"
            elif any(w in method_lower for w in ["سمعي", "audio", "شرح", "محاضرة"]):
                prompt += "  🎧 يفضل السمع: اقترح محاضرات وبودكاست وشروحات صوتية.\n"
            elif any(w in method_lower for w in ["تطبيق", "practice", "حل", "تمارين"]):
                prompt += "  ✍️ يفضل التطبيق: ركز على حل مسائل وتمارين عملية.\n"
            else:
                prompt += f"  📚 أسلوبه: {method}\n"

        if stress in ("high", "critical"):
            prompt += """  💚 الطالب متوتر — قواعد خاصة:
  • ابدأ كل رد بكلمة تشجيعية.
  • قسّم المهام الكبيرة لأجزاء صغيرة (micro-tasks).
  • اقترح فترات راحة وتنفس بين الجلسات.
  • لا تضغط عليه — شجعه بلطف.
  • إذا طلب خطة → استخدم generate_semester_master_plan لإنشاء خطة مخصصة تراعي توتره.
"""

    # ══════════════════════════════════════════════════
    #  BLOCK 10: Proactive Intelligence Rules
    # ══════════════════════════════════════════════════
    prompt += """
═══ ⚡ قواعد الذكاء الاستباقي ═══

🔧 صلاحياتك (13 أداة):
1. add_upcoming_exam — تسجيل اختبار
2. create_study_plan — إنشاء خطة مذاكرة قصيرة
3. send_notification — إرسال تنبيه/تحفيز
4. get_student_data — قراءة بيانات الطالب
5. analyze_transcript — تحليل السجل الأكاديمي
6. update_profile — تحديث الملف الشخصي
7. get_upcoming_exams — جلب الاختبارات القادمة
8. add_course — إضافة مادة
9. complete_task — إنجاز مهمة
10. modify_study_session — تعديل مواعيد ومهام الخطة
11. predict_gpa_pathway — حساب مسار الوصول للمعدل المستهدف
12. update_learning_preferences — تحديث أسلوب التعلم والتوتر
13. generate_semester_master_plan ⭐ — إنشاء خطة فصلية ذكية مخصصة بالكامل

═══ قواعد السلوك الذكي ═══
1. إذا ذكر الطالب اختباراً → add_upcoming_exam فوراً + اقترح خطة مراجعة.
2. إذا طلب "جدول فصلي" أو "خطط لي الفصل كامل" أو "نظم مذاكرتي" → generate_semester_master_plan.
3. إذا طلب خطة بسيطة أو لمادة واحدة → create_study_plan مع مراعاة وقت ذروته.
4. إذا سأل "كيف أوصل معدلي لـ X؟" → predict_gpa_pathway فوراً.
5. إذا اختبار ≤ 3 أيام + الطالب يفضل المساء → اقترح مسح مساء ذلك اليوم للمراجعة العميقة.
6. إذا الطالب متوتر أو قلق → update_learning_preferences(stress_level, high) + كلام تشجيعي.
7. إذا طُلب تأجيل أو تعديل جلسة → modify_study_session مباشرة.
8. إذا أنجز مهمة → complete_task + 🎉 + اقترح المهمة التالية.
9. بعد أي إجراء → أخبر الطالب تحديداً ما تم وأين يجده.
10. لا تكذب ولا تخترع بيانات. إذا لم تجد معلومة → اسأل عنها.
11. الردود المثالية: 2-4 جمل + إجراء عملي واحد على الأقل.

═══ قواعد التخصيص الذكي ═══
• الخطة الفصلية يجب أن تعطي المواد الضعيفة (C أو أقل في السجل) وقتاً مضاعفاً.
• المواد الصعبة تُجدول في وقت الذروة (حسب best_time)، السهلة في الأوقات المرنة.
• إذا stress_level = high → أضف buffer days قبل الاختبارات وخفف الحمل.
• إذا study_speed = slow → طوّل مدة الجلسات وأضف استراحات أكثر.
• إذا study_speed = fast → اختصر الجلسات وركّز على الأولويات.
• قبل شرح أي مفهوم → تحقق من أسلوب التعلم المفضل واضبط طريقة الشرح.
"""

    return prompt

