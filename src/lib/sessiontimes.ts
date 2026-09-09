// Session times from the sheet — read, never invented.
//
// The workbook states when a session meets in its Notes column, in the
// program's own shorthand: "Th, 3 hrs/class, 8:30 to 11a", "M, 11am-12pm;
// 12:30pm to 1:30pm", "Section 1: 8-10:50a (13 students); Section 2: 1:40 to
// 4:30p (12 students)", "Section 1, T, 8:30a - 10:50a or Section 2, T, 2:00p -
// 4:20p". These parsers turn that into a session start time and, when the
// sheet gives each section its own slot, a per-section day/time list. The
// calendarizer places sections on exactly those slots; anything the sheet
// does not state is left null (and only then does the scheduler pick a time).

export interface SectionSlot { dayOfWeek: string | null; startTime: string; endTime?: string | null }

const DAY_TOKEN: Record<string, string> = { m: "Mon", mon: "Mon", monday: "Mon", t: "Tue", tu: "Tue", tue: "Tue", tues: "Tue", tuesday: "Tue", w: "Wed", wed: "Wed", wednesday: "Wed", th: "Thu", thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", f: "Fri", fri: "Fri", friday: "Fri", sa: "Sat", sat: "Sat", saturday: "Sat", su: "Sun", sun: "Sun", sunday: "Sun" };
const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p|m)?";
const RANGE = new RegExp(`${TIME}\\s*(?:-|–|—|to)\\s*${TIME}(?![\\d:])`, "i");
const RANGE_G = new RegExp(RANGE.source, "gi");
const DAY_RE = /(?:^|[\s,(;&])(Mon|Monday|Tue|Tues|Tuesday|Wed|Wednesday|Thu|Thur|Thurs|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday|M|T|W|Th|F)(?=[\s,.:;)&]|$)/i;

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** One stated range ("8:30 to 11a", "12:30 to 1:30pm", "8-10:50a", "11am-12pm", "1 - 1:50p") as 24h start and end. */
function parseRange(m: RegExpExecArray): { start: string; end: string | null } | null {
  const sh = Number(m[1]), sm = Number(m[2] ?? 0), sAp = (m[3] ?? "").toLowerCase();
  const eh = Number(m[4]), em = Number(m[5] ?? 0), eAp = (m[6] ?? "").toLowerCase().replace(/^m$/, ""); // "12:20m" is a typo'd noon
  if (sh < 1 || sh > 12 || sm > 59) return null;
  let pm: boolean;
  if (sAp && sAp !== "m") pm = sAp.startsWith("p");
  else if (eAp.startsWith("a")) pm = false;
  else if (eAp.startsWith("p")) pm = sh === 12 ? true : eh === 12 ? false : sh <= eh ? true : false; // "10 to 1pm" is 10am; "1:40 to 4:30p" is pm; "1 - 1:50p" is pm; "12:30 to 1:30pm" is pm
  else pm = sh < eh || eh === 12 ? !(sh >= 5 && sh <= 11) : false; // no meridiem anywhere: "6:30-12:30" is morning; "10-1" crosses noon so 10 is am; "1-3" is afternoon
  let h = sh % 12; if (pm) h += 12;
  const start = hhmm(h, sm);
  if (eh < 1 || eh > 12 || em > 59) return { start, end: null };
  // The end is on or after the start: "8-10:50a" ends 10:50; "11am-12pm" ends 12:00; "12:30 to 1:30pm" ends 13:30; "6:30-12:30" ends 12:30.
  let ehh = eh % 12;
  if (eAp.startsWith("p")) ehh += 12;
  else if (eAp.startsWith("a")) { /* am */ }
  else if (eh === 12) ehh = 12;
  else if (ehh + (em > 0 ? 0.01 : 0) < h + sm / 60 || (pm && ehh < 12)) ehh += 12;
  const endMin = ehh * 60 + em, startMin = h * 60 + sm;
  return { start, end: endMin > startMin ? hhmm(ehh, em) : null };
}

/** The 24h start of a stated range like "8:30 to 11a", "12:30 to 1:30pm", "8-10:50a", "11am-12pm". */
export function startOfRange(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = RANGE.exec(text);
  return m ? parseRange(m)?.start ?? null : null;
}
/** Every stated range in a text, in order. */
export function rangesIn(text: string | null | undefined): { start: string; end: string | null }[] {
  if (!text) return [];
  const out: { start: string; end: string | null }[] = [];
  for (const m of text.matchAll(RANGE_G)) { const r = parseRange(m as RegExpExecArray); if (r) out.push(r); }
  return out;
}
/** The window a text's ranges occupy: the first start to the last end ("11:20a - 12:20, and 1:00p - 1:50p" → 11:20–13:50). */
export function spanOf(text: string | null | undefined): { start: string; end: string | null } | null {
  const rs = rangesIn(text);
  if (!rs.length) return null;
  const ends = rs.map((r) => r.end).filter((e): e is string => !!e);
  return { start: rs[0].start, end: ends.length ? ends.reduce((a, b) => (toMinutes(b) > toMinutes(a) ? b : a)) : null };
}

