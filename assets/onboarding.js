/**
 * ================================================================
 * SMART AI ONBOARDING WIZARD (v2.0 Strict PDF)
 * ================================================================
 */

(function () {
    'use strict';
  
    const obOverlay = document.getElementById('onboardingWizard');
    if (!obOverlay) return;
  
    const btnAnalyze = document.getElementById('obAnalyzeBtn');
    const fileTranscript = document.getElementById('obTranscriptFile');
    const fileTimetable = document.getElementById('obTimetableFile');
    
    const step1 = document.getElementById('obStep1');
    const step2 = document.getElementById('obStep2');
    const btnSave = document.getElementById('obSaveBtn');
  
    let extractedData = null;
    let timetableData = null;
    
    // Global Academic Calendars Map
    const calendars = {
        "أم القرى": 16,
        "جامعة أم القرى": 16,
        "umm al-qura university": 16,
        "جامعة الملك سعود": 15,
        "ksu": 15
    };
  
    // ── 1. Gatekeeper Logic ──
    async function checkProfileComplete() {
      await new Promise(r => setTimeout(r, 800));
      const profile = JSON.parse(localStorage.getItem('uqu_profile_v2') || 'null');
      
      if (!profile || !profile.goals || !profile.goals.currentGpa) {
        document.body.classList.add('onboarding-active');
        obOverlay.style.display = 'flex';
      }
    }
  
    // ── 2. Handle File Names Display ──
    fileTranscript.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        document.getElementById('obFileName').textContent = file.name;
        document.getElementById('obFileName').style.color = "var(--accent)";
      }
    });

    fileTimetable.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        document.getElementById('obTimeFileName').textContent = "تم إرفاق: " + file.name;
      }
    });
  
    // ── 3. Call AI Endpoints ──
    btnAnalyze.addEventListener('click', async () => {
      const transcriptFile = fileTranscript.files[0];
      if (!transcriptFile) {
        alert('يرجى إرفاق السجل الأكاديمي (PDF) أولاً.');
        return;
      }
  
      btnAnalyze.disabled = true;
      const originalText = btnAnalyze.innerHTML;
      btnAnalyze.innerHTML = '<span class="spinner"></span> جاري استخراج البيانات وبناء الملف...';
  
      try {
        const token = window.FirebaseAuth?.getIdToken 
           ? await window.FirebaseAuth.getIdToken() 
           : null;
        
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
  
        const formData = new FormData();
        formData.append('file', transcriptFile);

        const res = await fetch(`${window.UQUCore.api.baseUrl()}/api/onboarding/analyze-transcript`, {
          method: 'POST',
          headers,
          body: formData
        });
  
        if (!res.ok) {
           const errData = await res.json().catch(()=>({}));
           throw new Error(errData.detail || 'فشل تحميل وتسجيل السجل، تأكد أنه ملف رسمي.');
        }
        
        extractedData = await res.json();

        const tbFile = fileTimetable.files[0];
        if (tbFile) {
             btnAnalyze.innerHTML = '<span class="spinner"></span> جاري تحليل الجدول الدراسي...';
             const tbForm = new FormData();
             tbForm.append('file', tbFile);
             
             const tbRes = await fetch(`${window.UQUCore.api.baseUrl()}/api/onboarding/analyze-timetable`, {
                method: 'POST',
                headers,
                body: tbForm
             }).catch(e => console.error("Timetable parse failed", e));
             
             if (tbRes && tbRes.ok) {
                 timetableData = await tbRes.json();
             }
        }
        
        step1.style.display = 'none';
        step2.style.display = 'block';
  
        // Populate Step 2 UI (Read-Only fields)
        document.getElementById('obNameVal').value = extractedData.name || 'غير متوفر في السجل';
        document.getElementById('obMajorVal').value = extractedData.major || 'غير محدد';
        document.getElementById('obGpaVal').value = extractedData.current_gpa || '—';
        if (extractedData.gpa_scale) {
            document.getElementById('obGpaScale') && (document.getElementById('obGpaScale').textContent = "/ " + extractedData.gpa_scale);
        }
        document.getElementById('obHoursVal').value = extractedData.earned_hours || '—';
        document.getElementById('obUniVal').value = extractedData.university || '—';
        
        // Calendar Auto-set
        const uniKey = (extractedData.university || '').toLowerCase().trim();
        let matchedWeeks = null;
        for (const [key, wks] of Object.entries(calendars)) {
           if (uniKey.includes(key)) matchedWeeks = wks;
        }
        if (matchedWeeks) {
           document.getElementById('obCalendarDiv').style.display = 'block';
           document.getElementById('obWeeksVal').value = matchedWeeks + ' أسبوع';
        }

        if (extractedData.plan_hours) {
           document.getElementById('obPlanHoursInput').value = extractedData.plan_hours;
        }

        renderCoursesList(extractedData.courses || []);
        recalcMaxGpa();
        
      } catch (err) {
        console.error(err);
        alert(err.message || 'حدث خطأ أثناء الاتصال بالمساعد الذكي.');
      } finally {
        btnAnalyze.disabled = false;
        btnAnalyze.innerHTML = originalText;
      }
    });

    // ── 4. Max GPA Projection Math & Strict Error Tracking ──
    const planInput = document.getElementById('obPlanHoursInput');
    const targetInput = document.getElementById('obTargetGpaInput');
    const errorHint = document.getElementById('obTargetError');
    let computedMaxGpa = 4.0;
    
    function recalcMaxGpa() {
        if (!extractedData) return;
        let earned = parseFloat(extractedData.earned_hours) || 0;
        let gpa = parseFloat(extractedData.current_gpa) || 0;
        let scale = parseFloat(extractedData.gpa_scale) || 4.0;
        let plan = parseFloat(planInput.value) || 130;
        
        if (plan <= earned) {
            computedMaxGpa = gpa;
        } else {
            computedMaxGpa = ((earned * gpa) + (scale * (plan - earned))) / plan;
        }
        document.getElementById('obMaxGpaCalc').textContent = computedMaxGpa.toFixed(2);
        
        let suggested = Math.min((gpa + 0.5), computedMaxGpa, scale).toFixed(2);
        
        if (!targetInput.dataset.touched) {
            targetInput.value = suggested;
        }
        validateTargetGpa();
    }
    
    function validateTargetGpa() {
        let currentVal = parseFloat(targetInput.value) || 0;
        if (currentVal > computedMaxGpa) {
            targetInput.style.borderColor = 'var(--danger)';
            errorHint.style.display = 'block';
            btnSave.disabled = true;
            btnSave.style.opacity = '0.5';
        } else {
            targetInput.style.borderColor = 'var(--border-2)';
            errorHint.style.display = 'none';
            btnSave.disabled = false;
            btnSave.style.opacity = '1';
        }
    }
    planInput.addEventListener('input', recalcMaxGpa);
    targetInput.addEventListener('input', () => {
        targetInput.dataset.touched = "true";
        validateTargetGpa();
    });
    function renderCoursesList(courses) {
        const container = document.getElementById('obCoursesList');
        if (!courses || courses.length === 0) {
            container.innerHTML = '<p class="muted">لا توجد مواد حالية مسجلة.</p>';
            return;
        }
        
        const grouped = courses.reduce((acc, c) => {
            const term = c.term || 'الفصل الحالي';
            if (!acc[term]) acc[term] = [];
            acc[term].push(c);
            return acc;
        }, {});
        let html = '';
        for (const [term, termCourses] of Object.entries(grouped)) {
            html += `<details open style="margin-bottom: 12px; background: rgba(0,0,0,0.15); border-radius: 8px; border: 1px solid var(--border-2);">
                       <summary style="padding: 10px 14px; font-weight: bold; cursor: pointer; color: var(--accent); outline: none;">
                         ${term} <span style="font-size:0.8rem; color:var(--muted);">(${termCourses.length} مواد)</span>
                       </summary>
                       <div style="padding: 10px 14px; border-top: 1px solid var(--border-2);">`;
            termCourses.forEach(c => {
                html += `<div style="display:flex; justify-content:space-between; padding: 6px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.85rem;">
                           <span style="color:var(--fg);">${c.name} <small style="color:var(--muted)">(${c.code})</small></span>
                           <span style="color:var(--muted);">${c.credits} ساعة</span>
                         </div>`;
            });
            html += `  </div>
                     </details>`;
        }
        container.innerHTML = html;
    }
  
    // ── 5. Save and Sync to Firestore/LocalStorage ──
    btnSave.addEventListener('click', async () => {
      if (!extractedData) return;
  
      btnSave.disabled = true;
      btnSave.innerHTML = '<span class="spinner"></span> جاري المزامنة مع السيرفر...';
  
      try {
        let plan = parseFloat(planInput.value) || 130;
        let target = parseFloat(targetInput.value) || 4.0;
        let workStatus = document.getElementById('obWorkStatus')?.value || 'none';
        
        const updates = {
          goals: {
            currentGpa: extractedData.current_gpa,
            earnedHours: extractedData.earned_hours,
            targetGpa: target,
            planHours: plan,
            goal: 'raise'
          },
          courses: extractedData.courses || [],
          preferences: {
             theme: 'auto',
             notifications: true,
             work_status: workStatus,
             best_time: extractedData.suggested_learning_style?.best_time || 'night',
             study_hours: extractedData.suggested_learning_style?.study_hours || 10,
             method: extractedData.suggested_learning_style?.method || 'Pomodoro',
             focus_length: extractedData.suggested_learning_style?.focus_length || 45,
             study_speed: extractedData.suggested_learning_style?.study_speed || 'normal',
             stress_level: extractedData.suggested_learning_style?.stress_level || 'normal'
          }
        };
  
        // ── Update localStorage cache (fast local read) ──
        const profile = JSON.parse(localStorage.getItem('uqu_profile_v2') || '{}');
        const merged = { ...profile, ...updates };
        merged.goals = { ...(profile.goals || {}), ...updates.goals };
        merged.preferences = { ...(profile.preferences || {}), ...updates.preferences };
        localStorage.setItem('uqu_profile_v2', JSON.stringify(merged));

        if (extractedData.historical_semesters) {
             localStorage.setItem('uqu_semesters', JSON.stringify(extractedData.historical_semesters));
        }

        // ── Persist to Firestore via authenticated backend endpoint ──
        const token = window.FirebaseAuth?.getIdToken
           ? await window.FirebaseAuth.getIdToken()
           : (window.FirebaseDB?.getIdToken ? await window.FirebaseDB.getIdToken() : null);

        if (token) {
           try {
             await window.UQUCore.api.post('/api/onboarding/save-profile', {
               goals: updates.goals,
               courses: updates.courses,
               preferences: updates.preferences,
               timetable: timetableData ? timetableData.schedule : [],
               historical_semesters: extractedData.historical_semesters || [],
               university: extractedData.university || 'أم القرى'
             });
           } catch (saveErr) {
             console.warn('[Onboarding] Backend save warning:', saveErr.message);
             // Don't block the UI — localStorage is already saved as fallback
           }
        } else {
           console.warn('[Onboarding] No auth token — data saved locally only');
        }
  
        document.body.classList.remove('onboarding-active');
        obOverlay.style.animation = 'fadeOut 0.4s ease forwards';
        setTimeout(() => {
          obOverlay.style.display = 'none';
          window.location.reload();
        }, 400);
        
      } catch (err) {
        console.error('Save failed:', err);
        alert('فشل حفظ البيانات. يرجى المحاولة مرة أخرى.');
        btnSave.disabled = false;
        btnSave.innerHTML = '✅ حفظ وبدء الاستخدام';
      }
    });
  
    window.addEventListener('load', checkProfileComplete);
  
  })();
