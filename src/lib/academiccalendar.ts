// Academic-calendar import: turn whatever someone pastes — the college's
// calendar web page, text copied out of a PDF, cells copied from Excel — into
// coded calendar events (semester starts / ends, later-session starts,
// holidays & breaks) and the semester pattern the term-date engine follows.
//
// Pure functions, no I/O: the client previews the parse live, the server
// stores what the user confirms.

import type { SemesterAnchors } from "./term";

export type EventKind = "term_start" | "term_end" | "session_start" | "holiday" | "other";
export type Season = "Spring" | "Summer" | "Fall";

export interface CalendarEvent {
  /** YYYY-MM-DD (first day). */
  iso: string;
  /** YYYY-MM-DD (last day) for multi-day breaks; null for one-day events. */
  endIso: string | null;
  label: string;
  kind: EventKind;
  season: Season;
  /** The source line the event was read from (shown for trust). */
  source: string;
}

export const KIND_LABEL: Record<EventKind, string> = {
  term_start: "Semester starts",
  term_end: "Semester ends",
  session_start: "Later session starts",
  holiday: "Holiday / break — no classes",
  other: "Ignore (deadline, registration, etc.)",
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthNum = (s: string): number => {
  const k = s.toLowerCase().replace(/\./g, "").slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(k)) + 1;
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const validDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Season by calendar month when no header says otherwise. */
export const seasonOfMonth = (m: number): Season => (m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall");
export const seasonOfIso = (iso: string): Season => seasonOfMonth(Number(iso.slice(5, 7)));

interface Ctx { season: Season | null; year: number | null; bandStart: number | null }

/** A found date (or range) inside one line, with the text left over. */
interface Found { iso: string; endIso: string | null; rest: string }

/** Year for a month-only date: the section's year, else the academic-year band, else today's year. */
function inferYear(m: number, ctx: Ctx, fallback: number): number {
  if (ctx.year != null) return ctx.year;
  if (ctx.bandStart != null) return m >= 8 ? ctx.bandStart : ctx.bandStart + 1;
  return fallback;
}

/** Find the first date / date-range in a line. Handles "August 17, 2026",
 *  "Aug. 17", "Nov 25-29", "Dec 21, 2026 – Jan 8, 2027", "8/17/2026", "8/17",
 *  "17 August 2026", "2026-08-17", with weekday prefixes. */
function findDate(line: string, ctx: Ctx, fallbackYear: number): Found | null {
  const s = line.replace(/[–—]/g, "-").replace(/\bthrough\b|\bthru\b|\bto\b/gi, "-");
  const wd = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday|sday)?\b\.?,?\s*/gi;

  // ISO
  let m = /(\d{4})-(\d{2})-(\d{2})(?:\s*-\s*(\d{4})-(\d{2})-(\d{2}))?/.exec(s);
  if (m) {
    const iso = isoOf(+m[1], +m[2], +m[3]);
    const endIso = m[4] ? isoOf(+m[4], +m[5], +m[6]) : null;
    return { iso, endIso, rest: s.replace(m[0], " ") };
  }
  // Month name first: "Aug 17, 2026" / "Aug 17-21" / "Aug 17 - Sep 1, 2026"
  const mn = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?(?:\\s*-\\s*(?:${MONTH_RE}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?)?`, "i");
  m = mn.exec(s);
  if (m) {
    const mo = monthNum(m[1]); const d = +m[2];
    const endMo = m[4] ? monthNum(m[4]) : mo; const endD = m[5] ? +m[5] : null;
    const y1 = m[3] ? +m[3] : m[6] && endMo >= mo ? +m[6] : m[6] ? +m[6] - 1 : inferYear(mo, ctx, fallbackYear);
    const y2 = m[6] ? +m[6] : endMo < mo ? y1 + 1 : y1;
    if (validDay(y1, mo, d)) {
      const endIso = endD != null && validDay(y2, endMo, endD) ? isoOf(y2, endMo, endD) : null;
      return { iso: isoOf(y1, mo, d), endIso, rest: s.replace(m[0], " ").replace(wd, " ") };
    }
  }
  // Day first: "17 August 2026" / "17-21 August 2026"
  const df = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?)?\\s+${MONTH_RE}\\.?(?:,?\\s*(\\d{4}))?`, "i");
  m = df.exec(s);
  if (m) {
    const mo = monthNum(m[3]); const d = +m[1];
    const y = m[4] ? +m[4] : inferYear(mo, ctx, fallbackYear);
    if (validDay(y, mo, d)) {
      const endIso = m[2] && validDay(y, mo, +m[2]) ? isoOf(y, mo, +m[2]) : null;
      return { iso: isoOf(y, mo, d), endIso, rest: s.replace(m[0], " ").replace(wd, " ") };
    }
  }
  // Numeric: 8/17/2026, 8/17/26, 8/17, 8/17-8/21
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*-\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?/.exec(s);
  if (m) {
    const mo = +m[1]; const d = +m[2];
    const yr = (v: string | undefined, def: number) => (v ? (v.length === 2 ? 2000 + +v : +v) : def);
    const y1 = yr(m[3], inferYear(mo, ctx, fallbackYear));
    if (validDay(y1, mo, d)) {
      let endIso: string | null = null;
      if (m[4]) { const em = +m[4]; const ed = +m[5]; const y2 = yr(m[6], em < mo ? y1 + 1 : y1); if (validDay(y2, em, ed)) endIso = isoOf(y2, em, ed); }
      return { iso: isoOf(y1, mo, d), endIso, rest: s.replace(m[0], " ").replace(wd, " ") };
    }
  }
  return null;
}

const HOLIDAY_WORDS = /\b(holiday|no classes?|classes? not in session|college closed|campus closed|closed|break|recess|thanksgiving|labor day|memorial day|martin luther king|mlk|independence day|juneteenth|veterans|christmas|new year|good friday|easter|reading day|snow day)\b/i;
const START_WORDS = /\b(classes? (?:begin|start)s?|first day of (?:the )?(?:class|classes|term|semester|instruction)|instruction begins|(?:semester|term) (?:begins|starts)|start of (?:classes|the semester|the term)|begins?|starts?)\b/i;
const END_WORDS = /\b(last day of (?:the )?(?:class|classes|term|semester|instruction)|classes? ends?|(?:semester|term) ends?|end of (?:the )?(?:semester|term|classes)|final exams? end|exams end|ends?)\b/i;
const SESSION_WORDS = /\b(session|mini-?mester|late[- ]start|second|2nd|8[- ]week|12[- ]week|4[- ]week|5[- ]week|6[- ]week|10[- ]week|a term|b term|term a|term b|part of term|pot|summer i|summer ii|maymester)\b/i;
const OTHER_WORDS = /\b(registration|register|drop|withdraw|tuition|payment|deadline|grades? due|priority|application|advising|orientation|fafsa|census|refund|commencement|graduation|convocation|professional development|faculty|staff|workday|work day|in-?service|planning day|interim|apply|due)\b/i;

/** Code a label into an event kind. Holidays win (a "Fall Break — no classes" is a
 *  break), then plain deadlines are ignored, then semester start / end. */
export function classify(label: string): EventKind {
  const l = label.toLowerCase();
  if (HOLIDAY_WORDS.test(l) && !/\bends?\b|\bbegins?\b/.test(l.replace(/(break|holiday)s?\s+(begins?|ends?)/, "$1"))) return "holiday";
  if (HOLIDAY_WORDS.test(l)) return "holiday";
  if (OTHER_WORDS.test(l)) return "other";
  if (START_WORDS.test(l)) return SESSION_WORDS.test(l) ? "session_start" : "term_start";
  if (END_WORDS.test(l)) return SESSION_WORDS.test(l) ? "other" : "term_end";
  return "other";
}

const SEASON_RE = /\b(fall|autumn|spring|summer)\b/i;
const seasonWord = (w: string): Season => (/^(fall|autumn)$/i.test(w) ? "Fall" : /^spring$/i.test(w) ? "Spring" : "Summer");

/** Parse pasted calendar text into coded events (chronological). */
export function parseAcademicCalendar(text: string, opts: { today?: Date } = {}): { events: CalendarEvent[]; warnings: string[] } {
  const today = opts.today ?? new Date();
  const fallbackYear = today.getUTCFullYear();
  const ctx: Ctx = { season: null, year: null, bandStart: null };
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  let pendingLabel: string | null = null;

  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\t+/g, "  ").replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const raw of lines) {
    // Section headers: "Fall 2026", "Spring Semester 2027", "2026-2027 Academic Calendar", "Academic Year 2026-27".
    const band = /\b(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})\b/.exec(raw);
    const sh = new RegExp(`^\\s*(fall|autumn|spring|summer)\\b(?:\\s+(?:semester|term|session))?\\s*(20\\d{2})?\\s*$`, "i").exec(raw);
    if (sh) { ctx.season = seasonWord(sh[1]); if (sh[2]) ctx.year = +sh[2]; pendingLabel = null; continue; }
    const found = findDate(raw, ctx, fallbackYear);
    if (!found) {
      if (band && !/\d{1,2}\/\d{1,2}/.test(raw)) { ctx.bandStart = +band[1]; ctx.year = null; ctx.season = null; pendingLabel = null; continue; }
      const sw = SEASON_RE.exec(raw);
      const isEventLabel = START_WORDS.test(raw) || END_WORDS.test(raw) || HOLIDAY_WORDS.test(raw) || OTHER_WORDS.test(raw);
      if (sw && raw.length < 40 && !isEventLabel) { ctx.season = seasonWord(sw[1]); const yr = /\b(20\d{2})\b/.exec(raw); if (yr) ctx.year = +yr[1]; pendingLabel = null; continue; }
      pendingLabel = raw; // a label whose date is on the next line (PDF / column paste)
      continue;
    }
    // Clean separators but keep in-word hyphens ("12-Week", "Late-start").
    let label = found.rest.replace(/\s*[|•·:–—]+\s*/g, " ").replace(/(^|\s)[-,]+(?=\s|$)/g, " ").replace(/\s+/g, " ").replace(/^[\s\-,:]+|[\s\-,:]+$/g, "");
    if (label.length < 3 && pendingLabel) label = pendingLabel;
    if (label.length < 3) { warnings.push(`No event name found for ${found.iso}: "${raw}"`); continue; }
    const kind = classify(label);
    const sw = SEASON_RE.exec(label);
    const season: Season = sw && (kind === "term_start" || kind === "term_end" || kind === "session_start") ? seasonWord(sw[1]) : ctx.season ?? seasonOfIso(found.iso);
    events.push({ iso: found.iso, endIso: found.endIso && found.endIso > found.iso ? found.endIso : null, label, kind, season, source: raw });
    pendingLabel = null;
  }

  // Within one season-year, only the EARLIEST "starts" is the semester start; the
  // rest are later sessions (12-week, 2nd 8-week …).
  const firstStart = new Map<string, CalendarEvent>();
  for (const e of events) if (e.kind === "term_start") { const k = `${e.season}|${e.iso.slice(0, 4)}`; if (!firstStart.has(k) || e.iso < firstStart.get(k)!.iso) firstStart.set(k, e); }
  for (const e of events) if (e.kind === "term_start" && firstStart.get(`${e.season}|${e.iso.slice(0, 4)}`) !== e) e.kind = "session_start";
  // A semester listed only as sessions ("Summer I classes begin") starts with its earliest session.
  for (const e of events) {
    if (e.kind !== "session_start") continue;
    const k = `${e.season}|${e.iso.slice(0, 4)}`;
    if (!firstStart.has(k)) { e.kind = "term_start"; firstStart.set(k, e); }
  }
  const lastEnd = new Map<string, CalendarEvent>();
  for (const e of events) if (e.kind === "term_end") { const k = `${e.season}|${e.iso.slice(0, 4)}`; if (!lastEnd.has(k) || e.iso > lastEnd.get(k)!.iso) lastEnd.set(k, e); }
  for (const e of events) if (e.kind === "term_end" && lastEnd.get(`${e.season}|${e.iso.slice(0, 4)}`) !== e) e.kind = "other";

  events.sort((a, b) => a.iso.localeCompare(b.iso));
  if (!events.length && text.trim()) warnings.push("No dated lines found — paste the calendar text with its dates (e.g. “Fall classes begin — August 17, 2026”).");
  return { events, warnings };
}

