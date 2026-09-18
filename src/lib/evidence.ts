// Evidence status — ONE ordered ladder for how well a site-experience capability is known, and
// the rule that every headline is computed from the WEAKEST required input (Phase 3 of
// docs/metrics-audit.md). Nothing here reads the database; the queries feed it flags.
//
//   inferred  → confirmed → committed → scheduled → verified complete
//
//   inferred          the asset map implies it (a fluoroscopy room ⇒ upper GIs) or someone entered an
//                     estimate; nobody at the site has said so. Never success-styled.
//   confirmed         the site confirmed it (a provision record with source VERIFIED; an asset or a
//                     staff count marked VERIFIED; a requirement set verified against its edition).
//   committed         confirmed AND the agreement is secured, the accreditor recognizes the site
//                     where one must, and a capacity figure is on record.
//   scheduled         committed AND a booking at the site exists for it.
//   verified complete committed/scheduled AND a preceptor-verified student log exists — per student.
//
// Off the ladder: `unknown` (no asset, no answer) and `unavailable` (the site said no, or declined).
// Missing is never zero and never available: an unknown input can only ever produce `unknown`.

export type EvidenceStatus = "unknown" | "unavailable" | "inferred" | "confirmed" | "committed" | "scheduled" | "verified-complete";

export const LADDER: EvidenceStatus[] = ["inferred", "confirmed", "committed", "scheduled", "verified-complete"];
const RANK: Record<EvidenceStatus, number> = { unknown: -2, unavailable: -1, inferred: 0, confirmed: 1, committed: 2, scheduled: 3, "verified-complete": 4 };
export const rankOf = (s: EvidenceStatus) => RANK[s];
/** The weakest of several statuses — what a roll-up may claim. */
export const weakest = (xs: EvidenceStatus[]): EvidenceStatus => xs.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), "verified-complete" as EvidenceStatus);
/** Success styling is allowed only from `confirmed` up. */
export const isSuccess = (s: EvidenceStatus) => RANK[s] >= RANK.confirmed;

/** How a site stands on one experience, from the inputs that exist today. `provided` is the basis of the
 *  best provider: confirmed (VERIFIED record), inferred (asset only), estimate (a guess entered), none
 *  (explicitly not provided), unknown (no asset, no record). */
export interface EvidenceInputs {
  provided: "confirmed" | "inferred" | "estimate" | "none" | "unknown";
  agreementSecured?: boolean;
  /** true when no accreditor recognition is required, or it is recognized. */
  accreditorOk?: boolean;
  /** a students-at-once / approved / cases-per-day figure exists (null is unknown, not zero). */
  capacityKnown?: boolean;
  scheduled?: boolean;
  verifiedComplete?: boolean;
}

export function evidenceStatus(i: EvidenceInputs): EvidenceStatus {
  if (i.provided === "unknown") return "unknown";
  if (i.provided === "none") return "unavailable";
  if (i.provided !== "confirmed") return "inferred"; // an estimate is a guess, not the site's word
  if (!(i.agreementSecured && (i.accreditorOk ?? true) && i.capacityKnown)) return "confirmed";
  if (!i.scheduled) return "committed";
  if (!i.verifiedComplete) return "scheduled";
  return "verified-complete";
}

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  unknown: "unknown — no asset, no answer",
  unavailable: "not provided",
  inferred: "possible — inferred, unconfirmed",
  confirmed: "confirmed with the site",
  committed: "committed — secured agreement and capacity on record",
  scheduled: "scheduled",
  "verified-complete": "verified complete",
};
/** Tailwind tones: success only from confirmed up; inferred is amber; unknown grey; unavailable rose. */
export const EVIDENCE_TONE: Record<EvidenceStatus, string> = {
  unknown: "bg-slate-100 text-slate-500",
  unavailable: "bg-rose-100 text-rose-700",
  inferred: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-700",
  committed: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-emerald-200 text-emerald-900",
  "verified-complete": "bg-emerald-600 text-white",
};

/** The one headline for a requirement scorecard, computed from the weakest required input:
 *  "Potential coverage identified for 42/42. Confirmed: 0/42." Green only when every required
 *  experience is confirmed; amber while any rests on inference; rose while any has no provider. */
export interface CoverageScore { required: number; requiredCovered: number; requiredConfirmed: number }
export function coverageHeadline(s: CoverageScore): { text: string; tone: "success" | "potential" | "gap" | "none"; status: EvidenceStatus | null } {
  if (s.required <= 0) return { text: "no required experiences to score", tone: "none", status: null };
  if (s.requiredConfirmed >= s.required) return { text: `Confirmed: ${s.required}/${s.required} required experiences`, tone: "success", status: "confirmed" };
  const potential = `Potential coverage identified for ${s.requiredCovered}/${s.required}. Confirmed: ${s.requiredConfirmed}/${s.required}.`;
  return s.requiredCovered >= s.required ? { text: potential, tone: "potential", status: "inferred" } : { text: potential, tone: "gap", status: "unavailable" };
}
export const HEADLINE_TONE: Record<ReturnType<typeof coverageHeadline>["tone"], string> = {
  success: "bg-emerald-100 text-emerald-700",
  potential: "bg-amber-100 text-amber-800",
  gap: "bg-rose-100 text-rose-700",
  none: "bg-slate-100 text-slate-500",
};

/** Whether a set of dates is provisional: no college calendar was imported for the institution, or term
 *  dates were set by hand / from the program pattern rather than taken from the calendar. */
export interface CalendarProvenance { calendarImported: boolean; termsTotal: number; termsFromCalendar: number; termsHandSet: number; termsPattern: number }
export function provisionalVerdict(p: CalendarProvenance): { level: "provisional" | "hand-set" | "ok"; text: string } {
  if (!p.calendarImported) return { level: "provisional", text: "Provisional dates — no college calendar has been imported; term dates follow the program pattern and only U.S. holidays are known." };
  const off = p.termsHandSet + p.termsPattern;
  if (off > 0 && p.termsTotal > 0) return { level: "hand-set", text: `${off} of ${p.termsTotal} term dates were set by hand or from the program pattern rather than taken from the college calendar.` };
  return { level: "ok", text: "Term dates come from the imported college calendar." };
}
