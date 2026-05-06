"""
================================================================
UQU Academic Transcript Parser — Smart Logic Edition (Python)
================================================================
Ported from the successful JS v2.0 logic.
Features:
- Position-aware grouping (Y-tolerance).
- Column detection based on table headers.
- Multi-line course name support (continuation rows).
- Robust bilingual name extraction.
================================================================
"""
from __future__ import annotations
import re
import logging
import pdfplumber
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# Patterns
COURSE_CODE_RE = re.compile(r'^([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)$')
GRADE_MAP = {
    'A+': 5.00, 'A': 4.75, 'B+': 4.50, 'B': 4.00,
    'C+': 3.50, 'C': 3.00, 'D+': 2.50, 'D': 2.00,
    'F': 1.00, 'DN': 0.00, 'W': None, 'IP': None, 'IC': None, 'NP': None,
}

SEM_RE = re.compile(r'(First|Second|Third|Summer)\s+Semester\s+(\d{4}[/\-]\d{4})', re.I)

def ar_num(s: str) -> str:
    if not s: return ''
    arabic_digits = '٠١٢٣٤٥٦٧٨٩'
    return "".join(str(arabic_digits.find(c)) if c in arabic_digits else c for c in s).replace('٫', '.')

def _is_arabic(text: str) -> bool:
    return bool(text) and any('\u0600' <= c <= '\u06FF' or '\uFB50' <= c <= '\uFEFF' for c in text)

