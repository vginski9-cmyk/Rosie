// The holiday rule (Phase 13): a session whose weekly pattern lands on an observed holiday moves
// itself to the nearest open day in the same week, class, lab and clinical alike — instead of
// every collision being moved by hand. One rule, applied at every place a session is dated
// (lib/capacitymodel, the calendar's per-cohort dates, the design page, the master calendar), so
// the scheduler, coverage, the calendar and the exception queue all agree on where a session is.
//
//   next-open-day      forward first (Thu → Fri), then backward, inside the same Mon–Sun week;
//                      a weekday session stays on weekdays, a weekend session may use the weekend
//   previous-open-day  backward first, then forward
//   flag-only          never move — flag the collision for someone to resolve by hand
//
// A day already used by the same course and kind that week (class on Mon and Wed: the Mon holiday
// cannot move onto Wed) is never open. A day the cohort has any other session on (a class day, for
// a clinical shift) is avoided while a free day exists, and used only when the week has none.
//
// A whole week the college is closed for (spring break, winter break) never reaches this rule: it
// is not a term week at all (lib/term closedWeek) — the term's weeks continue on the far side of
// it and the term's last day moves out by a week, under every rule. What is left for the rule is
// the single closed day inside an open week.

export type HolidayRule = "next-open-day" | "previous-open-day" | "flag-only";
export const DEFAULT_HOLIDAY_RULE: HolidayRule = "next-open-day";
export const HOLIDAY_RULES: { value: HolidayRule; label: string; hint: string }[] = [
  { value: "next-open-day", label: "Next open day in the week", hint: "a session on a holiday moves forward to the next open day that week (then backward if the week ends)" },
  { value: "previous-open-day", label: "Previous open day in the week", hint: "a session on a holiday moves back to the nearest earlier open day that week (then forward)" },
  { value: "flag-only", label: "Flag only — move by hand", hint: "nothing moves on its own; every collision is listed for someone to resolve" },
];
export const BREAK_RULE_TEXT = "A week the college is closed for (a break) is not a term week: the sessions after it slide a week later and the term ends a week later, under every rule.";
export const isHolidayRule = (v: unknown): v is HolidayRule => HOLIDAY_RULES.some((r) => r.value === v);

/** U.S. observed holidays + common institutional breaks a session might land on — the fallback when
 *  no college calendar is coded. The imported calendar is the only authority once it exists. */
export function usHoliday(d: Date): string | null {
  const m = d.getUTCMonth() + 1, day = d.getUTCDate(), wd = d.getUTCDay();
  if (m === 1 && day === 1) return "New Year's Day";
  if (m === 1 && wd === 1 && day >= 15 && day <= 21) return "MLK Day";
  if (m === 5 && wd === 1 && day >= 25) return "Memorial Day";
  if (m === 6 && day === 19) return "Juneteenth";
  if (m === 7 && day === 4) return "Independence Day";
  if (m === 9 && wd === 1 && day <= 7) return "Labor Day";
  if (m === 10 && wd === 1 && day >= 8 && day <= 14) return "Indigenous Peoples' / Columbus Day";
  if (m === 11 && day === 11) return "Veterans Day";
  if (m === 11 && (wd === 4 || wd === 5)) { const thu = wd === 4 ? day : day - 1; if (thu >= 22 && thu <= 28) return wd === 4 ? "Thanksgiving" : "Day after Thanksgiving"; }
  if (m === 12 && (day === 24 || day === 25)) return day === 25 ? "Christmas Day" : "Christmas Eve";
  if (m === 12 && day >= 26) return "Winter break";
  return null;
}

const DAY = 86400000;
const dateOf = (iso: string) => new Date(iso + "T00:00:00Z");
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoOf(new Date(dateOf(iso).getTime() + n * DAY));
/** Monday = 0 … Sunday = 6. */
const dow = (iso: string) => (dateOf(iso).getUTCDay() + 6) % 7;

