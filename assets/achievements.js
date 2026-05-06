/**
 * ----------------------------------------------------------------
 * UQU ACHIEVEMENTS v2.0 � Thin Client Wrapper
 * ----------------------------------------------------------------
 * All badge calculation, XP logic, level math moved to backend.
 * This file: Display-only wrapper for frontend integration.
 * Public API: window.UQUAchievements.* (same as before)
 * ----------------------------------------------------------------
 */

(function (window) {
  'use strict';

  async function _apiCall(path, method, body) {
    // Guard: skip silently if the user is not authenticated yet.
    const token = await window.UQUCore.api.getToken();
    if (!token) {
      const err = new Error('NOT_AUTHENTICATED');
      err.silent = true;
      throw err;
    }
    try {
      if (method === 'GET') return await window.UQUCore.api.get(path);
      return await window.UQUCore.api.post(path, body);
    } catch (err) {
      // Preserve the original silent-fail contract: a 401 from the backend
      // means the token expired between the check above and the actual request.
      // Mark it silent so _logIfNotSilent() swallows it without console noise.
      if (err.status === 401) err.silent = true;
      throw err;
    }
  }

  function _logIfNotSilent(err) {
    if (err && err.silent) return;
    console.error('[Achievements]', err);
  }

  let _cachedData = null;

  const UQUAchievements = {
    async loadData() {
      try {
        _cachedData = await _apiCall('/api/achievements/data', 'GET');
        return _cachedData;
      } catch (err) {
        _logIfNotSilent(err);
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
        _logIfNotSilent(err);
        return null;
      }
    },

    async checkBadges(triggerSource) {
      try {
        const result = await _apiCall('/api/achievements/check', 'POST', { triggerSource });
        _cachedData = null;
        return result;
      } catch (err) {
        _logIfNotSilent(err);
        return null;
      }
    },

    async sync(state) {
      try {
        await _apiCall('/api/achievements/sync', 'POST', state);
      } catch (err) {
        _logIfNotSilent(err);
      }
    },

    /**
     * Render the full badges grid into the given container element.
     * Falls back to UQUAuth.getAchievements() if backend data is unavailable.
     */
    async renderFullBadgesPage(panelId) {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      panel.style.display = 'block';
      panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">جاري تحميل الإنجازات…</div>';

      let badges = null;
      let xp = 0, level = 0;
      try {
        const data = await this.getData();
        if (data) {
          badges = data.badges || data.achievements || null;
          xp = data.xp || 0;
          level = data.level || 0;
        }
      } catch (_) { /* fall through to local */ }

      // Fallback: use UQUAuth.getAchievements() if backend gave us nothing
      if (!badges && window.UQUAuth?.getAchievements) {
        badges = window.UQUAuth.getAchievements();
      }
      if (!badges || !badges.length) {
        panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">لا توجد إنجازات متاحة حالياً.</div>';
        return;
      }

      const earnedCount = badges.filter(b => b.earned).length;
      const header = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-weight:800;font-size:1rem;">إنجازاتك</div>
            <div style="color:var(--muted);font-size:.8rem;margin-top:2px;">${earnedCount} / ${badges.length} محقّق</div>
          </div>
          ${level ? `<div style="display:flex;gap:8px;align-items:center;">
            <span style="background:var(--accent-dim);color:var(--accent);padding:4px 10px;border-radius:99px;font-size:.75rem;font-weight:700;">Lv ${level}</span>
            <span style="color:var(--muted);font-size:.75rem;">${xp} XP</span>
          </div>` : ''}
        </div>`;

      const grid = badges.map(b => {
        const earned = b.earned ? 'earned' : 'locked';
        return `<div class="achievement-badge ${earned}" title="${b.desc || ''}">
          <div class="badge-icon">${b.icon || '🏅'}</div>
          <div class="badge-name">${b.name || b.id || ''}</div>
          <div class="badge-desc">${b.desc || ''}</div>
          <div style="font-size:.62rem;color:${b.earned ? 'var(--success)' : 'var(--muted)'};margin-top:4px;font-weight:700;">${b.earned ? '✓ محقق' : 'مقفل'}</div>
        </div>`;
      }).join('');

      panel.innerHTML = header + `<div class="achievements-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">${grid}</div>`;
    }
  };

  window.UQUAchievements = UQUAchievements;

})(window);
