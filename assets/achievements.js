/**
 * ----------------------------------------------------------------
 * UQU ACHIEVEMENTS v2.0 — Thin Client Wrapper
 * ----------------------------------------------------------------
 * All badge calculation, XP logic, level math moved to backend.
 * This file: Display-only wrapper for frontend integration.
 * Public API: window.UQUAchievements.* (same as before)
 * ----------------------------------------------------------------
 */

(function (window) {
  'use strict';

  function _getBackendBase() {
    return window.UQU_BACKEND_URL || window.BACKEND_URL || (window.location?.origin.startsWith('http') ? window.location.origin : 'http://localhost:8000');
  }

  async function _getIdToken() {
    try { if (window.firebase?.auth) { const u = window.firebase.auth().currentUser; if (u) return await u.getIdToken(); } } catch (_) { }
    if (window.FirebaseAuth?.getIdToken) { try { return await window.FirebaseAuth.getIdToken(); } catch (_) { } }
    return null;
  }

  async function _apiCall(path, method, body) {
    const token = await _getIdToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(_getBackendBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  let _cachedData = null;

  const UQUAchievements = {
    async loadData() {
      try {
        _cachedData = await _apiCall('/api/achievements/data', 'GET');
        return _cachedData;
      } catch (err) {
        console.error('[Achievements]', err);
        return null;
      }
    },

    async getData() {
      if (!_cachedData) await this.loadData();
      return _cachedData;
    },

    async addXP(reason, amount) {
      try {
        const result = await _apiCall('/api/achievements/add-xp', 'POST', { reason, amount });
        _cachedData = null;
        return result;
      } catch (err) {
        console.error('[Achievements]', err);
        return null;
      }
    },

    async checkBadges(triggerSource) {
      try {
        const result = await _apiCall('/api/achievements/check', 'POST', { triggerSource });
        _cachedData = null;
        return result;
      } catch (err) {
        console.error('[Achievements]', err);
        return null;
      }
    },

    async sync(state) {
      try {
        await _apiCall('/api/achievements/sync', 'POST', state);
      } catch (err) {
        console.error('[Achievements]', err);
      }
    }
  };

  window.UQUAchievements = UQUAchievements;

})(window);
