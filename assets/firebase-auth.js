/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — Firebase Auth Bridge v1.0
 * ================================================================
 * يعمل بجانب auth.js الموجود مسبقاً.
 * عند تسجيل الدخول/الخروج عبر auth.js → يزامن Firebase Auth
 * يوفر: getIdToken() للاستخدام مع Cloud Functions
 * ================================================================
 */

(function (window) {
  'use strict';

  let _fbAuth        = null;
  let _fbUser        = null;
  let _initialized   = false;

  /* ════════════════════════════════════════════════════════════════
     1. INIT — called after Firebase SDK loads
     ════════════════════════════════════════════════════════════════ */

  function init() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
      return;
    }
    _fbAuth      = firebase.auth();
    _initialized = true;

    // Monitor Firebase auth state
    _fbAuth.onAuthStateChanged(user => {
      _fbUser = user;
      if (user) {
        // Initialize Firestore DB layer
        if (window.FirebaseDB) window.FirebaseDB.init();
      }
    });

    // Hook into existing UQU auth system
    _hookIntoUQUAuth();
  }

  /* ════════════════════════════════════════════════════════════════
     2. HOOK INTO EXISTING auth.js EVENTS
     ════════════════════════════════════════════════════════════════ */

  function _hookIntoUQUAuth() {
    // auth.js ALREADY signs in via firebase.auth().signInWithEmailAndPassword
    // with the user's actual password during register()/login(). This bridge
    // used to try to sign in *again* with a derived password (UQU_<id>_<hash>),
    // which always failed and silently fell back to anonymous auth — that
    // wiped the real session, gave the user an anonymous UID, and Firestore
    // rules then blocked every read/write because the authed UID no longer
    // matched the document path. So we just listen for logout to clean up.
    window.addEventListener('uqu:auth', async (e) => {
      const { type } = e.detail || {};
      if (type === 'logout') {
        await _syncFirebaseSignOut();
      }
    });
  }

  async function _syncFirebaseSignOut() {
    if (!_fbAuth) return;
    try {
      await _fbAuth.signOut();
      _fbUser = null;
      
      // The Purge: Cleanup all uqu_ local storage data on sign out
      console.warn('[FirebaseAuth] The Purge: Executing cleanup of all uqu_ localStorage data to ensure session isolation.');
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('uqu_') && key !== 'uqu_users_db_v2' && key !== 'uqu_theme') {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        console.warn(`[FirebaseAuth] The Purge: Successfully removed ${keysToRemove.length} keys.`);
      } catch (purgeErr) {
        console.error('[FirebaseAuth] The Purge error:', purgeErr);
      }
      
    } catch (err) {
      console.error('[FirebaseAuth] Sign-out error:', err);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════════════════ */

  /**
   * Get Firebase ID token for authenticating Cloud Function calls
   * @returns {Promise<string|null>}
   */
  async function getIdToken() {
    // Try FirebaseDB first (shares the same auth instance)
    if (window.FirebaseDB && window.FirebaseDB.isReady()) {
      return window.FirebaseDB.getIdToken();
    }
    if (!_fbAuth) return null;
    const user = _fbAuth.currentUser;
    if (!user) return null;
    try { return await user.getIdToken(); }
    catch (err) { console.error('[FirebaseAuth] getIdToken error:', err); return null; }
  }

  /**
   * Get current Firebase UID
   */
  function getUid() {
    return _fbAuth?.currentUser?.uid || null;
  }

  /**
   * Check if user is authenticated with Firebase
   */
  function isAuthenticated() {
    return !!_fbAuth?.currentUser;
  }

  window.FirebaseAuth = { init, getIdToken, getUid, isAuthenticated };

  // Auto-init after DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

}(window));