/** The first weekday named in a text ("W, 8a-10:50a" → Wed). */
export function dayInText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = DAY_RE.exec(text);
  return m ? DAY_TOKEN[m[1].toLowerCase()] ?? null : null;
}

/** Per-section slots when the notes state them ("Section 1: … ; Section 2: …"), in section order. */
export function sectionSlotsFromNotes(notes: string | null | undefined): SectionSlot[] {
  if (!notes || !/section\s*\d/i.test(notes)) return [];
  const parts = notes.split(/(?=section\s*\d)/i).filter((p) => /^section\s*\d/i.test(p.trim()));
  const fallback = spanOf(notes);
  const out: { n: number; slot: SectionSlot }[] = [];
  for (const p of parts) {
    const n = Number(/section\s*(\d+)/i.exec(p)![1]);
    const body = p.replace(/^section\s*\d+\s*[,:.-]?\s*/i, "");
    const span = spanOf(body) ?? fallback;
    if (!span) continue;
    out.push({ n, slot: { dayOfWeek: dayInText(body.split(/\d/)[0]) ?? dayInText(body), startTime: span.start, endTime: span.end } });
  }
  return out.sort((a, b) => a.n - b.n).map((x) => x.slot);
}

/** The part of the notes that belongs to one weekday: from its token to the next day token ("M, T, 8:30 am – 3:00 pm & Friday 6:30-12:30" → for Fri, "6:30-12:30"). */
function daySegment(notes: string, dayOfWeek: string): string | null {
  const re = new RegExp(`(?:^|[\\s,(;&])(${Object.entries(DAY_TOKEN).filter(([, v]) => v === dayOfWeek).map(([k]) => k).sort((a, b) => b.length - a.length).join("|")})(?=[\\s,.:;)&]|$)`, "i");
  const m = re.exec(notes);
  if (!m) return null;
  const rest = notes.slice(m.index + m[0].length);
  // Stop at the next day token that is followed by its own range.
  const next = new RegExp(DAY_RE.source, "gi");
  for (const d of rest.matchAll(next)) { const after = rest.slice((d.index ?? 0) + d[0].length); if (RANGE.test(after.slice(0, 40))) return rest.slice(0, d.index); }
  return rest;
}
/** The session's own start time from its notes: the range that follows its weekday when the notes list several, else the first range. */
export function startTimeFromNotes(notes: string | null | undefined, dayOfWeek: string | null | undefined): string | null {
  if (!notes) return null;
  if (dayOfWeek) { const seg = daySegment(notes, dayOfWeek); const st = seg ? startOfRange(seg) : null; if (st) return st; }
  return startOfRange(notes);
}
/** The session's stated end time on its weekday: the end of the last range in its day's segment ("11:20a - 12:20, and 1:00p - 1:50p" → 13:50). Null when the sheet gives no end. */
export function endTimeFromNotes(notes: string | null | undefined, dayOfWeek: string | null | undefined): string | null {
  if (!notes) return null;
  if (dayOfWeek) { const seg = daySegment(notes, dayOfWeek); const sp = seg ? spanOf(seg) : null; if (sp?.end) return sp.end; }
  return spanOf(notes)?.end ?? null;
}

/** Encode / decode the Session.sectionTimes column ("08:00-10:50,Wed@13:40-16:30"; the end is optional). */
export const encodeSectionTimes = (slots: SectionSlot[]): string | null => (slots.length ? slots.map((s) => `${s.dayOfWeek ? `${s.dayOfWeek}@` : ""}${s.startTime}${s.endTime ? `-${s.endTime}` : ""}`).join(",") : null);
export function decodeSectionTimes(v: string | null | undefined): SectionSlot[] {
  if (!v) return [];
  return v.split(",").map((e) => e.trim()).filter(Boolean).map((e) => { const [a, b] = e.includes("@") ? e.split("@") : [null, e]; const [start, end] = b.split("-"); return { dayOfWeek: a, startTime: start, endTime: end ?? null }; });
}
/** The slot for section `si` (1-based): its own stated slot — extra sections beyond the stated ones
 *  cycle through them (a third section of a "T or Th" lab meets Tuesday) — else the session's day/time. */
export function sectionSlot(session: { dayOfWeek: string | null; startTime: string | null; sectionTimes?: string | null; endTime?: string | null }, si: number): SectionSlot | null {
  const slots = decodeSectionTimes(session.sectionTimes);
  const own = slots.length ? slots[(si - 1) % slots.length] : undefined;
  if (own) return { dayOfWeek: own.dayOfWeek ?? session.dayOfWeek, startTime: own.startTime, endTime: own.endTime ?? null };
  if (session.startTime) return { dayOfWeek: session.dayOfWeek, startTime: session.startTime, endTime: session.endTime ?? null };
  return null;
}
export const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
