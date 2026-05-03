/**
 * ================================================================
 * UQU PROFILE GUARD — Incomplete Profile Protection
 * ================================================================
 * Shows "أكمل البروفايل" messages on features that require
 * profile data when it's missing.
 * ================================================================
 */
(function(window) {
  'use strict';

  const PROFILE_KEY = 'uqu_profile_v2';

  function getRawProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }
    catch { return null; }
  }

  /**
   * Check if profile has required fields filled
   * @param {string[]} fields - Array of field paths like 'basic.name', 'goals.currentGpa'
   * @returns {boolean}
   */
  function hasProfileFields(fields) {
    const raw = getRawProfile();
    if (!raw) return false;
    return fields.every(field => {
      const parts = field.split('.');
      let val = raw;
      for (const p of parts) {
        if (val == null) return false;
        val = val[p];
      }
      return val != null && val !== '' && val !== 0;
    });
  }

  /**
   * Check if basic profile setup is complete
   */
  function isProfileComplete() {
    return hasProfileFields(['basic.name', 'basic.major']);
  }

  /**
   * Check if academic data is filled
   */
  function hasAcademicData() {
    return hasProfileFields(['goals.currentGpa']);
  }

  /**
   * Check if courses are added
   */
  function hasCourses() {
    const raw = getRawProfile();
    return raw?.courses && raw.courses.length > 0;
  }

  /**
   * Create a guard element with "complete profile" message
   * @param {string} message - Optional custom message
   * @returns {HTMLElement}
   */
  function createGuardElement(message) {
    const div = document.createElement('div');
    div.className = 'profile-guard-card';
    div.innerHTML = `
      <div class="profile-guard-icon">🔒</div>
      <div class="profile-guard-text">
        <div class="profile-guard-title">${message || 'أكمل البروفايل ليتم إظهار هذا الحقل'}</div>
        <div class="profile-guard-desc">أضف بياناتك الأكاديمية للوصول إلى هذه الميزة</div>
      </div>
      <a href="profile.html" class="profile-guard-btn">إكمال البروفايل →</a>
    `;
    return div;
  }

  /**
   * Apply guard to a container if profile data is missing
   * @param {string} containerId - DOM element ID
   * @param {string[]} requiredFields - Required profile field paths
   * @param {string} message - Custom message
   * @returns {boolean} true if guard was applied (data missing)
   */
  function applyGuard(containerId, requiredFields, message) {
    if (hasProfileFields(requiredFields)) return false;

    const el = document.getElementById(containerId);
    if (!el) return false;

    el.innerHTML = '';
    el.appendChild(createGuardElement(message));
    return true;
  }

  /**
   * Inject a top banner on dashboard if profile is incomplete
   */
  function injectDashboardBanner() {
    if (isProfileComplete()) return;
    if (document.getElementById('profileGuardBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'profileGuardBanner';
    banner.className = 'profile-guard-banner animate-block';
    banner.innerHTML = `
      <div class="profile-guard-banner-inner">
        <div class="profile-guard-banner-icon">🎓</div>
        <div class="profile-guard-banner-content">
          <div class="profile-guard-banner-title">أكمل إعداد بروفايلك الأكاديمي</div>
          <div class="profile-guard-banner-desc">أضف تخصصك ومعدلك وموادك للحصول على تجربة مخصصة وخطط دراسية ذكية</div>
        </div>
        <a href="profile.html" class="btn-primary profile-guard-banner-btn">إكمال البروفايل →</a>
      </div>
    `;

    // Insert at the top of main content
    const container = document.querySelector('.container');
    const sectionHead = container?.querySelector('.section-head');
    if (sectionHead) {
      sectionHead.parentNode.insertBefore(banner, sectionHead.nextSibling);
    } else if (container) {
      container.prepend(banner);
    }
  }

  /**
   * Apply guards on dashboard cards that depend on profile data
   * Runs after app.js has finished rendering (use with setTimeout)
   */
  function guardDashboardCards() {
    if (isProfileComplete()) return;

    // Find all dashboard cards and overlay a guard on GPA/plan/courses sections
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
      const text = card.textContent || '';
      const isGpaCard = text.includes('المعدل التراكمي') || text.includes('GPA');
      const isPlanCard = text.includes('خطة المذاكرة') || text.includes('الخطة الأسبوعية');
      const isCoursesCard = text.includes('المواد الدراسية') || text.includes('اختبارات');

      if (isGpaCard || isPlanCard || isCoursesCard) {
        // Add overlay if not already added
        if (card.querySelector('.profile-guard-overlay')) return;
        card.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = 'profile-guard-overlay';
        overlay.innerHTML = `
          <div class="profile-guard-overlay-content">
            <span class="profile-guard-overlay-icon">🔒</span>
            <span class="profile-guard-overlay-text">أكمل البروفايل ليتم إظهار هذا الحقل</span>
            <a href="profile.html" class="profile-guard-overlay-link">إكمال البروفايل →</a>
          </div>
        `;
        card.appendChild(overlay);
      }
    });
  }

  // Public API
  window.UQUProfileGuard = {
    isProfileComplete,
    hasAcademicData,
    hasCourses,
    hasProfileFields,
    applyGuard,
    createGuardElement,
    injectDashboardBanner,
    guardDashboardCards,
  };

  // Auto-run on dashboard page
  if (document.body?.dataset?.page === 'dashboard') {
    window.addEventListener('load', function() {
      setTimeout(function() {
        injectDashboardBanner();
        guardDashboardCards();
      }, 1500);
    });
  }

  console.log('%cUQU ProfileGuard ✓', 'background:#0f172a;color:#f59e0b;padding:2px 7px;border-radius:4px;');
})(window);