/** The MM-DD anchor that reproduces every known semester start via "Monday on/after".
 *  Colleges plan by "the 3rd Monday of August", so the nth-Monday rule behind the
 *  known dates is tried first (it carries to other years); then any anchor within
 *  the week before the earliest known date. */
function anchorFor(isos: string[], fallback: string): string {
  if (!isos.length) return fallback;
  const mondayOnOrAfter = (y: number, mmdd: string) => {
    const [mm, dd] = mmdd.split("-").map(Number);
    const d = new Date(Date.UTC(y, mm - 1, dd));
    return new Date(d.getTime() + ((8 - d.getUTCDay()) % 7) * 86400000).toISOString().slice(0, 10);
  };
  const fits = (cand: string) => isos.every((i) => mondayOnOrAfter(Number(i.slice(0, 4)), cand) === i);
  // nth Monday of the month → "Monday on/after day 7(n−1)+1"
  for (const i of isos) {
    const day = Number(i.slice(8, 10)); const n = Math.ceil(day / 7);
    const cand = `${i.slice(5, 7)}-${pad(7 * (n - 1) + 1)}`;
    if (fits(cand)) return cand;
  }
  const earliest = isos.map((i) => i.slice(5)).sort()[0];
  for (let back = 0; back <= 6; back++) {
    const d = new Date(Date.UTC(2001, Number(earliest.slice(0, 2)) - 1, Number(earliest.slice(3)) - back));
    const cand = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    if (fits(cand)) return cand;
  }
  return earliest;
}

