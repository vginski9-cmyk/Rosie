// Spreadsheet → session rows. People already have a schedule in Excel (or a
// copy of the capacity workbook); drop it in and the columns are recognized by
// their headers — the workbook's own headers, common synonyms, or close enough
// — every row becomes a session with the term / course / session fields filled
// in, and anything the sheet didn't say is left for the person to finish.

import type { EditableField } from "./sessionfields";

export type ImportField = "termNumber" | "semester" | "courseCode" | "courseTitle" | "number" | EditableField;

export interface ImportedSession {
  termNumber: number | null; semester: string | null;
  courseCode: string | null; courseTitle: string | null;
  kind: "CLASS" | "LAB" | "CLINICAL"; number: number | null; title: string | null;
  deliveryMode: string | null; location: string | null;
  lengthHours: number | null; maxStudents: number | null;
  facultyNeeded: number | null; facultyContactPolicy: number | null;
  supportStaffNeeded: number | null; supportContactPolicy: number | null;
  week: number | null; dayOfWeek: string | null; startTime: string | null; notes: string | null;
  preceptorsNeeded: number | null; preceptorContactPolicy: number | null;
  rotationType: string | null; clinicalMode: string | null;
  /** 1-based row in the sheet it came from. */
  sourceRow: number;
}

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  termNumber: "Term Number", semester: "Semester", courseCode: "Course Code", courseTitle: "Course Title",
  kind: "Session Type", number: "Session Number", title: "Session title (if used)", deliveryMode: "Session Delivery Mode",
  location: "Session Location", lengthHours: "Session length (in hours)", maxStudents: "Max number of students that ONE session can accommodate",
  facultyNeeded: "Number of faculty required to teach full session", facultyContactPolicy: "Contact hour policy for faculty during session",
  supportStaffNeeded: "Number of support staff required to teach full session", supportContactPolicy: "Contact hour policy for support staff during session",
  week: "This session occurs during Week __ of term", dayOfWeek: "This session occurs on ____", startTime: "Start time", notes: "Notes",
  preceptorsNeeded: "Number of preceptors required to teach full clinical session", preceptorContactPolicy: "Contact hour policy for preceptors during session",
  rotationType: "Clinical Rotation Type", clinicalMode: "Clinical Mode",
};
export const IMPORT_FIELDS = Object.keys(IMPORT_FIELD_LABEL) as ImportField[];

// Header synonyms. Longest match wins, so "contact hour policy for faculty" beats "faculty".
const SYNONYMS: Record<ImportField, string[]> = {
  termNumber: ["term number", "term no", "term #", "term", "term index"],
  semester: ["semester", "term name", "season", "semester name"],
  courseCode: ["course code", "course number", "course no", "course #", "course id", "course", "code"],
  courseTitle: ["course title", "course name", "title of course", "course description"],
  kind: ["session type", "session kind", "type of session", "instruction type", "activity type", "component", "type", "kind", "activity"],
  number: ["session number", "session no", "session #", "meeting number", "sequence", "seq", "session"],
  title: ["session title if used", "session title", "session name", "topic", "title", "session title (if used)"],
  deliveryMode: ["session delivery mode", "delivery mode", "delivery", "modality", "mode of delivery", "format"],
  location: ["session location", "location", "room", "space", "where", "site"],
  lengthHours: ["session length in hours", "session length (in hours)", "session length", "length in hours", "length hours", "length", "duration", "hours per session", "hrs per session", "session hours"],
  maxStudents: ["max number of students that one session can accommodate", "max number of students", "max students", "maximum students", "students per session", "capacity", "seats", "max"],
  facultyNeeded: ["number of faculty required to teach full session", "number of faculty", "faculty required", "faculty needed", "faculty", "instructors", "instructors required", "# faculty"],
  facultyContactPolicy: ["contact hour policy for faculty during session", "contact hour policy for faculty", "faculty contact hour policy", "faculty contact policy", "faculty policy"],
  supportStaffNeeded: ["number of support staff required to teach full session", "number of support staff", "support staff required", "support staff", "support needed", "staff required"],
  supportContactPolicy: ["contact hour policy for support staff during session", "contact hour policy for support staff", "support staff contact hour policy", "support contact policy", "support policy"],
  week: ["this session occurs during week of term", "this session occurs during week", "week of term", "week", "wk", "term week"],
  dayOfWeek: ["this session occurs on", "day of week", "day of the week", "weekday", "day", "days"],
  startTime: ["start time", "time", "start", "begins at", "starts at"],
  notes: ["notes", "comments", "remarks", "note"],
  preceptorsNeeded: ["number of preceptors required to teach full clinical session", "number of preceptors", "preceptors required", "preceptors needed", "preceptors", "preceptor"],
  preceptorContactPolicy: ["contact hour policy for preceptors during session", "contact hour policy for preceptors", "preceptor contact hour policy", "preceptor contact policy", "preceptor policy"],
  rotationType: ["clinical rotation type", "rotation type", "rotation", "clinical setting", "setting", "unit type", "unit"],
  clinicalMode: ["clinical mode", "mode of clinical", "clinical supervision", "supervision mode", "supervision"],
};

