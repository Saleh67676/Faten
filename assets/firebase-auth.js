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
    // Listen for UQU login/register/logout events
    window.addEventListener('uqu:auth', async (e) => {
      const { type, user } = e.detail || {};

      if (type === 'login' || type === 'register') {
        await _syncFirebaseSignIn(user);
      } else if (type === 'logout') {
        await _syncFirebaseSignOut();
      }
    });
  }

  /* ════════════════════════════════════════════════════════════════
     3. SIGN IN WITH FIREBASE (mirror of UQU auth)
     ════════════════════════════════════════════════════════════════ */

  async function _syncFirebaseSignIn(uquUser) {
    if (!_fbAuth || !uquUser?.email) return;

    // Already signed in as same user → skip
    if (_fbUser && _fbUser.email === uquUser.email) return;

    try {
      // Try to sign in — if fails, create new account
      await _fbAuth.signInWithEmailAndPassword(uquUser.email, _derivePassword(uquUser));
    } catch (signInErr) {
      if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/wrong-password') {
        try {
          // Create Firebase account mirroring UQU account
          await _fbAuth.createUserWithEmailAndPassword(uquUser.email, _derivePassword(uquUser));

          // Update display name
          if (_fbAuth.currentUser && uquUser.name) {
            await _fbAuth.currentUser.updateProfile({ displayName: uquUser.name });
          }
        } catch (createErr) {
          console.error('[FirebaseAuth] Create account failed:', createErr.code);
          // Use anonymous auth as fallback
          await _anonymousFallback();
        }
      } else if (signInErr.code === 'auth/invalid-email') {
        await _anonymousFallback();
      } else {
        console.error('[FirebaseAuth] Sign-in error:', signInErr.code);
        await _anonymousFallback();
      }
    }
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

  async function _anonymousFallback() {
    if (!_fbAuth) return;
    try {
      // Use anonymous auth so Firestore security rules still work
      if (!_fbUser) {
        await _fbAuth.signInAnonymously();
      }
    } catch (err) {
      console.error('[FirebaseAuth] Anonymous auth failed:', err.code);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     4. DERIVE FIREBASE PASSWORD FROM UQU SESSION
     (Firebase needs a password — we derive it from stored hash)
     ════════════════════════════════════════════════════════════════ */

  function _derivePassword(uquUser) {
    // Use a stable identifier — NOT the plaintext password (we never have that)
    // Instead use: UQU_ + userId + first 8 chars of stored hash
    const userId = uquUser.id || uquUser.userId || '';
    const hash   = uquUser.passwordHash || '';
    const base   = `UQU_${userId}_${hash.slice(0, 8)}`;
    // Ensure min 6 chars
    return base.length >= 6 ? base : `UQU_${userId}_default`;
  }

  /* ════════════════════════════════════════════════════════════════
     5. PUBLIC API
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
