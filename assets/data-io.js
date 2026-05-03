/**
 * ================================================================
 * UQU ACADEMIC ASSISTANT — DATA EXPORT/IMPORT v1.0
 * Full data backup, export, and import with device transfer support
 * ================================================================
 */

(function (window) {
  'use strict';

  const ALL_KEYS = [
    'uqu_profile_v2',
    'uqu_plan_v5',
    'gpa_data',
    'uqu_pomodoro_v1',
    'uqu_achievements_v1',
    'uqu_chat_history_v1',
    'uqu_theme',
    'uqu_notifications',
  ];

  // ──────────────────────────────────────────────
  // 1. EXPORT
  // ──────────────────────────────────────────────

  function exportAll() {
    const data = {};
    ALL_KEYS.forEach(key => {
      try {
        const val = localStorage.getItem(key);
        if (val) data[key] = JSON.parse(val);
      } catch {}
    });

    const exportObj = {
      _meta: {
        app: 'UQU Academic Assistant',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        keysCount: Object.keys(data).length,
      },
      data
    };

    return exportObj;
  }

  function downloadJSON() {
    const obj = exportAll();
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `uqu-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.UQUCore?.toast) {
      window.UQUCore.toast('تم تصدير البيانات بنجاح!', 'success');
    }
  }

  // ──────────────────────────────────────────────
  // 2. IMPORT
  // ──────────────────────────────────────────────

  function importFromJSON(jsonString) {
    try {
      const obj = JSON.parse(jsonString);

      if (!obj._meta || !obj.data) {
        return { ok: false, error: 'ملف غير صالح. يجب أن يكون ملف تصدير من المساعد الأكاديمي.' };
      }

      let imported = 0;
      Object.entries(obj.data).forEach(([key, value]) => {
        if (ALL_KEYS.includes(key)) {
          localStorage.setItem(key, JSON.stringify(value));
          imported++;
        }
      });

      return { ok: true, imported, date: obj._meta.exportedAt };
    } catch (e) {
      return { ok: false, error: 'خطأ في قراءة الملف: ' + e.message };
    }
  }

  function triggerFileImport(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = importFromJSON(ev.target.result);
        if (callback) callback(result);

        if (result.ok) {
          if (window.UQUCore?.toast) {
            window.UQUCore.toast(`تم استيراد ${result.imported} عنصر بنجاح!`, 'success');
          }
        } else {
          if (window.UQUCore?.toast) {
            window.UQUCore.toast(result.error, 'danger');
          }
        }
      };
      reader.readAsText(file);
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }

  // ──────────────────────────────────────────────
  // 3. SELECTIVE EXPORT
  // ──────────────────────────────────────────────

  function exportProfile() {
    return exportSpecific(['uqu_profile_v2']);
  }

  function exportGPA() {
    return exportSpecific(['gpa_data', 'uqu_profile_v2']);
  }

  function exportPlan() {
    return exportSpecific(['uqu_plan_v5']);
  }

  function exportSpecific(keys) {
    const data = {};
    keys.forEach(key => {
      try {
        const val = localStorage.getItem(key);
        if (val) data[key] = JSON.parse(val);
      } catch {}
    });
    return data;
  }

  // ──────────────────────────────────────────────
  // 4. DATA STATS
  // ──────────────────────────────────────────────

  function getDataStats() {
    const stats = {
      totalSize: 0,
      items: []
    };

    const labels = {
      'uqu_profile_v2': { name: 'البروفايل', icon: '👤' },
      'uqu_plan_v5': { name: 'الخطة الدراسية', icon: '📅' },
      'gpa_data': { name: 'بيانات المعدل', icon: '🧮' },
      'uqu_pomodoro_v1': { name: 'بيانات بومودورو', icon: '⏱️' },
      'uqu_achievements_v1': { name: 'الإنجازات', icon: '🏆' },
      'uqu_chat_history_v1': { name: 'سجل المحادثات', icon: '💬' },
      'uqu_theme': { name: 'إعدادات المظهر', icon: '🎨' },
      'uqu_notifications': { name: 'الإشعارات', icon: '🔔' },
    };

    ALL_KEYS.forEach(key => {
      const val = localStorage.getItem(key);
      if (val) {
        const size = new Blob([val]).size;
        stats.totalSize += size;
        const label = labels[key] || { name: key, icon: '📦' };
        stats.items.push({
          key,
          ...label,
          size,
          sizeStr: formatBytes(size),
          exists: true
        });
      }
    });

    stats.totalSizeStr = formatBytes(stats.totalSize);
    return stats;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ──────────────────────────────────────────────
  // 5. CLEAR ALL DATA
  // ──────────────────────────────────────────────

  function clearAllData() {
    ALL_KEYS.forEach(key => localStorage.removeItem(key));
  }

  // ──────────────────────────────────────────────
  // 6. RENDER DATA MANAGEMENT PANEL
  // ──────────────────────────────────────────────

  function renderDataPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const stats = getDataStats();

    let html = `
      <div style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <span class="muted" style="font-size:.82rem;">الحجم الإجمالي: ${stats.totalSizeStr}</span>
          <span class="muted" style="font-size:.82rem;">${stats.items.length} عناصر محفوظة</span>
        </div>
      </div>
      <div class="data-io-panel">
    `;

    // Export button
    html += `
      <div class="data-io-card" id="btnExportAll" role="button" tabindex="0">
        <div class="data-io-icon" style="background:var(--accent-dim); border:1px solid var(--accent-glow);">📤</div>
        <div>
          <div style="font-weight:700; font-size:.92rem;">تصدير جميع البيانات</div>
          <div class="muted" style="font-size:.78rem;">حفظ نسخة احتياطية كاملة كملف JSON</div>
        </div>
      </div>
    `;

    // Import button
    html += `
      <div class="data-io-card" id="btnImportAll" role="button" tabindex="0">
        <div class="data-io-icon" style="background:var(--accent-2-dim); border:1px solid rgba(6,182,212,.2);">📥</div>
        <div>
          <div style="font-weight:700; font-size:.92rem;">استيراد بيانات</div>
          <div class="muted" style="font-size:.78rem;">استعادة نسخة احتياطية من ملف JSON</div>
        </div>
      </div>
    `;

    html += `</div>`;

    // Data items list
    html += `<div style="margin-top:20px;"><h4 style="font-size:.85rem; color:var(--muted); margin-bottom:12px;">البيانات المحفوظة</h4>`;
    stats.items.forEach(item => {
      html += `
        <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border);">
          <span style="font-size:1.2rem;">${item.icon}</span>
          <span style="flex:1; font-size:.88rem; font-weight:600;">${item.name}</span>
          <span class="muted" style="font-size:.75rem;">${item.sizeStr}</span>
        </div>
      `;
    });
    html += `</div>`;

    container.innerHTML = html;

    // Bind events
    document.getElementById('btnExportAll')?.addEventListener('click', downloadJSON);
    document.getElementById('btnImportAll')?.addEventListener('click', () => {
      triggerFileImport((result) => {
        if (result.ok) {
          setTimeout(() => location.reload(), 1000);
        }
      });
    });
  }

  // ──────────────────────────────────────────────
  // 7. EXPOSE
  // ──────────────────────────────────────────────

  window.UQUDataIO = {
    exportAll,
    downloadJSON,
    importFromJSON,
    triggerFileImport,
    exportProfile,
    exportGPA,
    exportPlan,
    getDataStats,
    clearAllData,
    renderDataPanel,
  };


})(window);