export const normalizeHeader = (h: unknown): string =>
  String(h ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/_+/g, " ").replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim();

const hasPhrase = (hay: string, needle: string) => (` ${hay} `).includes(` ${needle} `);

/** Recognize one header. Exact header wins; else the longest synonym contained as a whole phrase. */
export function mapHeader(header: unknown): ImportField | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  let best: { f: ImportField; score: number } | null = null;
  for (const f of IMPORT_FIELDS) {
    for (const syn of SYNONYMS[f]) {
      const s = normalizeHeader(syn);
      const score = h === s ? 1000 + s.length : hasPhrase(h, s) ? s.length : 0;
      if (score > 0 && (!best || score > best.score)) best = { f, score };
    }
  }
  return best?.f ?? null;
}

export interface HeaderDetection { headerRow: number; map: Record<number, ImportField>; unmapped: { index: number; header: string }[] }

/** Find the header row (the row that names the most known columns) and map its columns. */
export function detectHeader(rows: unknown[][]): HeaderDetection | null {
  let best: HeaderDetection | null = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] ?? [];
    // Skip a row that is only column letters (A, B, C …).
    if (row.length && row.every((c) => c == null || String(c).trim() === "" || /^[A-Z]{1,2}$/.test(String(c).trim()))) continue;
    const map: Record<number, ImportField> = {};
    const seen = new Set<ImportField>();
    const unmapped: { index: number; header: string }[] = [];
    row.forEach((cell, i) => {
      const text = String(cell ?? "").trim();
      if (!text) return;
      const f = mapHeader(text);
      if (f && !seen.has(f)) { map[i] = f; seen.add(f); } else unmapped.push({ index: i, header: text });
    });
    if (seen.size >= 3 && (!best || seen.size > Object.keys(best.map).length)) best = { headerRow: r, map, unmapped };
  }
  return best;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,$%]/g, "").trim();
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  return m ? Number(m[0]) : null;
};
const text = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s ? s : null; };

export function parseKind(v: unknown): "CLASS" | "LAB" | "CLINICAL" | null {
  const s = String(v ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/clinic|rotation|practicum|extern|preceptor|fieldwork/.test(s)) return "CLINICAL";
  if (/\blab|skills|sim/.test(s)) return "LAB";
  if (/class|lecture|didactic|theory|seminar|online/.test(s)) return "CLASS";
  return null;
}

const DAY_MAP: Record<string, string> = {
  mon: "Mon", monday: "Mon", m: "Mon", tue: "Tue", tues: "Tue", tuesday: "Tue", t: "Tue", wed: "Wed", wednesday: "Wed", w: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", r: "Thu", th: "Thu", fri: "Fri", friday: "Fri", f: "Fri",
  sat: "Sat", saturday: "Sat", s: "Sat", sun: "Sun", sunday: "Sun", u: "Sun",
};
export function parseDay(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return null;
  return DAY_MAP[s] ?? DAY_MAP[s.slice(0, 3)] ?? null;
}