/** The semester pattern implied by the coded semester starts (per season), else the current one. */
export function anchorsFromEvents(events: CalendarEvent[], current: SemesterAnchors): SemesterAnchors {
  const starts = (s: Season) => events.filter((e) => e.kind === "term_start" && e.season === s).map((e) => e.iso);
  return {
    springStart: anchorFor(starts("Spring"), current.springStart),
    summerStart: anchorFor(starts("Summer"), current.summerStart),
    fallStart: anchorFor(starts("Fall"), current.fallStart),
  };
}

/** Holiday / break days as an ISO → label map (ranges expanded, capped at 60 days). */
export function holidayMap(events: { iso: string; endIso: string | null; label: string; kind: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) {
    if (e.kind !== "holiday") continue;
    const start = new Date(e.iso + "T00:00:00Z");
    const end = e.endIso ? new Date(e.endIso + "T00:00:00Z") : start;
    for (let d = start, n = 0; d <= end && n < 60; d = new Date(d.getTime() + 86400000), n++) out[d.toISOString().slice(0, 10)] = e.label;
  }
  return out;
}

/** Known semester-start dates (ISO) — the engine uses these exact dates for the years they cover. */
export const knownStartsOf = (events: { iso: string; kind: string }[]): string[] => events.filter((e) => e.kind === "term_start").map((e) => e.iso).sort();
