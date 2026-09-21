// How an offering is named, everywhere one is created (lock-in, the offering form, the seeds).
//
//   A program that graduates a class a year (an AAS, a diploma) names its offerings by the year the
//   last term ends: "Class of 2028".
//   A short-term program that runs several times a year (a Nurse Aide class, a continuing-education
//   course) names them by when and where they start: "Jan 2026 · Greene County Center". Two runs
//   that start the same month at the same place are told apart by their days and time of day
//   ("Jan 2026 · Greene County Center · Mon & Wed evening"), then by a number.
//
// The college's own reference for the run (a section number like 76811) is not the name; it is
// kept beside it as the offering's code.

export interface NamingProgram { launchCadence: string | null | undefined; /** The template's instructional weeks across its terms. */ spanWeeks: number }

/** A program whose runs are named by their start, not by a class year: a term or less long (twenty weeks),
 *  or run on demand. A two-year AAS that launches every Fall and Spring is still "Class of 2028". */
export const shortTermProgram = (p: NamingProgram): boolean => p.launchCadence === "ON_DEMAND" || p.spanWeeks <= 20;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthYearOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** The label a campus goes by in a name: the main campus by its city, any other by its own name. */
export const campusLabel = (c: { name: string; city?: string | null; isMain?: boolean } | null | undefined): string | null => (c ? (c.isMain && c.city ? c.city : c.name) : null);

/** The first name in the list that no sibling already uses, else the last one numbered. */
function unique(candidates: string[], existing: string[]): string {
  const taken = new Set(existing);
  for (const c of candidates) if (!taken.has(c)) return c;
  const base = candidates[candidates.length - 1];
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function offeringName(o: {
  shortTerm: boolean;
  startIso: string;
  /** The last term's last day (the class year for a long program). */
  endIso: string;
  /** Where it meets, already as a label (campusLabel). */
  campus?: string | null;
  /** Its days and time of day ("Mon & Wed evening"), used only to tell two same-month runs apart. */
  detail?: string | null;
  /** Names its siblings in the program already use. */
  existing: string[];
}): string {
  // A second class graduating the same year is a parallel class, and says so.
  if (!o.shortTerm) { const base = `Class of ${o.endIso.slice(0, 4)}`; return unique([base, `${base} · 2nd class`, `${base} · 3rd class`], o.existing); }
  const base = [monthYearOf(o.startIso), o.campus].filter(Boolean).join(" · ");
  return unique(o.detail ? [base, `${base} · ${o.detail}`] : [base], o.existing);
}

/** "Mon, Wed" + "5:30pm-9:30pm" → "Mon & Wed evening"; days alone → "Tue & Thu". */
export function runDetail(days: string[], startTime?: string | null): string {
  const d = days.join(" & ");
  if (!startTime) return d;
  const h = Number(startTime.split(":")[0]);
  const tod = h >= 17 ? "evening" : h >= 12 ? "afternoon" : "daytime";
  return d ? `${d} ${tod}` : tod;
}

/** What tells one delivery model from another inside a family: the part of the program's name after the dash,
 *  without the word "offering" — "Nurse Aide Level I — 11-week daytime offering" → "11-week daytime". */
export function programDetail(programName: string): string | null {
  const m = /[—–-]\s*(.+)$/.exec(programName);
  const d = (m ? m[1] : "").replace(/\boffering\b/i, "").replace(/\s+/g, " ").trim();
  return d || null;
}