/** The holiday a date falls on: the coded calendar when one exists (it is the only authority then), else the U.S. list. */
export function holidayOn(iso: string, holidays?: Record<string, string> | null): string | null {
  if (holidays && Object.keys(holidays).length) return holidays[iso] ?? null;
  return usHoliday(dateOf(iso));
}

export interface HolidayResolution {
  /** Where the session is held. */
  dateIso: string;
  /** The pattern date it moved from, when the rule moved it. */
  fromIso: string | null;
  /** The holiday it moved off, or — when unresolved — the holiday it still sits on. */
  holiday: string | null;
  /** True when the date is a holiday and the rule could not (or may not) move it. */
  unresolved: boolean;
}

/** Apply the holiday rule to one pattern date. `taken` holds the ISO dates the same course and kind already use that
 *  week (never chosen); `avoid` holds the dates the cohort has any other session on (chosen only when nothing else is open). */
export function resolveHoliday(iso: string, holidays: Record<string, string> | null | undefined, opts: { rule?: HolidayRule; taken?: Set<string>; avoid?: Set<string> } = {}): HolidayResolution {
  const holiday = holidayOn(iso, holidays);
  if (!holiday) return { dateIso: iso, fromIso: null, holiday: null, unresolved: false };
  const rule = opts.rule ?? DEFAULT_HOLIDAY_RULE;
  if (rule === "flag-only") return { dateIso: iso, fromIso: null, holiday, unresolved: true };
  const d0 = dow(iso);
  const weekdayOnly = d0 <= 4; // a weekday session stays on weekdays
  const open = (n: number) => { const cand = addDays(iso, n); const d = dow(cand); if (weekdayOnly && d > 4) return null; if (holidayOn(cand, holidays)) return null; if (opts.taken?.has(cand)) return null; return cand; };
  const forward: number[] = [], backward: number[] = [];
  for (let n = 1; d0 + n <= 6; n++) forward.push(n);
  for (let n = 1; d0 - n >= 0; n++) backward.push(-n);
  const order = rule === "next-open-day" ? [...forward, ...backward] : [...backward, ...forward];
  // A free day first; a day the cohort already has something else on only when the week has no free day.
  for (const pass of [0, 1]) for (const n of order) { const cand = open(n); if (cand && (pass === 1 || !opts.avoid?.has(cand))) return { dateIso: cand, fromIso: iso, holiday, unresolved: false }; }
  return { dateIso: iso, fromIso: null, holiday, unresolved: true };
}

/** Resolve a batch of pattern dates that share one course and kind, in date order, so each moved
 *  session sees the days its siblings already hold. Returns resolutions keyed by the input index. */
export function resolveHolidays(isos: (string | null)[], holidays: Record<string, string> | null | undefined, rule?: HolidayRule, opts: { /** Every date the cohort has any session on (all courses and kinds) — avoided while a free day exists. */ cohortDates?: Iterable<string> } = {}): (HolidayResolution | null)[] {
  const byWeek = new Map<string, Set<string>>();
  const weekOf = (iso: string) => addDays(iso, -dow(iso));
  for (const iso of isos) if (iso) { const w = weekOf(iso); const s = byWeek.get(w) ?? new Set<string>(); s.add(iso); byWeek.set(w, s); }
  const avoid = new Set(opts.cohortDates ?? []);
  const order = isos.map((iso, i) => ({ iso, i })).filter((x): x is { iso: string; i: number } => !!x.iso).sort((a, b) => a.iso.localeCompare(b.iso));
  const out: (HolidayResolution | null)[] = isos.map(() => null);
  for (const { iso, i } of order) {
    const taken = byWeek.get(weekOf(iso)) ?? new Set<string>();
    const r = resolveHoliday(iso, holidays, { rule, taken, avoid });
    if (r.fromIso) { taken.delete(r.fromIso); taken.add(r.dateIso); avoid.add(r.dateIso); }
    out[i] = r;
  }
  return out;
}
