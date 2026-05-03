/**
 * ════════════════════════════════════════════════════════════════
 * UQU TRANSCRIPT PARSER v2.0 — Smart Semester-Aware PDF Analyzer
 * ════════════════════════════════════════════════════════════════
 * COMPLETELY REWRITTEN: Position-aware PDF extraction with:
 * - Precise column detection from table headers
 * - Automatic semester boundary detection
 * - Course classification: completed / registered / current
 * - Bilingual support (Arabic + English) with smart name extraction
 * - Beautiful semester-separated preview rendering
 * ════════════════════════════════════════════════════════════════
 */
(function(window) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     CONSTANTS & MAPS
     ═══════════════════════════════════════════════════════════ */

  const COURSE_CODE_RE = /^[A-Z]{2,4}\d{3,4}T?$/;

  const GRADE_MAP = {
    'A+': 5.00, 'A': 4.75, 'B+': 4.50, 'B': 4.00,
    'C+': 3.50, 'C': 3.00, 'D+': 2.50, 'D': 2.00,
    'F': 1.00, 'DN': 0,
    'W': null, 'IP': null, 'IC': null, 'NP': null,
  };

  const GRADE_COLORS = {
    'A+': '#10b981', 'A': '#10b981', 'B+': '#06b6d4', 'B': '#06b6d4',
    'C+': '#f59e0b', 'C': '#f59e0b', 'D+': '#f97316', 'D': '#f97316',
    'F': '#ef4444', 'DN': '#ef4444',
  };

  const GRADE_LABELS = {
    'A+': 'ممتاز مرتفع', 'A': 'ممتاز', 'B+': 'جيد جداً مرتفع', 'B': 'جيد جداً',
    'C+': 'جيد مرتفع', 'C': 'جيد', 'D+': 'مقبول مرتفع', 'D': 'مقبول',
    'F': 'راسب', 'DN': 'محروم',
  };

  // Arabic labels to skip when extracting course names
  const AR_SKIP_LABELS = /^(رمز|اسم|معتمدة|مكتسبة|الدرجة|التقدير|النقاط|المجموع|الفصل|الكلية|القسم|التخصص|الحالة|منتظم|ممتاز|جيد|مقبول|راسب|محروم|النقاط|الساعات|Course|Code|Name|Crd|Pass|Degree|Grade|Points|Hours|Hourse|sum|Faculty|Dept|Status|Major)/i;

  // Arabic numeral conversion
  function arNum(s) {
    if (!s) return '';
    return String(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.');
  }

  /* ═══════════════════════════════════════════════════════════
     1. PDF TEXT EXTRACTION (POSITION-AWARE)
     ═══════════════════════════════════════════════════════════ */

  async function extractPages(file) {
    if (!window.pdfjsLib) throw new Error('مكتبة pdf.js غير محملة');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1.0 });
      pages.push({
        items: content.items
          .filter(it => it.str && it.str.trim())
          .map(it => {
            // Normalize Arabic Presentation Forms (U+FB50–U+FEFF) to standard Arabic
            // PDFs commonly use these forms which break regex matching
            var raw = it.str.trim();
            var s = typeof raw.normalize === 'function' ? raw.normalize('NFKC') : raw;
            return {
              s: s,
              x: Math.round(it.transform[4] * 10) / 10,
              y: Math.round(it.transform[5] * 10) / 10,
              w: Math.round(it.width * 10) / 10,
            };
          }),
        pw: Math.round(vp.width),
        ph: Math.round(vp.height),
      });
    }
    return pages;
  }

  /* ═══════════════════════════════════════════════════════════
     2. ROW BUILDING — Group text items by Y-coordinate
     ═══════════════════════════════════════════════════════════ */

  function buildRows(items, tol) {
    if (!items.length) return [];
    tol = tol || 3;
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    let curr = [sorted[0]], cy = sorted[0].y;

    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].y - cy) <= tol) {
        curr.push(sorted[i]);
      } else {
        curr.sort((a, b) => a.x - b.x);
        rows.push(curr);
        curr = [sorted[i]];
        cy = sorted[i].y;
      }
    }
    if (curr.length) {
      curr.sort((a, b) => a.x - b.x);
      rows.push(curr);
    }
    return rows;
  }

  /* ═══════════════════════════════════════════════════════════
     3. COLUMN DETECTION — Find table column X-positions
     ═══════════════════════════════════════════════════════════ */

  function detectColumns(rows, pw) {
    var mid = pw / 2;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var left = row.filter(function(i) { return i.x < mid; });
      var txt = left.map(function(i) { return i.s; }).join(' ');

      // Look for English table header row
      if (/Course/i.test(txt) && (/Code/i.test(txt) || /Name/i.test(txt)) && (/Grade/i.test(txt) || /Degree/i.test(txt) || /Points/i.test(txt) || /Hours/i.test(txt))) {
        var cols = {};
        for (var j = 0; j < left.length; j++) {
          var item = left[j];
          var sl = item.s.toLowerCase().trim();
          if (/course\s*code/i.test(item.s)) { cols.code = item.x; }
          else if (sl === 'course' && !cols.code) { cols.code = item.x; }
          else if (/course\s*name/i.test(item.s)) { cols.name = item.x; }
          // Credit hours column: "Crd.", "Crd", "Hours", "Hrs", "Hrs."
          else if (sl === 'crd.' || sl === 'crd' || sl === 'hrs.' || sl === 'hrs') { cols.crd = item.x; }
          else if (sl === 'hours' && !cols.crd) { cols.crd = item.x; }
          // Passed hours column: "Pass", "Hourse" (common typo), "Passed"
          else if (sl === 'pass' || sl === 'hourse' || sl === 'passed') { cols.pass = item.x; }
          else if (sl === 'hours' && cols.crd) { cols.pass = item.x; }
          else if (sl === 'degree') { cols.deg = item.x; }
          else if (sl === 'grade') { cols.grade = item.x; }
          else if (sl === 'points') { cols.pts = item.x; }
        }
        if (Object.keys(cols).length >= 3) return cols;
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════
     4. COURSE ROW PARSER — Extract course data from a row
     ═══════════════════════════════════════════════════════════ */

  function parseCourseRow(rowItems, mid, cols) {
    // Extend left boundary to include all English data columns (Points column often sits at page midpoint)
    var dataBound = mid;
    if (cols) {
      var maxCol = 0;
      for (var ck in cols) { if (cols.hasOwnProperty(ck) && cols[ck] > maxCol) maxCol = cols[ck]; }
      dataBound = Math.max(mid, maxCol + 50);
    }
    var left = rowItems.filter(function(i) { return i.x < dataBound; }).sort(function(a, b) { return a.x - b.x; });
    var right = rowItems.filter(function(i) { return i.x >= dataBound; });

    // Find course code
    var code = null, codeItem = null;
    for (var i = 0; i < left.length; i++) {
      var cleaned = left[i].s.replace(/\s/g, '');
      if (COURSE_CODE_RE.test(cleaned)) {
        code = cleaned;
        codeItem = left[i];
        break;
      }
    }
    if (!code) return null;

    // Skip header rows that accidentally match
    var rowText = rowItems.map(function(i) { return i.s; }).join(' ');
    if (/Course\s*Code|Course\s*Name|رمز المقرر|اسم المقرر/i.test(rowText)) return null;

    // Use column-based parsing if columns detected
    if (cols) {
      return _parseWithColumns(left, right, code, codeItem, cols, mid);
    }
    return _parseByPattern(left, right, code, codeItem);
  }

  function _parseWithColumns(left, right, code, codeItem, cols, mid) {
    // Build column boundaries using MIDPOINTS between consecutive columns
    // This correctly handles items whose x-position differs from the header x-position
    // e.g., "Course Name" header at x=142 but actual names start at x=109
    var keys = Object.keys(cols).sort(function(a, b) { return cols[a] - cols[b]; });
    var bounds = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var prevK = keys[i - 1];
      var nextK = keys[i + 1];
      bounds[k] = {
        lo: prevK ? Math.floor((cols[prevK] + cols[k]) / 2) : 0,
        hi: nextK ? Math.floor((cols[k] + cols[nextK]) / 2) : mid + 50
      };
    }

    // Map items to their column based on x-position
    var mapped = {};
    for (var j = 0; j < left.length; j++) {
      var item = left[j];
      if (item === codeItem) continue;
      for (var ki = 0; ki < keys.length; ki++) {
        var key = keys[ki];
        if (item.x >= bounds[key].lo && item.x < bounds[key].hi) {
          if (!mapped[key]) mapped[key] = [];
          mapped[key].push(item.s);
          break;
        }
      }
    }

    var nameEn = (mapped.name || []).join(' ').trim();
    // If name column is empty but extra items landed in code column, they're likely the name
    if (!nameEn && mapped.code && mapped.code.length > 0) {
      nameEn = mapped.code.filter(function(s) {
        return !COURSE_CODE_RE.test(s.replace(/\s/g, ''));
      }).join(' ').trim();
    }
    var crdH = parseInt((mapped.crd || [])[0]) || 0;
    var passH = parseInt((mapped.pass || [])[0]) || 0;
    var deg = parseInt((mapped.deg || [])[0]) || 0;
    var gradeStr = ((mapped.grade || [])[0] || '').trim();
    var pts = parseFloat((mapped.pts || [])[0]) || 0;

    var grade = _normalizeGrade(gradeStr);
    var nameAr = _extractArabicName(right);

    return {
      code: code,
      nameEn: _cleanCourseName(nameEn),
      nameAr: _cleanCourseName(nameAr),
      creditHours: crdH,
      passHours: passH,
      degree: deg,
      grade: grade,
      points: pts,
      gradePoints: grade ? (GRADE_MAP[grade] != null ? GRADE_MAP[grade] : null) : null,
    };
  }

  function _parseByPattern(left, right, code, codeItem) {
    // BACKWARD SCAN approach: scan from the end to separate data (numbers/grade) from name
    // This correctly handles course names containing numbers (e.g., "Discrete Structures 1")
    var afterCode = left.filter(function(i) { return i.x > codeItem.x; })
                        .sort(function(a, b) { return a.x - b.x; });
    var items = afterCode.map(function(i) { return i.s.trim(); }).filter(Boolean);

    var grade = null;
    var numbers = [];
    var dataStart = items.length;

    // Scan from the RIGHT end: grade and numbers come last in the row
    for (var i = items.length - 1; i >= 0; i--) {
      var s = items[i];
      if (/^(A\+?|B\+?|C\+?|D\+?|F|W|DN|IP|IC|NP)$/i.test(s)) {
        grade = s.toUpperCase();
        dataStart = i;
      } else if (/^\d+\.?\d*$/.test(s)) {
        numbers.unshift(parseFloat(s));
        dataStart = i;
      } else {
        break; // Hit a non-data item, everything before this is the name
      }
    }

    var nameTokens = items.slice(0, dataStart);
    var nameAr = _extractArabicName(right);
    grade = _normalizeGrade(grade);

    return {
      code: code,
      nameEn: _cleanCourseName(nameTokens.join(' ')),
      nameAr: _cleanCourseName(nameAr),
      creditHours: numbers[0] || 0,
      passHours: numbers[1] || 0,
      degree: numbers[2] || 0,
      grade: grade,
      points: numbers.length > 3 ? numbers[numbers.length - 1] : (numbers[3] || 0),
      gradePoints: grade ? (GRADE_MAP[grade] != null ? GRADE_MAP[grade] : null) : null,
    };
  }

  function _extractArabicName(rightItems) {
    var parts = [];
    for (var i = 0; i < rightItems.length; i++) {
      var s = rightItems[i].s;
      // Must contain Arabic characters (standard + presentation forms)
      if (!/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s)) continue;
      // Skip course codes
      if (COURSE_CODE_RE.test(s.replace(/\s/g, ''))) continue;
      // Skip pure numbers (Arabic or Western)
      if (/^[\u0660-\u0669\u06F0-\u06F9\d٫.,\s]+$/.test(s)) continue;
      // Skip Arabic grades (both "أ+" and "+أ" orders due to RTL/PDF encoding)
      if (/^[\+]?(أ|ب|ج|د|هـ|ح|م|ر)[\+]?$/.test(s)) continue;
      // Skip known labels
      if (AR_SKIP_LABELS.test(s)) continue;
      // Skip very short strings that are just numbers
      if (s.length <= 1) continue;
      parts.push(s);
    }
    return parts.join(' ').trim();
  }

  function _normalizeGrade(g) {
    if (!g) return null;
    var up = g.toUpperCase().replace(/\s/g, '');
    if (GRADE_MAP.hasOwnProperty(up)) return up;
    // Try without plus sign variations
    if (up === 'A' || up === 'B' || up === 'C' || up === 'D' || up === 'F') return up;
    return null;
  }

  // Clean up course names by removing footer/junk text that may leak into the last course on a page
  function _cleanCourseName(name) {
    if (!name) return name;
    var cutPatterns = [
      /\s*(?:Crd|Passed)\s*Hrs?\s*:/i,
      /\s*Dean\s+of/i,
      /\s*Dr\.\s+[A-Z]/i,
      /\s*Accum\s*GPA/i,
      /\s*عميد/,
      /\s*م[\.٫]التراكمي/,
      /\s*م[\.٫]الفصلي/,
      /\s*الساعات\s*المعتمدة/,
      /\s*الساعات\s*المكتسبة/,
      /\s*د\.\s/,
      /\s*القبول\s*والتسجيل/,
    ];
    for (var i = 0; i < cutPatterns.length; i++) {
      var idx = name.search(cutPatterns[i]);
      if (idx > 0) name = name.substring(0, idx);
    }
    return name.trim();
  }

  /* ═══════════════════════════════════════════════════════════
     5. SEMESTER DETECTION & PARSING
     ═══════════════════════════════════════════════════════════ */

  function parseSemesters(pages) {
    var semesters = [];

    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      var rows = buildRows(page.items);
      var mid = page.pw / 2;
      var cols = detectColumns(rows, page.pw);
      var curSem = null;
      var lastCourse = null;

      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var leftItems = row.filter(function(i) { return i.x < mid; });
        var rightItems = row.filter(function(i) { return i.x >= mid; });
        var leftText = leftItems.map(function(i) { return i.s; }).join(' ');
        var fullText = row.map(function(i) { return i.s; }).join(' ');

        // ── Detect semester header ──
        var semMatch = leftText.match(/(First|Second|Third)\s+Semester\s+(\d{4}\/\d{4})/i);
        if (semMatch) {
          if (curSem) semesters.push(curSem);
          // Sort right items RIGHT-to-LEFT (Arabic reading order) for correct regex matching
          var arSorted = rightItems.slice().sort(function(a, b) { return b.x - a.x; });
          var arText = arSorted.map(function(i) { return i.s; }).join(' ');
          var arMatch = arText.match(/الفصل\s+(الأول|الثاني|الثالث)\s+([\d٠-٩]{4}(?:[\/-][\d٠-٩]{4})?)/);

          // Build Arabic semester label from English term + Arabic year
          var termMap = { 'First': 'الأول', 'Second': 'الثاني', 'Third': 'الثالث' };
          var arLabel = arMatch
            ? 'الفصل ' + arMatch[1] + ' ' + arNum(arMatch[2])
            : 'الفصل ' + (termMap[semMatch[1]] || semMatch[1]) + ' ' + semMatch[2].replace(/\//g, '/');

          curSem = {
            nameEn: semMatch[0],
            nameAr: arLabel,
            term: semMatch[1],
            year: semMatch[2],
            sgpa: null,
            cgpa: null,
            totalHours: 0,
            totalPassedHours: 0,
            courses: [],
            status: 'completed',
          };
          lastCourse = null;
          continue;
        }

        if (!curSem) continue;

        // ── Skip non-data rows ──
        if (/Course\s*Code|Course\s*Name|Crd\.|Hours\b.*Hourse|رمز المقرر|اسم المقرر/i.test(fullText)) continue;
        if (/^(Faculty|Dept|Status|Major)\s*:/i.test(leftText.trim())) continue;
        // Skip footer/summary rows (Dean signature, total hours labels, etc.)
        if (/Dean\s+of|عميد|Crd\s*Hrs\s*:|Passed\s*Hrs\s*:|Accum\s*GPA|الساعات\s*المعتمدة|الساعات\s*المكتسبة|Registration|التسجيل|Dr\.\s+[A-Z]/i.test(fullText)) continue;

        // ── GPA rows ──
        var sgpa = leftText.match(/S\.GPA\s*:?\s*(\d+\.\d+)/);
        var cgpa = leftText.match(/Ac\.\s*GPA\s*:?\s*(\d+\.\d+)/);
        if (sgpa) { curSem.sgpa = parseFloat(sgpa[1]); }
        if (cgpa) { curSem.cgpa = parseFloat(cgpa[1]); }
        if (sgpa || cgpa) continue;

        // Also try Arabic GPA
        var arSgpa = fullText.match(/م\.الفصلي\s*:?\s*([\d٠-٩]+[٫.][\d٠-٩]+)/);
        var arCgpa = fullText.match(/م\.التراكمي\s*:?\s*([\d٠-٩]+[٫.][\d٠-٩]+)/);
        if (arSgpa && !curSem.sgpa) curSem.sgpa = parseFloat(arNum(arSgpa[1]));
        if (arCgpa && !curSem.cgpa) curSem.cgpa = parseFloat(arNum(arCgpa[1]));
        if (arSgpa || arCgpa) continue;

        // ── Sum/total row ──
        if (/\bsum\b/i.test(leftText) || /المجموع/i.test(fullText)) {
          var sumMatch = leftText.match(/(\d+)\s+(\d+)\s+sum/i);
          if (sumMatch) {
            curSem.totalHours = parseInt(sumMatch[1]) || 0;
            curSem.totalPassedHours = parseInt(sumMatch[2]) || 0;
          }
          continue;
        }

        // ── Status/classification rows (Excellent, Very Good...) ──
        if (/^[\s\-]*(?:Excellent|Very Good|Good|Poor|ممتاز|جيد)/.test(leftText.trim()) && !/\d{3}/.test(leftText)) continue;

        // ── Course row ──
        var course = parseCourseRow(row, mid, cols);
        if (course) {
          curSem.courses.push(course);
          lastCourse = course;
        } else if (lastCourse) {
          // Check for name continuation (multi-line course names)
          var contItems = leftItems.filter(function(i) {
            return !/^\d/.test(i.s) &&
              !COURSE_CODE_RE.test(i.s.replace(/\s/g, '')) &&
              !/^(A\+?|B\+?|C\+?|D\+?|F|W)$/i.test(i.s) &&
              !/sum|gpa|faculty|dept|status|major|excellent|good|dean|registr|crd\s*hrs|passed\s*hrs|accum|dr\./i.test(i.s) &&
              i.s.length > 1;
          });
          if (contItems.length > 0 && contItems.length <= 3) {
            var cont = contItems.map(function(i) { return i.s; }).join(' ');
            if (cont.length > 1 && cont.length < 60) {
              lastCourse.nameEn = (lastCourse.nameEn + ' ' + cont).trim();
            }
          }
          // Arabic continuation
          var arCont = rightItems.filter(function(i) {
            return /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(i.s) &&
              !COURSE_CODE_RE.test(i.s.replace(/\s/g, '')) &&
              !AR_SKIP_LABELS.test(i.s) &&
              !/^[\+]?(أ|ب|ج|د|هـ|ح|م|ر)[\+]?$/.test(i.s) &&
              !/^[\u0660-\u0669\d٫.,\s]+$/.test(i.s) &&
              i.s.length > 1;
          });
          if (arCont.length > 0 && arCont.length <= 3) {
            var arContText = arCont.map(function(i) { return i.s; }).join(' ');
            if (arContText.length > 1) {
              lastCourse.nameAr = ((lastCourse.nameAr || '') + ' ' + arContText).trim();
            }
          }
        }
      }

      // Final cleanup: remove any footer/junk text that leaked into course names
      if (curSem) {
        for (var ci = 0; ci < curSem.courses.length; ci++) {
          curSem.courses[ci].nameEn = _cleanCourseName(curSem.courses[ci].nameEn);
          curSem.courses[ci].nameAr = _cleanCourseName(curSem.courses[ci].nameAr);
        }
        semesters.push(curSem);
      }
    }

    // Deduplicate semesters (same semester may span pages)
    return _dedup(semesters);
  }

  function _dedup(semesters) {
    var map = {};
    var order = [];
    for (var i = 0; i < semesters.length; i++) {
      var sem = semesters[i];
      var key = sem.nameEn;
      if (!key) continue;
      if (map[key]) {
        var existing = map[key];
        var existCodes = {};
        for (var j = 0; j < existing.courses.length; j++) {
          existCodes[existing.courses[j].code] = true;
        }
        for (var k = 0; k < sem.courses.length; k++) {
          if (!existCodes[sem.courses[k].code]) {
            existing.courses.push(sem.courses[k]);
          }
        }
        if (!existing.sgpa && sem.sgpa) existing.sgpa = sem.sgpa;
        if (!existing.cgpa && sem.cgpa) existing.cgpa = sem.cgpa;
        if (!existing.totalHours && sem.totalHours) existing.totalHours = sem.totalHours;
      } else {
        var copy = {};
        for (var prop in sem) { copy[prop] = sem[prop]; }
        copy.courses = sem.courses.slice();
        map[key] = copy;
        order.push(key);
      }
    }
    return order.map(function(k) { return map[k]; });
  }

  /* ═══════════════════════════════════════════════════════════
     6. STUDENT INFO EXTRACTION
     ═══════════════════════════════════════════════════════════ */

  function extractStudentInfo(pages) {
    var info = {};

    // Build rows from first page for header parsing
    var rows = buildRows(pages[0].items);
    var mid = pages[0].pw / 2;

    // Scan each row for header information
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var leftText = row.filter(function(i) { return i.x < mid; }).sort(function(a,b) { return a.x - b.x; }).map(function(i) { return i.s; }).join(' ');
      var rightText = row.filter(function(i) { return i.x >= mid; }).sort(function(a,b) { return b.x - a.x; }).map(function(i) { return i.s; }).join(' ');
      var fullText = row.map(function(i) { return i.s; }).join(' ');
      var m;

      // Student ID
      if (!info.studentId) {
        m = fullText.match(/(?:Student\s*ID|الرقم الجامعي)\s*[:\s]*(\d{9,10})/);
        if (m) info.studentId = m[1];
      }

      // English name — row containing "Name:" on left side
      if (!info.nameEn) {
        m = leftText.match(/Name\s*:\s*$/);
        if (m) {
          // Name is in the same row but after "Name:"
          var nameItems = row.filter(function(i) { return i.x < mid && /^[A-Z][A-Z\s,.']+$/.test(i.s); });
          if (nameItems.length > 0) info.nameEn = nameItems.map(function(i) { return i.s; }).join(' ').trim();
        }
        // Try inline match
        m = leftText.match(/Name\s*:?\s*([A-Z][A-Z\s,.']{3,})/);
        if (m && !info.nameEn) info.nameEn = m[1].trim();
      }

      // Arabic name — any row item matching Arabic name pattern near الاسم
      if (!info.name) {
        // Look for Arabic text that looks like a name (multiple Arabic words, not a label)
        if (/الاسم|الإسم/.test(fullText)) {
          var arNameItems = row.filter(function(i) {
            return /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]{2,}/.test(i.s) &&
              !/الاسم|الإسم|الحالة|منتظم|الرقم|الجامعي|التاريخ|الصفحة/.test(i.s) &&
              i.s.length > 3;
          });
          if (arNameItems.length > 0) {
            info.name = arNameItems.map(function(i) { return i.s; }).join(' ').trim();
          }
        }
      }

      // GPA from header
      if (!info.gpa) {
        m = fullText.match(/GPA\s*:?\s*(\d+\.\d+)/);
        if (m) info.gpa = parseFloat(m[1]);
      }

      // Major — row containing "Major :"
      if (!info.majorEn) {
        m = leftText.match(/Major\s*:?\s*([A-Za-z][A-Za-z\s]{2,})/i);
        if (m) {
          var majorCandidate = m[1].trim();
          // Filter out non-major words
          if (!/^(Bachelor|Master|First|Second|Third|Active|Full|Part)$/i.test(majorCandidate)) {
            info.majorEn = majorCandidate;
          }
        }
      }

      // Arabic major
      if (!info.major) {
        if (/التخصص/.test(fullText)) {
          var arMajorItems = row.filter(function(i) {
            return /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]{2,}/.test(i.s) &&
              !/التخصص|القسم|الكلية|الحالة|الفصل|بكالوريوس|إنتظام|منتظم|الدرجة|نوع/.test(i.s) &&
              i.s.length > 3;
          });
          if (arMajorItems.length > 0) {
            info.major = arMajorItems.map(function(i) { return i.s; }).join(' ').trim();
          }
        }
      }

      // Faculty
      if (!info.faculty) {
        m = leftText.match(/Faculty\s*:?\s*([A-Za-z][A-Za-z\s]+?)(?:\s{2,}|$)/i);
        if (m) {
          var fac = m[1].trim();
          if (!/^(Major|Dept|Status)$/i.test(fac) && fac.length > 3) info.faculty = fac;
        }
      }

      // Degree type
      if (!info.degree) {
        m = fullText.match(/Degree\s*:?\s*(Bachelor|Master|Ph\.?D\.?)/i);
        if (m) info.degree = m[1];
      }

      // Study type
      if (!info.studyType) {
        m = fullText.match(/Study\s*type\s*:?\s*(Full\s*Time|Part\s*Time)/i);
        if (m) info.studyType = /full/i.test(m[1]) ? 'full' : 'part';
      }
    }

    // University detection from all page 1 text
    var allText = pages[0].items.map(function(i) { return i.s; }).join(' ');
    if (/Umm Al.?Qura|أم القرى|ﺃﻡ ﺍﻟﻘﺮﻯ/i.test(allText)) info.university = 'جامعة أم القرى';
    else if (/King Abdulaziz|الملك عبدالعزيز/i.test(allText)) info.university = 'جامعة الملك عبدالعزيز';
    else if (/King Saud\b|الملك سعود/i.test(allText)) info.university = 'جامعة الملك سعود';
    else if (/King Fahd|الملك فهد/i.test(allText)) info.university = 'جامعة الملك فهد للبترول والمعادن';
    else if (/Imam|الإمام/i.test(allText)) info.university = 'جامعة الإمام محمد بن سعود الإسلامية';

    // Smart university detection from course codes & faculty patterns
    // (university name is often in a logo/image, not in text)
    if (!info.university) {
      var allPagesText = pages.map(function(p) { return p.items.map(function(i) { return i.s; }).join(' '); }).join(' ');
      // UQU detection: QR (Quran), ELCE (elective), ICC course codes + Computing faculty
      if (/\bQR\d{4}/.test(allPagesText) && /\bELCE\d{4}/.test(allPagesText)) {
        info.university = 'جامعة أم القرى';
      }
      // KAU detection
      else if (/\bKAU\b/i.test(allPagesText) || /King Abdulaziz/i.test(allPagesText)) {
        info.university = 'جامعة الملك عبدالعزيز';
      }
      // KSU detection
      else if (/\bKSU\b/i.test(allPagesText) || /King Saud\b/i.test(allPagesText)) {
        info.university = 'جامعة الملك سعود';
      }
      // KFUPM detection
      else if (/\bKFUPM\b/i.test(allPagesText) || /King Fahd/i.test(allPagesText)) {
        info.university = 'جامعة الملك فهد للبترول والمعادن';
      }
    }

    // Summary from last page
    var lastText = pages[pages.length - 1].items.map(function(i) { return i.s; }).join(' ');
    var m;
    m = lastText.match(/Crd\s*Hrs?\s*:\s*(\d+)/i);
    if (m) info.planHours = parseInt(m[1]);
    m = lastText.match(/Passed\s*Hrs?\s*:\s*(\d+)/i);
    if (m) info.earnedHours = parseInt(m[1]);
    m = lastText.match(/Accum\s*GPA\s*:\s*(\d+\.\d+)/i);
    if (m) info.gpa = parseFloat(m[1]);
    m = lastText.match(/Points\s*:\s*(\d+\.?\d*)/i);
    if (m) info.totalPoints = parseFloat(m[1]);

    // Arabic summary fallback
    m = lastText.match(/الساعات المعتمدة\s*:\s*([\d٠-٩]+)/);
    if (m && !info.planHours) info.planHours = parseInt(arNum(m[1]));
    m = lastText.match(/الساعات المكتسبة\s*:\s*([\d٠-٩]+)/);
    if (m && !info.earnedHours) info.earnedHours = parseInt(arNum(m[1]));

    return info;
  }

  /* ═══════════════════════════════════════════════════════════
     7. CLASSIFICATION — Completed vs Registered vs Current
     ═══════════════════════════════════════════════════════════ */

  function classifySemesters(semesters) {
    for (var i = 0; i < semesters.length; i++) {
      var sem = semesters[i];
      var hasGrades = sem.courses.some(function(c) { return c.grade != null; });
      var allZero = sem.courses.every(function(c) { return c.creditHours === 0; });
      var anyZeroDeg = sem.courses.every(function(c) { return c.degree === 0; });

      if ((!hasGrades && allZero) || (!hasGrades && anyZeroDeg && sem.courses.length > 0)) {
        sem.status = 'registered';
      } else if (hasGrades) {
        sem.status = 'completed';
      } else {
        sem.status = 'current';
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     8. MAIN PARSER FUNCTION
     ═══════════════════════════════════════════════════════════ */

  async function parseTranscriptPDF(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('الملف يجب أن يكون بصيغة PDF');
    }

    var pages = await extractPages(file);
    var info = extractStudentInfo(pages);
    var semesters = parseSemesters(pages);

    // Classify semesters
    classifySemesters(semesters);

    // Build course lists
    var completedCourses = [];
    var registeredCourses = [];

    for (var i = 0; i < semesters.length; i++) {
      var sem = semesters[i];
      for (var j = 0; j < sem.courses.length; j++) {
        var c = sem.courses[j];
        var enriched = {
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          name: c.nameAr || c.nameEn, // Prefer Arabic name for display
          creditHours: c.creditHours,
          passHours: c.passHours,
          degree: c.degree,
          grade: c.grade,
          points: c.points,
          gradePoints: c.gradePoints,
          semester: sem.nameAr || sem.nameEn,
          semesterEn: sem.nameEn,
          semesterStatus: sem.status,
          difficulty: c.creditHours >= 4 ? 'hard' : c.creditHours <= 2 ? 'easy' : 'medium',
          type: 'theory',
        };

        if (sem.status === 'registered') {
          registeredCourses.push(enriched);
        } else {
          completedCourses.push(enriched);
        }
      }
    }

    // Build result
    var result = {
      name: info.name || null,
      nameEn: info.nameEn || null,
      studentId: info.studentId || null,
      university: info.university || null,
      major: info.major || null,
      majorEn: info.majorEn || null,
      faculty: info.faculty || null,
      degree: info.degree || null,
      studyType: info.studyType || null,
      gpa: info.gpa || null,
      earnedHours: info.earnedHours || null,
      planHours: info.planHours || null,
      totalPoints: info.totalPoints || null,
      semesters: semesters,
      completedCourses: completedCourses,
      registeredCourses: registeredCourses,
      currentSemesterCourses: registeredCourses,
      allCourses: completedCourses.concat(registeredCourses),
      pageCount: pages.length,
      confidence: 0,
    };

    // Confidence
    var conf = 0;
    if (result.name || result.nameEn) conf += 15;
    if (result.studentId) conf += 10;
    if (result.gpa) conf += 20;
    if (result.earnedHours) conf += 10;
    if (result.planHours) conf += 5;
    if (result.major || result.majorEn) conf += 10;
    if (semesters.length > 0) conf += 15;
    if (completedCourses.length > 0) conf += 15;
    result.confidence = Math.min(conf, 100);

    return result;
  }

  /* ═══════════════════════════════════════════════════════════
     9. RENDER PREVIEW — Beautiful Semester-Separated UI
     ═══════════════════════════════════════════════════════════ */

  function renderPreview(data) {
    // Student info header
    var infoFields = [
      { icon: '👤', label: 'الاسم', value: data.name || data.nameEn },
      { icon: '🏛️', label: 'الجامعة', value: data.university },
      { icon: '📚', label: 'التخصص', value: data.major || data.majorEn },
      { icon: '🎓', label: 'الدرجة', value: data.degree },
      { icon: '📅', label: 'نوع الدراسة', value: data.studyType === 'full' ? 'انتظام' : (data.studyType === 'part' ? 'انتساب' : data.studyType) },
      { icon: '🆔', label: 'الرقم الجامعي', value: data.studentId },
      { icon: '📊', label: 'المعدل التراكمي', value: data.gpa ? data.gpa.toFixed(2) + ' / ' + (window.APP_GPA_SCALE || '5.00') : null },
      { icon: '⏱️', label: 'الساعات المكتسبة', value: data.earnedHours ? data.earnedHours + ' ساعة' : null },
      { icon: '📋', label: 'ساعات الخطة', value: data.planHours ? data.planHours + ' ساعة' : null },
    ];

    var infoHtml = infoFields.filter(function(f) { return f.value; }).map(function(f) {
      return '<div class="tp2-info-item"><span class="tp2-info-icon">' + f.icon + '</span><span class="tp2-info-label">' + f.label + ':</span><span class="tp2-info-value">' + f.value + '</span></div>';
    }).join('');

    // Semester summary stats
    var completedSems = data.semesters.filter(function(s) { return s.status === 'completed'; });
    var registeredSems = data.semesters.filter(function(s) { return s.status === 'registered'; });

    // Build completed semesters HTML (collapsible)
    var completedHtml = '';
    if (completedSems.length > 0) {
      var semCards = completedSems.map(function(sem, idx) {
        var coursesHtml = sem.courses.map(function(c) {
          var gradeColor = c.grade ? (GRADE_COLORS[c.grade] || 'var(--muted)') : 'var(--muted)';
          var displayName = c.nameAr || c.nameEn || '—';
          return '<div class="tp2-course-row">' +
            '<span class="tp2-course-code">' + c.code + '</span>' +
            '<span class="tp2-course-name">' + displayName + '</span>' +
            '<span class="tp2-course-hrs">' + (c.creditHours || '—') + 'س</span>' +
            '<span class="tp2-course-grade" style="color:' + gradeColor + '">' + (c.grade || '—') + '</span>' +
            '</div>';
        }).join('');

        var semLabel = sem.nameAr || sem.nameEn;
        var sgpaStr = sem.sgpa ? sem.sgpa.toFixed(2) : '—';
        var cgpaStr = sem.cgpa ? sem.cgpa.toFixed(2) : '—';
        var totalH = sem.totalHours || sem.courses.reduce(function(s, c) { return s + (c.creditHours || 0); }, 0);

        return '<details class="tp2-sem-card" data-sem-idx="' + idx + '" style="margin-bottom:12px; background:var(--bg); border:1px solid var(--border); border-radius:12px; overflow:hidden;" ' + (idx===0 ? 'open' : '') + '>' +
          '<summary class="tp2-sem-header" style="padding:16px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center; background:var(--surface-2); font-weight:bold; border-bottom:1px solid rgba(0,0,0,0.1); outline:none;">' +
          '<div class="tp2-sem-info" style="display:flex; flex-direction:column; gap:4px;">' +
          '<span class="tp2-sem-name" style="color:var(--accent); font-size: 1.05rem;">' + semLabel + '</span>' +
          '<div class="tp2-sem-meta" style="font-size:0.85rem; color:var(--muted); display:flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;">' +
          '<span class="tp2-sem-gpa" style="background: rgba(16, 185, 129, 0.1); color: var(--success); padding: 2px 8px; border-radius: 4px;">فصلي: ' + sgpaStr + '</span>' +
          '<span class="tp2-sem-gpa" style="background: rgba(99, 102, 241, 0.1); color: var(--accent); padding: 2px 8px; border-radius: 4px;">تراكمي: ' + cgpaStr + '</span>' +
          '<span class="tp2-sem-sep" style="margin:0 2px;">•</span>' +
          '<span>' + sem.courses.length + ' مواد</span>' +
          '<span class="tp2-sem-sep" style="margin:0 2px;">•</span>' +
          '<span>' + totalH + ' ساعة</span>' +
          '</div></div>' +
          '<span class="tp2-sem-toggle" style="opacity:0.6; font-size:1.1rem; color:var(--accent);">▼</span>' +
          '</summary>' +
          '<div class="tp2-sem-courses" style="padding:16px;">' + coursesHtml + '</div>' +
          '</details>';
      }).join('');

      completedHtml = '<div class="tp2-section">' +
        '<div class="tp2-section-title" style="margin-bottom:12px; font-weight:bold; color:var(--fg);">✅ الفصول المكتملة <span class="tp2-section-badge" style="font-size:0.8rem; font-weight:normal; color:var(--muted); margin-right:8px;">' + completedSems.length + ' فصول — ' + data.completedCourses.length + ' مادة</span></div>' +
        '<div class="tp2-sem-list" style="max-height: 350px; overflow-y: auto; padding-right:8px; border:1px solid var(--border); padding:12px; border-radius:12px; background:var(--surface);">' + semCards + '</div></div>';
    }

    // Build registered/current semester HTML
    var registeredHtml = '';
    if (registeredSems.length > 0) {
      var regCourses = '';
      for (var ri = 0; ri < registeredSems.length; ri++) {
        var rsem = registeredSems[ri];
        regCourses += rsem.courses.map(function(c) {
          var displayName = c.nameAr || c.nameEn || '—';
          return '<div class="tp2-course-row tp2-course-registered">' +
            '<span class="tp2-course-code">' + c.code + '</span>' +
            '<span class="tp2-course-name">' + displayName + '</span>' +
            '<span class="tp2-course-hrs">' + (c.creditHours || '?') + 'س</span>' +
            '<span class="tp2-course-status">📝 مسجل</span>' +
            '</div>';
        }).join('');
      }

      var regLabel = registeredSems[0].nameAr || registeredSems[0].nameEn || 'الفصل الحالي';
      registeredHtml = '<div class="tp2-section tp2-section-current">' +
        '<div class="tp2-section-title">📝 مواد الفصل الحالي / المسجل <span class="tp2-section-badge tp2-badge-current">' + regLabel + ' — ' + data.registeredCourses.length + ' مواد</span></div>' +
        '<div class="tp2-reg-list">' + regCourses + '</div>' +
        '</div>';
    }

    // Confidence
    var confColor = data.confidence >= 70 ? 'var(--success)' : data.confidence >= 40 ? '#f59e0b' : 'var(--danger)';
    var confLabel = data.confidence >= 70 ? 'دقة عالية' : data.confidence >= 40 ? 'دقة متوسطة' : 'دقة منخفضة';

    // Full preview
    return '<div class="tp2-preview">' +
      '<div class="tp2-header">' +
      '<div class="tp2-header-title">✅ تم تحليل السجل الأكاديمي بنجاح</div>' +
      '<div class="tp2-confidence" style="color:' + confColor + '"><span class="tp2-conf-dot" style="background:' + confColor + '"></span>' + confLabel + ' (' + data.confidence + '%)</div>' +
      '</div>' +
      '<div class="tp2-info-grid">' + infoHtml + '</div>' +
      '<div class="tp2-stats">' +
      '<div class="tp2-stat"><div class="tp2-stat-num">' + data.semesters.length + '</div><div class="tp2-stat-lbl">فصل دراسي</div></div>' +
      '<div class="tp2-stat"><div class="tp2-stat-num">' + (data.completedCourses.length + data.registeredCourses.length) + '</div><div class="tp2-stat-lbl">مادة إجمالية</div></div>' +
      '<div class="tp2-stat"><div class="tp2-stat-num" style="color:var(--accent)">' + (data.gpa ? data.gpa.toFixed(2) : '—') + '</div><div class="tp2-stat-lbl">المعدل التراكمي</div></div>' +
      '</div>' +
      completedHtml +
      registeredHtml +
      '<div class="tp2-actions">' +
      '<button class="btn-primary tp2-apply-btn" onclick="window._applyTranscriptData()">✅ تطبيق البيانات على البروفايل</button>' +
      '<button class="btn-ghost" onclick="document.getElementById(\'transcriptPreview\').style.display=\'none\'">تخطي</button>' +
      '</div></div>';
  }

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════ */

  window.UQUTranscript = {
    parseTranscriptPDF: parseTranscriptPDF,
    renderPreview: renderPreview,
    GRADE_MAP: GRADE_MAP,
    GRADE_LABELS: GRADE_LABELS,
    GRADE_COLORS: GRADE_COLORS,
  };

  console.log('%cUQU Transcript Parser v2.0 ✓ (Semester-Aware)', 'background:#0f172a;color:#10b981;padding:2px 7px;border-radius:4px;font-weight:bold;');
})(window);
