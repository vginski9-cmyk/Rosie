// One rule for how a cohort's seats are dealt into sections, shared by the scheduler, the
// calendarizer and the roster view: seats are dealt EVENLY — 41 students in 4 sections are
// 11, 10, 10, 10, never 20, 20, 1 — and a seat number always maps to the same section.

export interface SectionSpan { start: number; seats: number }

/** The seat spans of `sections` sections holding `total` students, dealt evenly (1-based seat numbers). */
export function sectionSpans(total: number, sections: number): SectionSpan[] {
  const n = Math.max(1, Math.round(sections)), E = Math.max(0, Math.round(total));
  const q = Math.floor(E / n), r = E % n;
  const out: SectionSpan[] = [];
  let start = 1;
  for (let i = 0; i < n; i++) { const seats = q + (i < r ? 1 : 0); out.push({ start, seats }); start += seats; }
  return out;
}

/** Which section (1-based) a seat number sits in. A seat past the dealt total keeps the same
 *  spacing (so a roster larger than the planned enrollment still maps every student somewhere). */
export function sectionOfSeat(seat: number, total: number, sections: number): number {
  const s = Math.max(1, Math.round(seat));
  const spans = sectionSpans(total, sections);
  const i = spans.findIndex((x) => x.seats > 0 && s >= x.start && s < x.start + x.seats);
  if (i >= 0) return i + 1;
  const per = Math.max(1, Math.ceil(Math.max(1, total) / Math.max(1, sections)));
  return Math.min(Math.max(1, sections), Math.max(1, Math.ceil(s / per)));
}