/** "8:00 AM", "0800", "13:30", 0.333 (Excel fraction) → "HH:MM". */
export function parseTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v >= 0 && v < 1) { const mins = Math.round(v * 24 * 60); return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; }
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) { m = /^(\d{2})(\d{2})$/.exec(s); if (m) return `${m[1]}:${m[2]}`; return null; }
  let h = Number(m[1]); const mm = Number(m[2] ?? 0); const ap = m[3];
  if (ap?.startsWith("p") && h < 12) h += 12;
  if (ap?.startsWith("a") && h === 12) h = 0;
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export interface ImportResult { sessions: ImportedSession[]; skipped: number; issues: string[] }

/** Turn the sheet's rows (after the header) into sessions. Blank term / course
 *  cells inherit from the row above (merged cells in Excel); missing session
 *  numbers count up within each course × type. */
export function rowsToSessions(rows: unknown[][], det: HeaderDetection): ImportResult {
  const out: ImportedSession[] = [];
  const issues: string[] = [];
  let skipped = 0;
  let carry: { termNumber: number | null; semester: string | null; courseCode: string | null; courseTitle: string | null } = { termNumber: null, semester: null, courseCode: null, courseTitle: null };
  const counters = new Map<string, number>();
  const idx = (f: ImportField): number | null => { for (const [i, ff] of Object.entries(det.map)) if (ff === f) return Number(i); return null; };
  const get = (row: unknown[], f: ImportField): unknown => { const i = idx(f); return i == null ? null : row[i]; };

  for (let r = det.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => c == null || String(c).trim() === "")) continue;
    const termRaw = get(row, "termNumber");
    const termNumber = num(termRaw) ?? (text(termRaw) ? num(String(termRaw).replace(/[^0-9]/g, "")) : null) ?? carry.termNumber;
    const semester = text(get(row, "semester")) ?? carry.semester;
    const courseCode = text(get(row, "courseCode")) ?? carry.courseCode;
    const courseTitle = text(get(row, "courseTitle")) ?? carry.courseTitle;
    carry = { termNumber, semester, courseCode, courseTitle };
    const kind = parseKind(get(row, "kind")) ?? parseKind(get(row, "title")) ?? parseKind(get(row, "location"));
    if (!kind) { skipped++; issues.push(`Row ${r + 1}: no session type (class / lab / clinical) — skipped`); continue; }
    if (!courseCode && !courseTitle) { skipped++; issues.push(`Row ${r + 1}: no course code or title — skipped`); continue; }
    const key = `${courseCode ?? courseTitle}|${kind}`;
    let number = num(get(row, "number"));
    if (number == null) { number = (counters.get(key) ?? 0) + 1; }
    counters.set(key, Math.max(counters.get(key) ?? 0, number));
    const dayRaw = get(row, "dayOfWeek");
    const dayOfWeek = parseDay(dayRaw);
    if (dayRaw != null && String(dayRaw).trim() && !dayOfWeek) issues.push(`Row ${r + 1}: day "${String(dayRaw)}" not recognized — left blank`);
    out.push({
      termNumber, semester, courseCode, courseTitle, kind, number, title: text(get(row, "title")),
      deliveryMode: text(get(row, "deliveryMode")), location: text(get(row, "location")),
      lengthHours: num(get(row, "lengthHours")), maxStudents: num(get(row, "maxStudents")),
      facultyNeeded: num(get(row, "facultyNeeded")), facultyContactPolicy: num(get(row, "facultyContactPolicy")),
      supportStaffNeeded: num(get(row, "supportStaffNeeded")), supportContactPolicy: num(get(row, "supportContactPolicy")),
      week: num(get(row, "week")), dayOfWeek, startTime: parseTime(get(row, "startTime")), notes: text(get(row, "notes")),
      preceptorsNeeded: num(get(row, "preceptorsNeeded")), preceptorContactPolicy: num(get(row, "preceptorContactPolicy")),
      rotationType: text(get(row, "rotationType")), clinicalMode: text(get(row, "clinicalMode")),
      sourceRow: r + 1,
    });
  }
  return { sessions: out, skipped, issues };
}

/** Tab / comma separated text (a paste from Excel) → rows. */
export function textToRows(text: string): unknown[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  return lines.map((l) => l.split(sep).map((c) => c.trim()));
}
