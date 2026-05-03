"""
================================================================
UQU AGENT — Tools Schema Definition (v2.0 — Super-Agent)
================================================================
12 tools for the AI Agent's function calling.
Original 9 + 3 new intelligent tools.
"""

TOOLS_SCHEMA: list[dict] = [

    # ── 1. Add Upcoming Exam ──
    {
        "type": "function",
        "function": {
            "name": "add_upcoming_exam",
            "description": "أضف اختباراً أو كويزاً قادماً للوحة تحكم الطالب. استخدمها عندما يذكر الطالب اختباراً قادماً.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject":     {"type": "string", "description": "اسم المادة (مثل: رياضيات، فيزياء)"},
                    "date":        {"type": "string", "description": "تاريخ الاختبار بصيغة YYYY-MM-DD"},
                    "time":        {"type": "string", "description": "وقت الاختبار مثل 10:00 AM (اختياري)"},
                    "course_code": {"type": "string", "description": "رمز المادة إن عُرف (اختياري)"},
                    "exam_type":   {"type": "string", "enum": ["exam", "quiz", "midterm", "final", "assignment"], "description": "نوع التقييم"},
                    "notes":       {"type": "string", "description": "ملاحظات إضافية (اختياري)"}
                },
                "required": ["subject", "date"]
            }
        }
    },

    # ── 2. Create Study Plan ──
    {
        "type": "function",
        "function": {
            "name": "create_study_plan",
            "description": "أنشئ خطة دراسية أو جدول مراجعة للطالب. يظهر في صفحة الخطة الدراسية.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "عنوان الخطة (مثل: خطة مراجعة الفيزياء)"},
                    "tasks": {
                        "type": "array",
                        "description": "قائمة المهام الدراسية",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title":    {"type": "string", "description": "عنوان المهمة"},
                                "subject":  {"type": "string", "description": "اسم المادة"},
                                "duration": {"type": "number", "description": "المدة بالدقائق"},
                                "date":     {"type": "string", "description": "تاريخ التنفيذ YYYY-MM-DD"},
                                "priority": {"type": "string", "enum": ["high", "medium", "low"], "description": "الأولوية"},
                                "notes":    {"type": "string", "description": "تفاصيل المهمة"}
                            },
                            "required": ["title", "subject"]
                        }
                    },
                    "deadline": {"type": "string", "description": "الموعد النهائي للخطة YYYY-MM-DD"}
                },
                "required": ["title", "tasks"]
            }
        }
    },

    # ── 3. Send Notification ──
    {
        "type": "function",
        "function": {
            "name": "send_notification",
            "description": "أرسل إشعاراً أو رسالة تحفيزية للطالب في قائمة التنبيهات.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "نص الرسالة"},
                    "type":    {"type": "string", "enum": ["motivational", "reminder", "warning", "info", "achievement"], "description": "نوع الإشعار"},
                    "title":   {"type": "string", "description": "عنوان الإشعار"}
                },
                "required": ["message", "type"]
            }
        }
    },

    # ── 4. Get Student Data ──
    {
        "type": "function",
        "function": {
            "name": "get_student_data",
            "description": "اقرأ بيانات الطالب الأكاديمية الكاملة: المعدل، المواد، السجل، الأهداف، نمط المذاكرة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "enum": ["all", "profile", "transcript", "exams", "study_plan", "preferences"],
                        "description": "القسم المطلوب"
                    }
                },
                "required": ["section"]
            }
        }
    },

    # ── 5. Analyze Transcript ──
    {
        "type": "function",
        "function": {
            "name": "analyze_transcript",
            "description": "حلّل السجل الأكاديمي للطالب واستخرج نقاط القوة والضعف والتوصيات.",
            "parameters": {
                "type": "object",
                "properties": {
                    "focus": {
                        "type": "string",
                        "enum": ["full", "weaknesses", "strengths", "gpa_trend", "recommendations"],
                        "description": "نوع التحليل المطلوب"
                    }
                },
                "required": ["focus"]
            }
        }
    },

    # ── 6. Update Profile ──
    {
        "type": "function",
        "function": {
            "name": "update_profile",
            "description": "حدّث بيانات الملف الشخصي للطالب (الهدف الأكاديمي، التخصص، الاسم، المعدل).",
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "description": "اسم الحقل: name, major, level, currentGpa, targetGpa, earnedHours"},
                    "value": {"description": "القيمة الجديدة"}
                },
                "required": ["field", "value"]
            }
        }
    },

    # ── 7. Get Upcoming Exams ──
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_exams",
            "description": "احصل على قائمة الاختبارات القادمة المسجلة للطالب.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "number", "description": "عدد الاختبارات المطلوبة (افتراضي 10)"}
                }
            }
        }
    },

    # ── 8. Add Course ──
    {
        "type": "function",
        "function": {
            "name": "add_course",
            "description": "أضف مادة جديدة لقائمة مواد الفصل الحالي.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":         {"type": "string", "description": "اسم المادة"},
                    "code":         {"type": "string", "description": "رمز المادة"},
                    "credit_hours": {"type": "number", "description": "عدد الساعات المعتمدة"},
                    "difficulty":   {"type": "string", "enum": ["easy", "medium", "hard"], "description": "درجة الصعوبة"}
                },
                "required": ["name"]
            }
        }
    },

    # ── 9. Complete Task ──
    {
        "type": "function",
        "function": {
            "name": "complete_task",
            "description": "ضع علامة إنجاز على مهمة في خطة الدراسة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id":   {"type": "string", "description": "معرّف المهمة"},
                    "task_name": {"type": "string", "description": "اسم المهمة (إذا لم تعرف المعرّف)"}
                }
            }
        }
    },

    # ═══════════════════════════════════════════
    #  NEW SUPER-AGENT TOOLS (v2.0)
    # ═══════════════════════════════════════════

    # ── 10. Modify Study Session (Plan Surgery) ──
    {
        "type": "function",
        "function": {
            "name": "modify_study_session",
            "description": "عدّل جلسة أو مهمة في الخطة الدراسية الحالية. استخدمها لتغيير الموعد أو المدة أو المادة بناءً على ضغط الاختبارات أو طلب الطالب. مثلاً: نقل جلسة من يوم لآخر أو تمديد المراجعة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "معرّف المهمة المراد تعديلها (اختياري إذا أعطيت الاسم)"
                    },
                    "task_name": {
                        "type": "string",
                        "description": "اسم المهمة أو جزء منه للبحث عنها"
                    },
                    "new_date": {
                        "type": "string",
                        "description": "التاريخ الجديد YYYY-MM-DD"
                    },
                    "new_time": {
                        "type": "string",
                        "description": "الوقت الجديد مثل 18:00"
                    },
                    "new_duration": {
                        "type": "number",
                        "description": "المدة الجديدة بالدقائق"
                    },
                    "new_subject": {
                        "type": "string",
                        "description": "تغيير المادة"
                    },
                    "new_priority": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "تغيير الأولوية"
                    },
                    "reason": {
                        "type": "string",
                        "description": "سبب التعديل (يظهر في سجل التغييرات)"
                    }
                }
            }
        }
    },

    # ── 11. Predict GPA Pathway (GPA Strategy) ──
    {
        "type": "function",
        "function": {
            "name": "predict_gpa_pathway",
            "description": "احسب المسار الدقيق للوصول للمعدل المستهدف. يقرأ السجل الأكاديمي ومواد الفصل الحالي ويخبر الطالب بالتحديد ما الدرجات التي يحتاجها في كل مادة. استخدمها عند سؤال: 'أحتاج معدل 4.5 وش الدرجات المطلوبة؟' أو 'كيف أوصل معدلي لـ 4؟'",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_gpa": {
                        "type": "number",
                        "description": "المعدل المستهدف من 5.00 (اختياري — يؤخذ من هدف الطالب المحفوظ إذا لم يُحدد)"
                    },
                    "scenario": {
                        "type": "string",
                        "enum": ["minimum", "balanced", "ambitious"],
                        "description": "نوع السيناريو: minimum=أقل درجات ممكنة, balanced=متوازن, ambitious=الأفضل"
                    }
                }
            }
        }
    },

    # ── 12. Update Learning Preferences (Profile Evolution) ──
    {
        "type": "function",
        "function": {
            "name": "update_learning_preferences",
            "description": "حدّث تفضيلات أسلوب التعلم للطالب. استخدمها عندما يذكر الطالب تغييراً في نمط مذاكرته أو عندما تلاحظ أنه بحاجة لتعديل (مثل: طالب متوتر ← اقترح تبطيء السرعة). هذه تختلف عن update_profile — هذه خاصة بأسلوب التعلم فقط.",
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "enum": ["best_time", "study_hours", "method", "focus_length", "study_speed", "stress_level"],
                        "description": "الحقل: best_time(صباحي/مسائي/ليلي), study_hours(ساعات يوم), method(أسلوب), focus_length(دقائق التركيز), study_speed(slow/normal/fast), stress_level(low/normal/high/critical)"
                    },
                    "value": {
                        "type": "string",
                        "description": "القيمة الجديدة"
                    },
                    "reason": {
                        "type": "string",
                        "description": "سبب التغيير (لعرضه على الطالب)"
                    }
                },
                "required": ["field", "value"]
            }
        }
    },

    # ── 13. Generate Semester Master Plan (Personalized Planner) ──
    {
        "type": "function",
        "function": {
            "name": "generate_semester_master_plan",
            "description": "أنشئ خطة فصلية شاملة ومخصصة بالكامل للطالب. هذه ليست خطة عادية — هي خطة ذكية تقرأ: أسلوب التعلم (وقت الذروة، سرعة المذاكرة، مدة التركيز، مستوى التوتر)، نتائج السجل الأكاديمي (المواد الضعيفة تأخذ وقت أكثر)، وتواريخ الاختبارات. استخدمها عندما يطلب الطالب 'سوّ لي جدول فصلي' أو 'خطط لي الفصل كامل' أو 'نظّم مذاكرتي'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "weeks": {
                        "type": "number",
                        "description": "عدد أسابيع الخطة (افتراضي: 16 أسبوع = فصل كامل)"
                    },
                    "daily_hours": {
                        "type": "number",
                        "description": "ساعات الدراسة اليومية (يؤخذ من الملف الشخصي إذا لم يُحدد)"
                    },
                    "include_weekends": {
                        "type": "boolean",
                        "description": "تضمين عطلة نهاية الأسبوع (الجمعة/السبت)"
                    },
                    "focus_mode": {
                        "type": "string",
                        "enum": ["balanced", "exam_focused", "weakness_recovery", "gpa_boost"],
                        "description": "نمط التركيز: balanced=متوازن, exam_focused=تركيز على الاختبارات القريبة, weakness_recovery=تقوية الضعف, gpa_boost=رفع المعدل"
                    }
                }
            }
        }
    },

]

