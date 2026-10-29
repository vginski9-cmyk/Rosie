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
  experiences: string | null; progression: string | null;
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
  experiences: "Clinical experiences", progression: "Progression stage",
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
  experiences: ["clinical experiences", "experiences", "experience", "populations procedures or modalities", "procedures", "populations", "modalities", "competencies", "skills"],
  progression: ["progression stage", "progression", "stage", "level", "learner level", "role", "scrub role"],
};

/** Headers of the Program Planning Template that describe the program, not a session column — never a field. */
const NOT_A_FIELD = /^(institution name|program name|program type|version)$/;

export const normalizeHeader = (h: unknown): string =>
  String(h ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/_+/g, " ").replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim();

/** A campus room named as a clinical row's location (a classroom, lab or simulation space), as against a site. */
const CAMPUS_ROOM = /^(classroom|lab|labs?\b.*|skills lab|simulation.*|sim lab|computer lab|lecture hall)$/i;

const hasPhrase = (hay: string, needle: string) => (` ${hay} `).includes(` ${needle} `);

/** Recognize one header. Exact header wins; else the longest synonym contained as a whole phrase. */
export function mapHeader(header: unknown): ImportField | null {
  const h = normalizeHeader(header);
  if (!h || NOT_A_FIELD.test(h)) return null;
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

/** Whether a header is one of the synonyms verbatim (after normalizing), not merely containing one. */
function isExactHeader(header: unknown): boolean {
  const h = normalizeHeader(header);
  return IMPORT_FIELDS.some((f) => SYNONYMS[f].some((syn) => normalizeHeader(syn) === h));
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
    // Two passes: a column whose header IS a field's synonym ("Session Type") claims the field before a column that only
    // contains one ("Program Type" ⊃ "type"), whatever their order on the sheet.
    const claims = row.map((cell, i) => { const text = String(cell ?? "").trim(); return text ? { i, text, f: mapHeader(text), exact: isExactHeader(text) } : null; });
    for (const pass of [true, false]) for (const c of claims) {
      if (!c || c.exact !== pass) continue;
      if (c.f && !seen.has(c.f)) { map[c.i] = c.f; seen.add(c.f); } else if (!pass || !c.f) unmapped.push({ index: c.i, header: c.text });
    }
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
/** A staffing ratio written into a count cell ("*1:10 ratio"): staff : learners. */
const ratioOf = (v: unknown): { staff: number; learners: number } | null => { const m = /(\d+)\s*:\s*(\d+)\s*ratio/i.exec(String(v ?? "")); return m ? { staff: Number(m[1]), learners: Number(m[2]) } : null; };
/** A count cell that lists several figures ("*10 CCP; 16 & 22 seats non-CCP") is not one number: null, with the text kept for the notes. */
const severalFigures = (v: unknown): boolean => typeof v === "string" && (String(v).match(/\d+(?:\.\d+)?/g) ?? []).length > 1 && !ratioOf(v);
/** Seats or staff from a count cell: a plain number; a ratio's learners (seats) or staff (faculty); several figures → null. */
const countOf = (v: unknown, side: "learners" | "staff"): number | null => { const r = ratioOf(v); if (r) return side === "learners" ? r.learners : r.staff; return severalFigures(v) ? null : num(v); };
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

/** The time of day a session starts, as the sheet's notes give it ("5:30p-9:30p", "Class, 8:30a-12p", "8am - 2:30pm") when no
 *  time column exists; a range whose start has no am/pm reads noon as noon, 1–6 as afternoon, 7–11 as morning. */
export function timeFromNotes(notes: unknown): string | null {
  const text = String(notes ?? "");
  if (!text) return null;
  const hhmm = (h: number, m?: string) => `${String(h).padStart(2, "0")}:${m ?? "00"}`;
  const range = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m?\b/i.exec(text);
  const m = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\b/i.exec(text);
  if (range && (!m || range.index <= m.index)) { const h = Number(range[1]); return hhmm(h === 12 ? 12 : h <= 6 ? h + 12 : h, range[2]); }
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === "p") h += 12;
  return hhmm(h, m[2]);
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
    let kind = parseKind(get(row, "kind")) ?? parseKind(get(row, "title")) ?? parseKind(get(row, "location"));
    if (!kind) { skipped++; issues.push(`Row ${r + 1}: no session type (class / lab / clinical) — skipped`); continue; }
    // A clinical-typed row held in a campus room (a program's final exam or post-clinical skills lab inside its
    // clinical-hours bucket) is a lab or class on campus, never a seat at a site; its rotation and mode are cleared.
    const locationText = text(get(row, "location"));
    const onCampus = kind === "CLINICAL" && !!locationText && CAMPUS_ROOM.test(locationText);
    if (onCampus) { kind = /class/i.test(locationText!) ? "CLASS" : "LAB"; issues.push(`Row ${r + 1}: clinical row at "${locationText}" read as ${kind.toLowerCase()} on campus (not a clinical site)`); }
    // An asynchronous online row has no weekday of its own: a day the sheet gives it is a placeholder.
    const asyncOnline = /asynchronous|self-paced/i.test(text(get(row, "deliveryMode")) ?? "");
    if (!courseCode && !courseTitle) { skipped++; issues.push(`Row ${r + 1}: no course code or title — skipped`); continue; }
    const key = `${courseCode ?? courseTitle}|${kind}`;
    let number = num(get(row, "number"));
    if (number == null) { number = (counters.get(key) ?? 0) + 1; }
    counters.set(key, Math.max(counters.get(key) ?? 0, number));
    for (const f of ["maxStudents", "facultyNeeded"] as const) if (severalFigures(get(row, f))) issues.push(`Row ${r + 1}: ${IMPORT_FIELD_LABEL[f]} "${String(get(row, f)).trim()}" lists several figures — left blank, the text kept in the notes`);
    const dayRaw = get(row, "dayOfWeek");
    const dayOfWeek = asyncOnline ? null : parseDay(dayRaw);
    if (!asyncOnline && dayRaw != null && String(dayRaw).trim() && !dayOfWeek) issues.push(`Row ${r + 1}: day "${String(dayRaw)}" not recognized — left blank`);
    if (asyncOnline && dayRaw != null && String(dayRaw).trim()) issues.push(`Row ${r + 1}: asynchronous online — the day "${String(dayRaw)}" is a placeholder, left blank`);
    out.push({
      termNumber, semester, courseCode, courseTitle, kind, number, title: text(get(row, "title")),
      deliveryMode: text(get(row, "deliveryMode")), location: text(get(row, "location")),
      lengthHours: num(get(row, "lengthHours")), maxStudents: countOf(get(row, "maxStudents"), "learners"),
      facultyNeeded: countOf(get(row, "facultyNeeded"), "staff"), facultyContactPolicy: num(get(row, "facultyContactPolicy")),
      supportStaffNeeded: num(get(row, "supportStaffNeeded")), supportContactPolicy: num(get(row, "supportContactPolicy")),
      week: num(get(row, "week")), dayOfWeek, startTime: asyncOnline ? null : parseTime(get(row, "startTime")) ?? timeFromNotes(get(row, "notes")), notes: [onCampus ? "In the program's clinical-hours bucket, held on campus." : null, text(get(row, "notes")), ...(["maxStudents", "facultyNeeded"] as const).filter((f) => severalFigures(get(row, f))).map((f) => `${IMPORT_FIELD_LABEL[f]}: "${String(get(row, f)).trim()}" — several figures, left blank`)].filter(Boolean).join(" · ") || null,
      preceptorsNeeded: num(get(row, "preceptorsNeeded")), preceptorContactPolicy: num(get(row, "preceptorContactPolicy")),
      rotationType: onCampus ? null : text(get(row, "rotationType")), clinicalMode: onCampus ? null : text(get(row, "clinicalMode")),
      experiences: text(get(row, "experiences")), progression: text(get(row, "progression")),
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
