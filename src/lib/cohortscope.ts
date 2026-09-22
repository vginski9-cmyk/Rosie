// WHICH COHORTS COUNT — one rule for the whole platform. Every offering that has not been archived
// is a record: planned, running or graduated. A page that looks forward narrows by DATE (the terms
// that overlap its window), never by status, so a graduated class stays on the calendar, in the
// site load, in the analytics and on its own page as history. Pure functions; the seeds, the
// queries and the pages all import them.

export const COUNTED_COHORT_STATUSES = ["planned", "active", "completed"] as const;
export type CountedCohortStatus = (typeof COUNTED_COHORT_STATUSES)[number];
/** The Prisma `where` fragment every cohort query uses: everything but an archived offering. */
export const NOT_ARCHIVED = { status: { not: "archived" } } as const;

/** The class year in an offering's name ("Class of 2026" → 2026), null when the name carries none. */
export function gradYearOf(name: string | null | undefined): number | null {
  const m = (name ?? "").match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

/** An offering's lifecycle from its dates alone: graduated once its last day has passed, running once its
 *  first day has, otherwise still ahead. The same rule wherever a status is derived. */
export function cohortStatusOn(startIso: string | null | undefined, endIso: string | null | undefined, todayIso: string): CountedCohortStatus {
  if (endIso && endIso < todayIso) return "completed";
  if (startIso && startIso <= todayIso) return "active";
  return "planned";
}

type Dated = { termStartByIndex: Record<number, string | null | undefined>; termEndByIndex?: Record<number, string | null | undefined> | null };
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

/** The first and last dated day of an offering's terms (null when nothing is dated). */
export function cohortSpan(c: Dated): { from: string | null; to: string | null } {
  const starts = Object.values(c.termStartByIndex).map(day).filter((v): v is string => !!v).sort();
  const ends = Object.values(c.termEndByIndex ?? {}).map(day).filter((v): v is string => !!v).sort();
  const from = starts[0] ?? null;
  const to = ends[ends.length - 1] ?? starts[starts.length - 1] ?? null;
  return { from, to };
}

/** The cohorts whose dated span touches [from, to] (`to` null = open-ended). An offering with no dates at
 *  all is kept — missing dates are unknown, never a reason to drop a record. */
export function cohortsOverlapping<T extends Dated>(cohorts: T[], from: string, to: string | null): T[] {
  return cohorts.filter((c) => {
    const span = cohortSpan(c);
    if (!span.from && !span.to) return true;
    const s = span.from ?? span.to!, e = span.to ?? span.from!;
    return e >= from && (to == null || s <= to);
  });
}

/** The first day of the academic year `todayIso` sits in: the most recent fall anchor (MM-DD) on or before it. */
export function academicYearStart(todayIso: string, fallStart = "08-15"): string {
  const y = Number(todayIso.slice(0, 4));
  const thisFall = `${y}-${fallStart}`;
  return thisFall <= todayIso ? thisFall : `${y - 1}-${fallStart}`;
}

/** The window a forward-looking board opens on: from the earliest term start inside the current academic
 *  year (else today) to 20 weeks past the last term start. History before it stays selectable. */
export function plannedWindow(cohorts: (Dated & { anchors?: { fallStart: string } })[], today = new Date()): { from: string; to: string } {
  const todayIso = today.toISOString().slice(0, 10);
  const fall = cohorts.find((c) => c.anchors?.fallStart)?.anchors?.fallStart ?? "08-15";
  const yearStart = academicYearStart(todayIso, fall);
  const starts = cohorts.flatMap((c) => Object.values(c.termStartByIndex).map(day).filter((v): v is string => !!v)).sort();
  const from = starts.find((s) => s >= yearStart) ?? todayIso;
  const last = starts[starts.length - 1] ?? todayIso;
  const to = new Date(new Date(last + "T00:00:00Z").getTime() + 20 * 7 * 86400000).toISOString().slice(0, 10);
  return { from, to: to < from ? from : to };
}
