/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — University News Module v2.0
 * Displays curated UQU news with RSS upgrade when online.
 * Works on file:// and http(s):// protocols.
 * ================================================================
 */

(function () {
  'use strict';

  var NEWS_CACHE_KEY = 'uqu_news_cache';
  var NEWS_CACHE_TTL = 30 * 60 * 1000; // 30 min
  var RSS_PROXY      = 'https://api.rss2json.com/v1/api.json?rss_url=';
  // UQU X (Twitter) handle for official news
  var UQU_X_HANDLE   = 'UmmAlQuraUniv';
  var UQU_X_URL      = 'https://x.com/' + UQU_X_HANDLE;
  // Multiple RSS sources to try (fallback chain)
  var RSS_SOURCES    = [
    'https://uqu.edu.sa/news/rss',
    'https://uqu.edu.sa/rss',
    // Nitter mirror for X timeline (RSS-able, free)
    'https://nitter.net/' + UQU_X_HANDLE + '/rss'
  ];
  var MAX_ITEMS      = 6;

  // ── Curated fallback — always available offline ──
  var FALLBACK_NEWS = [
    {
      title: '@UmmAlQuraUniv — حساب الجامعة الرسمي على إكس',
      description: 'تابع آخر الأخبار والإعلانات الرسمية من جامعة أم القرى مباشرة عبر منصة إكس.',
      link: UQU_X_URL,
      date: new Date().toISOString(),
      category: 'إكس'
    },
    {
      title: 'التقويم الأكاديمي — الفصل الدراسي الثاني 1447هـ',
      description: 'تعرف على مواعيد بداية الدراسة والاختبارات والإجازات الرسمية لهذا الفصل.',
      link: 'https://uqu.edu.sa/academic-calendar',
      date: new Date().toISOString(),
      category: 'تقويم'
    },
    {
      title: 'بوابة القبول والتسجيل — جامعة أم القرى',
      description: 'آخر الإعلانات المتعلقة بالقبول والتسجيل وتأجيل الفصول الدراسية.',
      link: 'https://uqu.edu.sa/admission',
      date: new Date().toISOString(),
      category: 'قبول'
    },
    {
      title: 'الخدمات الإلكترونية للطلاب',
      description: 'تصفح كل الخدمات الإلكترونية المتاحة: السجل الأكاديمي، الحذف والإضافة، وغيرها.',
      link: 'https://uqu.edu.sa/eservices',
      date: new Date().toISOString(),
      category: 'خدمات'
    },
    {
      title: 'المكتبة الرقمية — موارد البحث العلمي',
      description: 'استفد من قواعد البيانات والمراجع الإلكترونية المتاحة عبر مكتبة الجامعة.',
      link: 'https://uqu.edu.sa/lib',
      date: new Date().toISOString(),
      category: 'مكتبة'
    },
    {
      title: 'برنامج الإرشاد الأكاديمي',
      description: 'تواصل مع مرشدك الأكاديمي للحصول على نصائح حول خطتك الدراسية وتحسين أدائك.',
      link: 'https://uqu.edu.sa',
      date: new Date().toISOString(),
      category: 'إرشاد'
    }
  ];

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

  // ── Render news cards into the grid ──
  function renderNews(items) {
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

  // ── Try one RSS source via proxy ──
  function fetchOneSource(rssUrl, cb) {
    var controller = null;
    var timeoutId = null;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(function () { try { controller.abort(); } catch(_){} }, 6000);
    } catch (e) {}

    var fetchOpts = {};
    if (controller) fetchOpts.signal = controller.signal;

    fetch(RSS_PROXY + encodeURIComponent(rssUrl), fetchOpts)
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) throw new Error('http_' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.status === 'ok' && data.items && data.items.length) {
          var isX = rssUrl.indexOf('nitter') !== -1 || rssUrl.indexOf('twitter') !== -1;
          var items = data.items.slice(0, MAX_ITEMS).map(function (item) {
            var desc = (item.description || item.content || '')
              .replace(/<[^>]*>/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160);
            // For X posts, rewrite link to x.com (more reliable than nitter)
            var link = item.link || '#';
            if (isX && link) {
              link = link.replace(/https?:\/\/(www\.)?nitter\.[^\/]+/i, 'https://x.com');
            }
            return {
              title: (item.title || '').slice(0, 120) || (isX ? 'تحديث من حساب الجامعة' : 'خبر'),
              description: desc,
              link: link,
              date: item.pubDate || new Date().toISOString(),
              category: isX ? 'إكس' : ((item.categories && item.categories[0]) || 'أخبار')
            };
          });
          cb(items);
        } else {
          cb(null);
        }
      })
      .catch(function () {
        if (timeoutId) clearTimeout(timeoutId);
        cb(null);
      });
  }

  // ── Try to fetch from RSS sources in order; first success wins ──
  function tryFetchRSS(callback) {
    // Skip fetch on file:// protocol
    if (location.protocol === 'file:') {
      callback(null);
      return;
    }

    // Check localStorage cache
    try {
      var cached = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < NEWS_CACHE_TTL && cached.items && cached.items.length) {
        callback(cached.items);
        return;
      }
    } catch (e) {}

    // Sequentially try each source until one succeeds
    var i = 0;
    function tryNext() {
      if (i >= RSS_SOURCES.length) {
        callback(null);
        return;
      }
      var src = RSS_SOURCES[i++];
      fetchOneSource(src, function (items) {
        if (items && items.length) {
          try {
            localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ ts: Date.now(), items: items, src: src }));
          } catch (e) {}
          callback(items);
        } else {
          tryNext();
        }
      });
    }
    tryNext();
  }

  // ── Init ──
  function init() {
    var grid = document.getElementById('uquNewsGrid');
    if (!grid) return;

    // Render fallback immediately so user sees content right away
    renderNews(FALLBACK_NEWS);

    // Then try to upgrade with live RSS data
    tryFetchRSS(function (liveItems) {
      if (liveItems && liveItems.length) {
        renderNews(liveItems);
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 200); });
  } else {
    setTimeout(init, 200);
  }
})();
