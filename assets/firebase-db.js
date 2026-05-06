/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — Firebase DB Layer v2.0 (Firestore-First)
 * ================================================================
 * 🔥 Firestore is the SINGLE SOURCE OF TRUTH.
 * localStorage is a fast-loading READ CACHE — always overwritten
 * with fresh Firestore data on login and via real-time listeners.
 *
 * Architecture:
 *  1. onAuthStateChanged → aggressive pull ALL collections → cache in localStorage
 *  2. Real-time onSnapshot listeners keep localStorage in sync
 *  3. Writes go to Firestore FIRST, then localStorage is updated
 *  4. Offline: localStorage serves as fallback until reconnect
 * ================================================================
 */

(function (window) {
  'use strict';

  /* ── Helpers ── */
  function sGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function sSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { }
  }

  /* ── Config keys ── */
  const LS_KEYS = {
    PROFILE:  'uqu_profile_v2',
    PLAN:     'uqu_plan_v5',
    CHAT:     'uqu_chat_history_v1',
    NOTIFS:   'uqu_notifications',
    SEMESTERS:'uqu_semesters',
    EXAMS:    'uqu_firebase_exams',
    FB_NOTIFS:'uqu_firebase_notifications'
  };

  let _db         = null;
  let _auth        = null;
  let _userId      = null;
  let _listeners   = [];
  let _initialized = false;
  let _syncInProgress = false;

  /* ════════════════════════════════════════════════════════════════
     1. INITIALIZATION & AUTH STATE
     ════════════════════════════════════════════════════════════════ */

  function init() {
    if (typeof firebase === 'undefined') return;
    _db   = firebase.firestore();
    _auth = firebase.auth();

    _auth.onAuthStateChanged(async (user) => {
      if (user) {
        _userId      = user.uid;
        _initialized = true;

        console.log('[FirebaseDB] 🔑 User signed in:', user.uid);

        // ── CRITICAL: Full Firestore → localStorage sync on every login ──
        await pullFromFirestore();

        // ── Push any local-only data created while offline ──
        await mergeLocalToFirestore();

        // ── Start real-time listeners for zero-refresh UX ──
        attachRealtimeListeners();

        // ── Dispatch ready event ──
        window.dispatchEvent(new CustomEvent('uqu:firebaseReady', { detail: { userId: user.uid } }));
        window.dispatchEvent(new CustomEvent('uqu:profileUpdated'));

      } else {
        _userId      = null;
        _initialized = false;
        detachAllListeners();
        console.log('[FirebaseDB] 👤 User signed out');
      }
    });
  }

  /* ════════════════════════════════════════════════════════════════
     2. PULL Firestore → localStorage (Aggressive Full Sync)
     ════════════════════════════════════════════════════════════════ */

  async function pullFromFirestore() {
    if (!_userId || !_db) return;
    if (_syncInProgress) return;
    _syncInProgress = true;

    try {
      const userRef = _db.collection('users').doc(_userId);

      /* ── Profile ── */
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        const data = userSnap.data();

        // Build the canonical localStorage profile from Firestore data
        const fsProfile = {
          basic: {
            name:       data.profile?.name       || '',
            university: data.profile?.university || '',
            major:      data.profile?.major      || '',
            level:      data.profile?.level      || '',
            faculty:    data.profile?.faculty    || ''
          },
          goals: {
            currentGpa:  data.profile?.currentGpa  ?? null,
            targetGpa:   data.profile?.targetGpa   ?? null,
            earnedHours: data.profile?.earnedHours ?? null,
            planHours:   data.profile?.planHours   ?? null,
            goal:        data.profile?.goal        || 'raise'
          },
          learning: {
            bestTime:    data.study_preferences?.best_time    || '',
            studyHours:  data.study_preferences?.study_hours  || 0,
            studyStyle:  data.study_preferences?.method       || '',
            focusLength: data.study_preferences?.focus_length || 25,
            studySpeed:  data.study_preferences?.study_speed  || 'normal',
            stressLevel: data.study_preferences?.stress_level || 'normal'
          },
          courses: data.profile?.courses || []
        };

        // Merge: Firestore wins, but keep any local-only fields
        const local = sGet(LS_KEYS.PROFILE) || {};
        const merged = {
          ...local,
          ...fsProfile,
          basic:    { ...(local.basic || {}),    ...fsProfile.basic },
          goals:    { ...(local.goals || {}),    ...fsProfile.goals },
          learning: { ...(local.learning || {}), ...fsProfile.learning },
          courses:  fsProfile.courses.length > 0 ? fsProfile.courses : (local.courses || []),
          completedCourses: data.completedCourses || local.completedCourses || [],
          _lastSyncAt: new Date().toISOString()
        };
        sSet(LS_KEYS.PROFILE, merged);
      }

      /* ── Upcoming Exams ── */
      const today = new Date().toISOString().split('T')[0];
      try {
        const eSnap = await userRef.collection('exams')
          .where('done', '==', false)
          .where('date', '>=', today)
          .orderBy('date').limit(20).get();
        const exams = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        sSet(LS_KEYS.EXAMS, exams);
      } catch (e) {
        console.warn('[FirebaseDB] Exams pull needs index:', e.message);
      }

      /* ── Notifications ── */
      try {
        const nSnap = await userRef.collection('notifications')
          .orderBy('createdAt', 'desc').limit(30).get();
        const notifs = nSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        sSet(LS_KEYS.FB_NOTIFS, notifs);
      } catch (e) {
        console.warn('[FirebaseDB] Notifications pull error:', e.message);
      }

      /* ── Active Study Plan ── */
      try {
        const pSnap = await userRef.collection('study_plans')
          .where('active', '==', true)
          .orderBy('createdAt', 'desc').limit(1).get();
        if (!pSnap.empty) {
          const plan = { id: pSnap.docs[0].id, ...pSnap.docs[0].data() };
          const existingPlan = sGet(LS_KEYS.PLAN) || {};
          sSet(LS_KEYS.PLAN, { ...existingPlan, _firestorePlan: plan });
        }
      } catch (e) {
        console.warn('[FirebaseDB] Plans pull needs index:', e.message);
      }

      /* ── Semester GPA History ── */
      try {
        const sSnap = await userRef.collection('academic_records')
          .where('type', '==', 'semester')
          .orderBy('createdAt', 'asc').limit(20).get();
        if (!sSnap.empty) {
          const semesters = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          sSet(LS_KEYS.SEMESTERS, semesters);
        }
      } catch (e) {
        console.warn('[FirebaseDB] Semesters pull error:', e.message);
      }

      /* ── Latest Transcript (for completedCourses) ── */
      try {
        const tSnap = await userRef.collection('academic_records')
          .where('type', '==', 'transcript')
          .orderBy('createdAt', 'desc').limit(1).get();
        if (!tSnap.empty) {
          const transcript = tSnap.docs[0].data();
          const profile = sGet(LS_KEYS.PROFILE) || {};
          if (transcript.courses && transcript.courses.length > 0) {
            profile.completedCourses = transcript.courses;
          }
          if (transcript.semesters && transcript.semesters.length > 0) {
            sSet(LS_KEYS.SEMESTERS, transcript.semesters);
          }
          sSet(LS_KEYS.PROFILE, profile);
        }
      } catch (e) {
        console.warn('[FirebaseDB] Transcript pull error:', e.message);
      }

      console.log('[FirebaseDB] ✅ Full Firestore sync complete');

      // Broadcast that all collections have been hydrated. This is the
      // canonical signal for dashboards / pomodoro / charts to re-render
      // with the freshly pulled data — listening on `uqu:firebaseReady`
      // (dispatched in init) is not enough because that fires before the
      // pull completes.
      window.dispatchEvent(new CustomEvent('uqu:profileUpdated'));
      window.dispatchEvent(new CustomEvent('uqu:examsUpdated', {
        detail: { exams: sGet(LS_KEYS.EXAMS) || [] }
      }));
      window.dispatchEvent(new CustomEvent('uqu:planUpdated', {
        detail: { plan: (sGet(LS_KEYS.PLAN) || {})._firestorePlan || null }
      }));

    } catch (err) {
      console.error('[FirebaseDB] Pull error:', err);
    } finally {
      _syncInProgress = false;
    }
  }

  /* ════════════════════════════════════════════════════════════════
     3. MERGE local-only data → Firestore (offline recovery)
     ════════════════════════════════════════════════════════════════ */

  async function mergeLocalToFirestore() {
    if (!_userId || !_db) return;
    try {
      const profile = sGet(LS_KEYS.PROFILE);
      if (!profile) return;

      // Only push if there's local data that hasn't been synced
      if (profile._localDirty) {
        await _pushProfileDirect(profile);
        profile._localDirty = false;
        sSet(LS_KEYS.PROFILE, profile);
      }
    } catch (e) {
      console.warn('[FirebaseDB] Merge error:', e);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     4. PUSH to Firestore (Firestore-First Writes)
     ════════════════════════════════════════════════════════════════ */

  async function _pushProfileDirect(profile) {
    if (!_userId || !_db) return;
    await _db.collection('users').doc(_userId).set({
      profile: {
        name:        profile.basic?.name       || '',
        university:  profile.basic?.university || '',
        major:       profile.basic?.major      || '',
        level:       profile.basic?.level      || '',
        currentGpa:  profile.goals?.currentGpa  ?? null,
        targetGpa:   profile.goals?.targetGpa   ?? null,
        earnedHours: profile.goals?.earnedHours ?? null,
        planHours:   profile.goals?.planHours   ?? null,
        termPlanHours: profile.goals?.termPlanHours ?? null,
        goal:        profile.goals?.priority    || profile.goals?.goal || 'raise',
        courses:     profile.courses || []
      },
      study_preferences: {
        best_time:    profile.learning?.preferredTime || profile.learning?.bestTime    || '',
        study_hours:  profile.learning?.studyHours    || 0,
        method:       profile.learning?.style         || profile.learning?.studyStyle  || '',
        focus_length: profile.learning?.focusMinutes  || profile.learning?.focusLength || 25,
        study_speed:  profile.learning?.speed         || profile.learning?.studySpeed  || 'normal',
        stress_level: profile.learning?.stressLevel   || 'normal'
      },
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log("✅ Saved to Firebase");
  }

  async function pushProfileToFirestore() {
    if (!_userId || !_db) return;
    const profile = sGet(LS_KEYS.PROFILE);
    if (!profile) return;

    try {
      // Try FastAPI backend first; falls back to direct Firestore write.
      const ok = await window.UQUCore.api.tryPost('/api/sync-profile', profile);
      if (ok) return;
      await _pushProfileDirect(profile);
    } catch (err) {
      console.error('[FirebaseDB] Push profile error:', err);
      profile._localDirty = true;
      sSet(LS_KEYS.PROFILE, profile);
    }
  }

  /** Wrapper around UQUCore.api.tryPost — returns true on success. */
  async function _backendPost(path, payload) {
    if (!_userId) return false;
    return window.UQUCore.api.tryPost(path, payload);
  }

  async function pushTranscriptToFirestore(courses, cgpa, totalHours, semesters) {
    if (!_userId) return;

    // Try FastAPI backend first (Module 5: /api/firebase/push-transcript).
    const ok = await _backendPost('/api/firebase/push-transcript', {
      courses:    courses    || [],
      semesters:  semesters  || [],
      cgpa:       cgpa       ?? null,
      totalHours: totalHours ?? null
    });
    if (ok) {
      console.log('✅ Saved to Firebase (via backend)');
      return;
    }

    // Fallback: direct Firestore write (offline / no backend configured).
    if (!_db) return;
    try {
      await _db.collection('users').doc(_userId)
        .collection('academic_records').add({
          type:       'transcript',
          courses:    courses    || [],
          semesters:  semesters  || [],
          cgpa:       cgpa       || null,
          totalHours: totalHours || null,
          createdAt:  new Date().toISOString()
        });
      console.log("✅ Saved to Firebase");

      if (semesters && semesters.length > 0) {
        await syncSemestersToFirestore(semesters);
      }
    } catch (err) {
      console.error('[FirebaseDB] Push transcript error:', err);
    }
  }

  async function syncSemestersToFirestore(semesters) {
    if (!_userId || !semesters) return;

    const ok = await _backendPost('/api/firebase/sync-semesters', { semesters });
    if (ok) {
      console.log('✅ Saved to Firebase (via backend)');
      sSet(LS_KEYS.SEMESTERS, semesters);
      return;
    }

    if (!_db) return;
    try {
      const userRef = _db.collection('users').doc(_userId);
      for (const sem of semesters) {
        await userRef.collection('academic_records').add({
          type: 'semester',
          ...sem,
          createdAt: sem.createdAt || new Date().toISOString()
        });
        console.log("✅ Saved to Firebase");
      }
      sSet(LS_KEYS.SEMESTERS, semesters);
    } catch (e) {
      console.error('[FirebaseDB] Semesters sync error:', e);
    }
  }

  async function pushPlanToFirestore(planData) {
    if (!_userId) return;

    const ok = await _backendPost('/api/firebase/push-plan', { plan: planData || {} });
    if (ok) {
      console.log('✅ Saved to Firebase (via backend)');
      return;
    }

    if (!_db) return;
    try {
      await _db.collection('users').doc(_userId).collection('study_plans').add({
        ...planData,
        createdAt: new Date().toISOString()
      });
      console.log("✅ Saved to Firebase");
    } catch (e) {
      console.error('[FirebaseDB] Push plan error:', e);
    }
  }

  async function pushChatToFirestore(conversationId, messages, title) {
    if (!_userId) return;

    const ok = await _backendPost('/api/firebase/push-chat', {
      conversationId: String(conversationId),
      messages: messages || [],
      title: title || null
    });
    if (ok) {
      console.log('✅ Saved to Firebase (via backend)');
      return;
    }

    if (!_db) return;
    try {
      await _db.collection('users').doc(_userId).collection('chat_history').doc(String(conversationId)).set({
        title: title || 'محادثة جديدة',
        messages,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log("✅ Saved to Firebase");
    } catch (e) {
      console.error('[FirebaseDB] Push chat error:', e);
    }
  }

  /**
   * Logs a completed study session via the FastAPI backend
   * (Module 4: /api/pomodoro/log-session). Falls back to direct
   * Firestore write if the backend is unreachable.
   *
   * Accepts either the legacy two-arg form (courseCode, duration)
   * or the newer object form ({ courseCode, courseName, duration,
   * type, date, completedAt }) used by pomodoro.js v3.0.
   */
  async function logCompletedSession(arg1, arg2) {
    if (!_userId) return;

    let courseCode, courseName, duration, type, date, completedAt;
    if (typeof arg1 === 'object' && arg1 !== null) {
      courseCode  = arg1.courseCode;
      courseName  = arg1.courseName;
      duration    = arg1.duration;
      type        = arg1.type;
      date        = arg1.date;
      completedAt = arg1.completedAt;
    } else {
      courseCode = arg1;
      duration   = arg2;
    }

    const payload = {
      courseCode:  courseCode  || 'GENERAL',
      courseName:  courseName  || '',
      duration:    parseInt(duration) || 25,
      type:        type        || 'focus',
      date:        date        || new Date().toISOString().split('T')[0],
      completedAt: completedAt || new Date().toISOString()
    };

    const ok = await _backendPost('/api/pomodoro/log-session', payload);
    if (ok) {
      console.log('✅ Session Logged to Firebase (via backend)');
      return;
    }

    if (!_db) return;
    try {
      await _db.collection('users').doc(_userId).collection('completed_sessions').add({
        ...payload,
        timestamp: firebase.firestore.FieldValue.serverTimestamp() || new Date().toISOString()
      });
      console.log("✅ Session Logged to Firebase");
    } catch (e) {
      console.error('[FirebaseDB] Log session error:', e);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     5. REAL-TIME LISTENERS (Zero-Refresh UX)
     ════════════════════════════════════════════════════════════════ */

  function attachRealtimeListeners() {
    if (!_userId || !_db) return;
    detachAllListeners();

    const userRef = _db.collection('users').doc(_userId);
    const today   = new Date().toISOString().split('T')[0];

    /* ── 1. User Profile Document Listener ── */
    const unsubProfile = userRef.onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();

      // Update localStorage cache
      const existing = sGet(LS_KEYS.PROFILE) || {};
      if (data.profile) {
        existing.basic = {
          ...(existing.basic || {}),
          name:       data.profile.name       || existing.basic?.name || '',
          university: data.profile.university || existing.basic?.university || '',
          major:      data.profile.major      || existing.basic?.major || '',
          level:      data.profile.level      || existing.basic?.level || ''
        };
        existing.goals = {
          ...(existing.goals || {}),
          currentGpa:  data.profile.currentGpa  ?? existing.goals?.currentGpa,
          targetGpa:   data.profile.targetGpa   ?? existing.goals?.targetGpa,
          earnedHours: data.profile.earnedHours ?? existing.goals?.earnedHours
        };
        existing.courses = data.profile.courses || existing.courses || [];
      }
      if (data.study_preferences) {
        existing.learning = {
          ...(existing.learning || {}),
          bestTime:    data.study_preferences.best_time    || '',
          studyHours:  data.study_preferences.study_hours  || 0,
          studyStyle:  data.study_preferences.method       || '',
          focusLength: data.study_preferences.focus_length || 25,
          studySpeed:  data.study_preferences.study_speed  || 'normal',
          stressLevel: data.study_preferences.stress_level || 'normal'
        };
      }
      sSet(LS_KEYS.PROFILE, existing);

      // Dispatch event so dashboard, profile page, etc. react instantly
      window.dispatchEvent(new CustomEvent('uqu:profileUpdated'));
    }, err => console.warn('[FirebaseDB] Profile listener error:', err));

    /* ── 2. Exams listener ── */
    let unsubExams;
    try {
      unsubExams = userRef.collection('exams')
        .where('done', '==', false)
        .where('date', '>=', today)
        .orderBy('date')
        .onSnapshot(snap => {
          const exams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          sSet(LS_KEYS.EXAMS, exams);
          window.dispatchEvent(new CustomEvent('uqu:examsUpdated', { detail: { exams } }));
        }, err => console.warn('[FirebaseDB] Exams listener needs index:', err.message));
    } catch (e) {
      console.warn('[FirebaseDB] Exams listener setup failed:', e);
      unsubExams = () => {};
    }

    /* ── 3. Notifications listener ── */
    const unsubNotifs = userRef.collection('notifications')
      .orderBy('createdAt', 'desc').limit(30)
      .onSnapshot(snap => {
        const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        sSet(LS_KEYS.FB_NOTIFS, notifs);
        const unread = notifs.filter(n => !n.read).length;
        window.dispatchEvent(new CustomEvent('uqu:notificationsUpdated', {
          detail: { notifications: notifs, unreadCount: unread }
        }));
      }, err => console.warn('[FirebaseDB] Notifications listener error:', err));

    /* ── 4. Study Plans listener ── */
    let unsubPlan;
    try {
      unsubPlan = userRef.collection('study_plans')
        .where('active', '==', true)
        .orderBy('createdAt', 'desc').limit(1)
        .onSnapshot(snap => {
          if (!snap.empty) {
            const plan = { id: snap.docs[0].id, ...snap.docs[0].data() };
            const existingPlan = sGet(LS_KEYS.PLAN) || {};
            sSet(LS_KEYS.PLAN, { ...existingPlan, _firestorePlan: plan });
            window.dispatchEvent(new CustomEvent('uqu:planUpdated', { detail: { plan } }));
          }
        }, err => console.warn('[FirebaseDB] Plan listener needs index:', err.message));
    } catch (e) {
      console.warn('[FirebaseDB] Plan listener setup failed:', e);
      unsubPlan = () => {};
    }

    _listeners = [unsubProfile, unsubExams, unsubNotifs, unsubPlan];
  }

  function detachAllListeners() {
    _listeners.forEach(unsub => { try { if (unsub) unsub(); } catch (_) {} });
    _listeners = [];
  }

  /* ════════════════════════════════════════════════════════════════
     6. GETTERS (from localStorage cache — kept fresh by listeners)
     ════════════════════════════════════════════════════════════════ */

  function getUpcomingExams()         { return sGet(LS_KEYS.EXAMS) || []; }
  function getFirebaseNotifications() { return sGet(LS_KEYS.FB_NOTIFS) || []; }
  function getSemesters()             { return sGet(LS_KEYS.SEMESTERS) || []; }
  function getActiveFirestorePlan() {
    const plan = sGet(LS_KEYS.PLAN);
    return plan?._firestorePlan || null;
  }

  /* ════════════════════════════════════════════════════════════════
     7. AUTH HELPERS
     ════════════════════════════════════════════════════════════════ */

  async function getIdToken(forceRefresh = false) {
    if (!_auth) return null;
    const user = _auth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch (err) {
      console.error('[FirebaseDB] getIdToken error:', err);
      return null;
    }
  }

  function getCurrentUserId() { return _userId; }
  function isReady()          { return _initialized && !!_userId; }

  /* ════════════════════════════════════════════════════════════════
     8. LOCAL UPDATE HELPERS (used when agent actions return)
     Now also dispatches events for instant UI updates
     ════════════════════════════════════════════════════════════════ */

  async function addExamLocal(exam) {
    const exams = getUpcomingExams();
    exams.push({ id: `local_${Date.now()}`, ...exam });
    sSet(LS_KEYS.EXAMS, exams);
    window.dispatchEvent(new CustomEvent('uqu:examsUpdated', { detail: { exams } }));
  }

  async function addNotificationLocal(notif) {
    const notifs = getFirebaseNotifications();
    notifs.unshift({ id: `local_${Date.now()}`, read: false, createdAt: new Date().toISOString(), ...notif });
    sSet(LS_KEYS.FB_NOTIFS, notifs);
    const unread = notifs.filter(n => !n.read).length;
    window.dispatchEvent(new CustomEvent('uqu:notificationsUpdated', {
      detail: { notifications: notifs, unreadCount: unread }
    }));
  }

  async function markNotificationReadLocal(id) {
    const notifs = getFirebaseNotifications().map(n => n.id === id ? { ...n, read: true } : n);
    sSet(LS_KEYS.FB_NOTIFS, notifs);

    if (_userId && _db) {
      try {
        await _db.collection('users').doc(_userId)
          .collection('notifications').doc(id)
          .update({ read: true, readAt: new Date().toISOString() });
      } catch (_) {}
    }
  }

  /* ════════════════════════════════════════════════════════════════
     9. IMMEDIATE SYNC HOOKS (Replace debounced sync)
     When DataBridge changes data → push to Firestore immediately
     ════════════════════════════════════════════════════════════════ */

  let _profileSyncTimer = null;
  function scheduleProfileSync() {
    clearTimeout(_profileSyncTimer);
    // Sync within 500ms for near-instant writes, not 3000ms
    _profileSyncTimer = setTimeout(pushProfileToFirestore, 500);
  }

  // Listen for DataBridge save events
  window.addEventListener('uqu:profileSaved', scheduleProfileSync);
  window.addEventListener('uqu:planSaved',    scheduleProfileSync);

  /* ════════════════════════════════════════════════════════════════
     10. PUBLIC API
     ════════════════════════════════════════════════════════════════ */

  window.FirebaseDB = {
    init,
    isReady,
    getCurrentUserId,
    getIdToken,

    // Data access (from localStorage cache)
    getUpcomingExams,
    getFirebaseNotifications,
    getActiveFirestorePlan,
    getSemesters,

    // Sync
    pullFromFirestore,
    pushProfileToFirestore,
    pushTranscriptToFirestore,
    syncSemestersToFirestore,
    pushPlanToFirestore,
    pushChatToFirestore,
    logCompletedSession,

    // Local updates (used when agent actions return)
    addExamLocal,
    addNotificationLocal,
    markNotificationReadLocal,

    // Firestore direct (for advanced use)
    getDb:   () => _db,
    getAuth: () => _auth
  };

  // Auto-init when Firebase SDK is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

}(window));
