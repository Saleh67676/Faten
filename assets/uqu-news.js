/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — University News Module v3.0 (Thin Client)
 * Fetches curated UQU news from the FastAPI backend.
 * Public API: window.UQUNews.renderNews()
 * ================================================================
 */

(function (window) {
  'use strict';

  var categoryColors = {
    'تقويم': 'var(--accent)',
    'قبول': 'var(--success)',
    'خدمات': 'var(--accent-2)',
    'مكتبة': 'var(--warning)',
    'إرشاد': 'var(--accent-3)',
    'تطبيقات': 'var(--accent-2)',
    'إكس': '#1d9bf0',
    'X': '#1d9bf0',
    'أخبار': 'var(--accent)'
  };

  function _getBackendBase() {
    return window.AGENT_BASE_URL || 'http://localhost:8000';
  }

  // ── Render news cards into the grid ──
  function _renderNewsHTML(items) {
    var grid = document.getElementById('uquNewsGrid');
    if (!grid) return;

    grid.innerHTML = items.map(function (item, i) {
      var color = categoryColors[item.category] || 'var(--accent)';
      var delay = Math.min(i * 100, 500);
      var dateStr = '';
      try {
        dateStr = new Date(item.date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
      } catch (e) {}

      return '<a href="' + item.link + '" target="_blank" rel="noopener"' +
        ' class="card animate-block" data-ripple' +
        ' style="text-decoration:none;padding:20px;transition:transform .18s,border-color .18s,box-shadow .18s;animation-delay:' + delay + 'ms;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
          '<span style="font-size:.7rem;font-weight:700;padding:4px 12px;border-radius:99px;background:' + color + '18;color:' + color + ';border:1px solid ' + color + '30;">' +
            (item.category || 'أخبار') +
          '</span>' +
          '<span style="font-size:.7rem;color:var(--muted);">' + dateStr + '</span>' +
        '</div>' +
        '<h4 style="font-size:.9rem;font-weight:700;line-height:1.7;margin-bottom:8px;color:var(--fg);">' +
          item.title +
        '</h4>' +
        '<p style="font-size:.8rem;color:var(--muted);line-height:1.6;margin:0;">' +
          item.description +
        '</p>' +
      '</a>';
    }).join('');
  }

  async function renderNews() {
    try {
      const response = await fetch(_getBackendBase() + '/api/news', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('News fetch failed');
      const data = await response.json();
      if (data && data.items) {
        _renderNewsHTML(data.items);
      }
    } catch (err) {
      console.warn('[UQUNews] Fetch error:', err);
    }
  }

  // Preserve public API
  window.UQUNews = { renderNews };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(renderNews, 200); });
  } else {
    setTimeout(renderNews, 200);
  }
})(window);
