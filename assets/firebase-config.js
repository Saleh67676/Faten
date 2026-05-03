/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — Firebase Configuration
 * ================================================================
 * 📌 أضف قيمك من: Firebase Console → Project Settings → General
 *    → Your apps → Web app → SDK setup and configuration
 * ================================================================
 */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAVxQUiLmLQK7Hc_j97vMq2YLEgN1-PoTo",
  authDomain:        "fatan-2648a.firebaseapp.com",
  projectId:         "fatan-2648a",
  storageBucket:     "fatan-2648a.firebasestorage.app",
  messagingSenderId: "270666822809",
  appId:             "1:270666822809:web:fb2dc16f256ea942adf408",
  measurementId:     "G-EE12XVF3PK"
};

// ─────────────────────────────────────────
// FastAPI Backend Endpoint
//  🖥  محلي: http://localhost:8000
//  🌐  إنتاج: Replace with your deployed FastAPI URL
// ─────────────────────────────────────────
const AGENT_BASE_URL = "http://localhost:8000";

// ─────────────────────────────────────────
// Initialize Firebase
// ─────────────────────────────────────────
(function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.warn('[Firebase] SDK not loaded — add CDN scripts before this file');
    return;
  }
  if (firebase.apps && firebase.apps.length > 0) return;

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    console.log('[Firebase] ✅ Project:', FIREBASE_CONFIG.projectId);
  } catch (e) {
    console.error('[Firebase] ❌ Init failed:', e.message);
  }
})();

window.FIREBASE_CONFIG = FIREBASE_CONFIG;
window.AGENT_BASE_URL  = AGENT_BASE_URL;