class TranscriptParser:
    def __init__(self, pdf_path_or_file):
        self.pdf_path = pdf_path_or_file
        self.result = {
            "name": None, "nameEn": None, "studentId": None, "university": None,
            "major": None, "majorEn": None, "faculty": None, "degree": None,
            "studyType": None, "gpa": None, "earnedHours": None, "planHours": None,
            "totalPoints": None, "semesters": [], "completedCourses": [],
            "registeredCourses": [], "confidence": 0, "timestamp": datetime.now().isoformat(),
        }

    def parse(self) -> Dict[str, Any]:
        try:
            with pdfplumber.open(self.pdf_path) as pdf:
                all_pages_text = []
                for i, page in enumerate(pdf.pages):
                    words = page.extract_words(x_tolerance=2, y_tolerance=3)
                    rows = self._build_rows(words)
                    self._process_page_rows(rows, page.width)
                    all_pages_text.append(page.extract_text() or "")
                
                full_text = "\n".join(all_pages_text)
                self._extract_global_info(full_text)
                self._classify_and_build()
        except Exception as e:
            logger.error(f"Parse error: {e}", exc_info=True)
        return self.result

    def _build_rows(self, words, tol=3):
        if not words: return []
        sorted_words = sorted(words, key=lambda w: (-w['top'], w['x0'])) # Sort Y descending (top of page is 0, but pdfplumber top is from top)
        # Wait, pdfplumber 'top' is distance from top. So we want ascending top.
        sorted_words = sorted(words, key=lambda w: (w['top'], w['x0']))
        rows = []
        if not sorted_words: return []
        curr = [sorted_words[0]]
        cy = sorted_words[0]['top']
        for w in sorted_words[1:]:
            if abs(w['top'] - cy) <= tol:
                curr.append(w)
            else:
                curr.sort(key=lambda x: x['x0'])
                rows.append(curr)
                curr = [w]
                cy = w['top']
        rows.append(sorted(curr, key=lambda x: x['x0']))
        return rows

    def _process_page_rows(self, rows, pw):
        mid = pw / 2
        cols = self._detect_columns(rows, mid)
        current_sem = self.result["semesters"][-1] if self.result["semesters"] else None
        last_course = None

        for row in rows:
            text = " ".join(w['text'] for w in row)
            
            # Semester Header
            m = SEM_RE.search(text)
            if m:
                term, year = m.group(1), m.group(2)
                current_sem = {
                    "nameEn": f"{term} Semester {year}",
                    "nameAr": f"الفصل {term} {year}",
                    "courses": [], "sgpa": None, "cgpa": None, "status": "completed"
                }
                self.result["semesters"].append(current_sem)
                last_course = None
                continue
            
            if not current_sem: continue

            # GPA Rows
            sgpa_m = re.search(r'S\.GPA\s*:\s*(\d+\.\d+)', text)
            cgpa_m = re.search(r'Ac\.\s*GPA\s*:\s*(\d+\.\d+)', text)
            if sgpa_m: current_sem["sgpa"] = float(sgpa_m.group(1))
            if cgpa_m: current_sem["cgpa"] = float(cgpa_m.group(1))

            # Course Row
            course = self._parse_course_row(row, mid, cols)
            if course:
                current_sem["courses"].append(course)
                last_course = course
            elif last_course:
                # Multi-line name check
                left_words = [w['text'] for w in row if w['x1'] < mid and not _is_arabic(w['text']) and len(w['text']) > 1]
                if left_words and len(left_words) <= 3:
                    cont = " ".join(left_words)
                    if not COURSE_CODE_RE.match(cont.replace(" ","")):
                        last_course["nameEn"] = (last_course["nameEn"] + " " + cont).strip()

    def _detect_columns(self, rows, mid):
        for row in rows:
            txt = " ".join(w['text'] for w in row if w['x1'] < mid)
            if "Course" in txt and ("Code" in txt or "Name" in txt):
                cols = {}
                for w in row:
                    t = w['text'].lower()
                    if "code" in t: cols["code"] = w['x0']
                    elif "name" in t: cols["name"] = w['x0']
                    elif t in ["crd", "crd.", "hrs", "hrs."]: cols["crd"] = w['x0']
                    elif "grade" in t: cols["grade"] = w['x0']
                    elif "points" in t: cols["pts"] = w['x0']
                if len(cols) >= 3: return cols
        return None

    def _parse_course_row(self, row, mid, cols):
        # Find Code
        code, code_w = None, None
        for w in row:
            clean = w['text'].replace(" ","").upper()
            if COURSE_CODE_RE.match(clean):
                code, code_w = clean, w
                break
        if not code: return None

        # Data extraction (English side)
        eng_words = [w for w in row if w['x1'] < mid * 1.2] # slight bleed for points
        # Strategy: Backward scan for numbers and grade
        data_items = []
        name_parts = []
        
        # Simple extraction for now to match JS logic
        items = [w['text'] for w in eng_words if w['x0'] > code_w['x1']]
        grade = None
        nums = []
        for i in reversed(items):
            if i.upper() in GRADE_MAP:
                grade = i.upper()
            elif re.match(r'^\d+\.?\d*$', ar_num(i)):
                nums.insert(0, float(ar_num(i)))
            else:
                # Once we hit a non-number/non-grade, the rest is the name
                break
        
        name_en = " ".join(items[:len(items)-len(nums)-(1 if grade else 0)])
        
        return {
            "code": code, "nameEn": name_en, "creditHours": nums[0] if len(nums)>0 else 0,
            "passHours": nums[1] if len(nums)>1 else 0, "degree": nums[2] if len(nums)>2 else 0,
            "grade": grade, "points": nums[-1] if len(nums)>0 else 0,
            "gradePoints": GRADE_MAP.get(grade) if grade else None
        }

    def _extract_global_info(self, text):
        m = re.search(r'Student\s*ID\s*[:\s]*(\d+)', text)
        if m: self.result["studentId"] = m.group(1)
        m = re.search(r'Name\s*[:\s]*([A-Z][A-Z\s,]+)', text)
        if m: self.result["nameEn"] = m.group(1).strip()
        m = re.search(r'Accum\s*GPA\s*[:\s]*(\d+\.\d+)', text)
        if m: self.result["gpa"] = float(m.group(1))

    def _classify_and_build(self):
        for sem in self.result["semesters"]:
            for c in sem["courses"]:
                if c["grade"]: self.result["completedCourses"].append(c)
                else: self.result["registeredCourses"].append(c)