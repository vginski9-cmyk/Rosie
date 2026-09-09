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

export interface SectionSlot { dayOfWeek: string | null; startTime: string }

const DAY_TOKEN: Record<string, string> = { m: "Mon", mon: "Mon", monday: "Mon", t: "Tue", tu: "Tue", tue: "Tue", tues: "Tue", tuesday: "Tue", w: "Wed", wed: "Wed", wednesday: "Wed", th: "Thu", thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", f: "Fri", fri: "Fri", friday: "Fri", sa: "Sat", sat: "Sat", saturday: "Sat", su: "Sun", sun: "Sun", sunday: "Sun" };
const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?";
const RANGE = new RegExp(`${TIME}\\s*(?:-|–|—|to)\\s*${TIME}(?![\\d:])`, "i");
const DAY_RE = /(?:^|[\s,(;])(Mon|Monday|Tue|Tues|Tuesday|Wed|Wednesday|Thu|Thur|Thurs|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday|M|T|W|Th|F)(?=[\s,.:;)]|$)/i;

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** The 24h start of a stated range like "8:30 to 11a", "12:30 to 1:30pm", "8-10:50a", "11am-12pm". */
export function startOfRange(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = RANGE.exec(text);
  if (!m) return null;
  const sh = Number(m[1]), sm = Number(m[2] ?? 0), sAp = (m[3] ?? "").toLowerCase();
  const eh = Number(m[4]), eAp = (m[6] ?? "").toLowerCase();
  if (sh < 1 || sh > 12 || sm > 59) return null;
  let pm: boolean;
  if (sAp) pm = sAp.startsWith("p");
  else if (eAp.startsWith("a")) pm = false;
  else if (eAp.startsWith("p")) pm = sh === 12 ? true : eh === 12 ? false : sh < eh ? true : false; // "10 to 1pm" is 10am; "1:40 to 4:30p" is pm; "12:30 to 1:30pm" is pm
  else pm = sh < eh || eh === 12 ? !(sh >= 5 && sh <= 11) : false; // no meridiem anywhere: "6:30-12:30" is morning; "10-1" crosses noon so 10 is am; "1-3" is afternoon
  let h = sh % 12; if (pm) h += 12;
  return hhmm(h, sm);
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
  const fallback = startOfRange(notes);
  const out: { n: number; slot: SectionSlot }[] = [];
  for (const p of parts) {
    const n = Number(/section\s*(\d+)/i.exec(p)![1]);
    const body = p.replace(/^section\s*\d+\s*[,:.-]?\s*/i, "");
    const start = startOfRange(body) ?? fallback;
    if (!start) continue;
    out.push({ n, slot: { dayOfWeek: dayInText(body.split(/\d/)[0]) ?? dayInText(body), startTime: start } });
  }
  return out.sort((a, b) => a.n - b.n).map((x) => x.slot);
}

/** The session's own start time from its notes: the range that follows its weekday when the notes list several, else the first range. */
export function startTimeFromNotes(notes: string | null | undefined, dayOfWeek: string | null | undefined): string | null {
  if (!notes) return null;
  if (dayOfWeek) {
    // "M, 11am-12pm; W, 1-2pm" → the range after this day's token.
    const re = new RegExp(`(?:^|[\\s,(;])(${Object.entries(DAY_TOKEN).filter(([, v]) => v === dayOfWeek).map(([k]) => k).sort((a, b) => b.length - a.length).join("|")})(?=[\\s,.:;)]|$)`, "i");
    const m = re.exec(notes);
    if (m) { const after = startOfRange(notes.slice(m.index + m[0].length)); if (after) return after; }
  }
  return startOfRange(notes);
}

/** Encode / decode the Session.sectionTimes column ("08:00,Wed@13:40"). */
export const encodeSectionTimes = (slots: SectionSlot[]): string | null => (slots.length ? slots.map((s) => (s.dayOfWeek ? `${s.dayOfWeek}@${s.startTime}` : s.startTime)).join(",") : null);
export function decodeSectionTimes(v: string | null | undefined): SectionSlot[] {
  if (!v) return [];
  return v.split(",").map((e) => e.trim()).filter(Boolean).map((e) => { const [a, b] = e.includes("@") ? e.split("@") : [null, e]; return { dayOfWeek: a, startTime: b }; });
}
/** The slot for section `si` (1-based): its own stated slot, else the session's day/time. */
export function sectionSlot(session: { dayOfWeek: string | null; startTime: string | null; sectionTimes?: string | null }, si: number): SectionSlot | null {
  const slots = decodeSectionTimes(session.sectionTimes);
  const own = slots[si - 1];
  if (own) return { dayOfWeek: own.dayOfWeek ?? session.dayOfWeek, startTime: own.startTime };
  if (session.startTime) return { dayOfWeek: session.dayOfWeek, startTime: session.startTime };
  return null;
}
export const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
