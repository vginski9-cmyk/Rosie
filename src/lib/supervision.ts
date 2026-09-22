// SUPERVISION — an explicit resource model for who must be with a clinical group.
//
// The workbook gives a clinical session a mode ("Instructor-Led Clinical Group", "preceptor-led",
// "hybrid") and two counts (faculty per section, preceptors per section). Those columns stay — they
// drive the contact-hour and FTE columns exactly as before (lib/capacitymodel). What was missing is
// the ROLE model behind them: which roles are required at all, who supplies each (the college or
// the site), how many per group or how many learners per person, whether a named assignment is
// needed before a shift is "ready", and what is unknown. Reading a mode string in six places gave
// six answers; this module gives one, and every consumer (scheduler readiness, staffing need,
// coverage, exceptions, the levers card) asks it.
//
// Nothing here turns an unknown mode into preceptor-led: an unrecognized mode is "unknown" and
// carries a review question. Nothing here invents a ratio: a required role with no count is a
// missing policy, reported as such — never zero staff, never one.

export type SupervisionRole = "instructor" | "preceptor";
export type SupervisionMode = "instructor-led" | "preceptor-led" | "combined" | "unknown";

export interface RoleRequirement {
  role: SupervisionRole;
  /** Who supplies the person. */
  responsibleOrg: "college" | "site";
  /** Is the role required for this session to run at all? */
  required: boolean;
  /** Fixed people per group (a section), when the policy is stated that way. */
  staffPerGroup: number | null;
  /** Or the most learners one person may supervise (1 for one-to-one precepting). */
  maxLearnersPerStaff: number | null;
  /** Must a named person be assigned before the shift counts as ready? */
  namedAssignmentRequired: boolean;
  /** Present the whole time, part of it, or not stated. */
  presence: "continuous" | "intermittent" | "unknown";
  qualifications: string | null;
  validFrom: string | null; validTo: string | null;
  source: string | null;
  /** A role whose count came from a stated policy is reviewed; one with no count is a missing policy. */
  status: "reviewed" | "needs-review";
  note: string | null;
}

export interface SupervisionSpec {
  mode: SupervisionMode;
  roles: RoleRequirement[];
  sourceText: string | null;
  status: "reviewed" | "needs-review";
  questions: string[];
}

const MODE_WORDS: [RegExp, SupervisionMode][] = [
  [/hybrid|combined|both|instructor.*preceptor|preceptor.*instructor/i, "combined"],
  [/instructor|faculty|group/i, "instructor-led"],
  [/preceptor|1:1|one[- ]to[- ]one/i, "preceptor-led"],
];
/** The legacy mode string → a mode, or unknown. Explicit words only; nothing is coerced. */
export function modeFromText(text: string | null | undefined): SupervisionMode {
  const t = (text ?? "").trim();
  if (!t) return "unknown";
  for (const [re, m] of MODE_WORDS) if (re.test(t)) return m;
  return "unknown";
}

export interface LegacySessionStaffing { clinicalMode: string | null; facultyNeeded: number | null; preceptorsNeeded: number | null; maxStudents: number | null }

/** The explicit roles a session's legacy columns imply — the migration's deterministic mapping and the fallback when no role rows are stored.
 *  instructor-led: an instructor per group is required; the faculty count is its policy (0 or blank = the policy is missing, not zero staff).
 *  preceptor-led: preceptors per group are required (a fractional faculty figure is oversight, not presence); instructor not required.
 *  combined: both required. unknown: each role required only where its count is positive; the mode itself needs review. */
export function supervisionFromLegacy(s: LegacySessionStaffing): SupervisionSpec {
  const mode = modeFromText(s.clinicalMode);
  const fac = s.facultyNeeded ?? null, pre = s.preceptorsNeeded ?? null;
  const questions: string[] = [];
  const role = (r: SupervisionRole, required: boolean, count: number | null, note: string | null = null): RoleRequirement => {
    const stated = count != null && count > 0;
    if (required && !stated) questions.push(`${r === "instructor" ? "Instructors" : "Preceptors"} are required for this session but no count or ratio is on record — what is the policy?`);
    return {
      role: r, responsibleOrg: r === "instructor" ? "college" : "site", required,
      staffPerGroup: stated && (r === "instructor" || count >= 1) ? count : null,
      maxLearnersPerStaff: stated && r === "preceptor" && count < 1 ? Math.round(1 / count) : r === "preceptor" && stated && count >= 1 && s.maxStudents ? Math.max(1, Math.round((s.maxStudents ?? 1) / count)) : null,
      namedAssignmentRequired: required, presence: required ? "continuous" : "unknown", qualifications: null, validFrom: null, validTo: null, source: s.clinicalMode ? `session mode "${s.clinicalMode}"` : "session staffing columns",
      status: required && !stated ? "needs-review" : "reviewed", note,
    };
  };
  let roles: RoleRequirement[];
  switch (mode) {
    case "instructor-led":
      roles = [role("instructor", true, fac), role("preceptor", false, pre, pre && pre > 0 ? "a preceptor count is on record although the mode is instructor-led — confirm whether site preceptors are required" : null)];
      if (pre && pre > 0) questions.push("The mode is instructor-led but a preceptor count is on record: are site preceptors required as well?");
      break;
    case "preceptor-led":
      roles = [role("preceptor", true, pre), role("instructor", (fac ?? 0) >= 1, fac, fac != null && fac > 0 && fac < 1 ? `faculty oversight of ${fac} per section (not a presence requirement)` : null)];
      break;
    case "combined":
      roles = [role("instructor", true, fac), role("preceptor", true, pre)];
      break;
    default:
      roles = [role("instructor", (fac ?? 0) >= 1, fac), role("preceptor", (pre ?? 0) > 0, pre)];
      questions.push(s.clinicalMode ? `The clinical mode "${s.clinicalMode}" is not a recognized supervision model — is it instructor-led, preceptor-led or both?` : "No clinical mode is recorded — is this session instructor-led, preceptor-led or both?");
  }
  return { mode, roles, sourceText: s.clinicalMode ?? null, status: questions.length ? "needs-review" : "reviewed", questions };
}

/** Parse stored role rows (JSON) into a spec, else null. */
export function parseSupervision(json: string | null | undefined): SupervisionSpec | null {
  if (!json) return null;
  try { const v = JSON.parse(json) as SupervisionSpec; if (!v || !Array.isArray(v.roles)) return null; return { mode: v.mode ?? "unknown", roles: v.roles, sourceText: v.sourceText ?? null, status: v.status === "reviewed" ? "reviewed" : "needs-review", questions: Array.isArray(v.questions) ? v.questions : [] }; } catch { return null; }
}

export const requiredRoles = (spec: SupervisionSpec) => spec.roles.filter((r) => r.required);
export const requires = (spec: SupervisionSpec, role: SupervisionRole) => spec.roles.some((r) => r.role === role && r.required);

/** People a role needs for ONE group of `learners` under its policy; null when the policy is missing. */
export function peopleForGroup(r: RoleRequirement, learners: number): number | null {
  if (!r.required) return 0;
  if (r.staffPerGroup != null) return r.staffPerGroup;
  if (r.maxLearnersPerStaff != null && r.maxLearnersPerStaff > 0) return Math.ceil(learners / r.maxLearnersPerStaff);
  return null;
}

export interface StaffDemand {
  /** learners × hours (each learner's own clock time). */
  learnerHours: number;
  /** groups × hours (the time a group occupies a place). */
  groupHours: number;
  /** People needed at the same time, per role; null = policy missing. */
  concurrent: Record<SupervisionRole, number | null>;
  /** People × hours, per role (contact hours); null = policy missing. */
  contactHours: Record<SupervisionRole, number | null>;
  /** Roles that are required but have no count policy. */
  missingPolicy: SupervisionRole[];
}
/** Staff demand from the group structure and actual time: `groups` simultaneous groups of `learnersPerGroup` for `hours`.
 *  Ten learners in one six-hour instructor-led group: 60 learner-hours, 6 group hours, 1 instructor, 6 instructor hours, 0 preceptors. */
export function staffDemand(spec: SupervisionSpec, groups: number, learnersPerGroup: number, hours: number): StaffDemand {
  const learnerHours = groups * learnersPerGroup * hours;
  const groupHours = groups * hours;
  const concurrent: Record<SupervisionRole, number | null> = { instructor: 0, preceptor: 0 };
  const contactHours: Record<SupervisionRole, number | null> = { instructor: 0, preceptor: 0 };
  const missingPolicy: SupervisionRole[] = [];
  for (const r of spec.roles) {
    if (!r.required) continue;
    const per = peopleForGroup(r, learnersPerGroup);
    if (per == null) { concurrent[r.role] = null; contactHours[r.role] = null; missingPolicy.push(r.role); continue; }
    concurrent[r.role] = (concurrent[r.role] ?? 0) + per * groups;
    contactHours[r.role] = (contactHours[r.role] ?? 0) + per * groups * hours;
  }
  return { learnerHours, groupHours, concurrent, contactHours, missingPolicy };
}

// ── One person, several obligations ────────────────────────────────────────────────────────────────
export interface Obligation { personId: string; date: string; startMin: number; endMin: number; groupKey: string; role: SupervisionRole }
/** Overlapping obligations of one person are a conflict unless an explicit policy lets that person serve several groups at once. */
export function overlappingObligations(obligations: Obligation[], sharingAllowed: (a: Obligation, b: Obligation) => boolean = () => false): { personId: string; date: string; a: Obligation; b: Obligation }[] {
  const out: ReturnType<typeof overlappingObligations> = [];
  const byPerson = new Map<string, Obligation[]>();
  for (const o of obligations) { const l = byPerson.get(`${o.personId}|${o.date}`) ?? []; l.push(o); byPerson.set(`${o.personId}|${o.date}`, l); }
  for (const list of byPerson.values()) {
    const sorted = [...list].sort((x, y) => x.startMin - y.startMin);
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (b.startMin >= a.endMin) break;
      if (a.groupKey === b.groupKey) continue;
      if (!sharingAllowed(a, b)) out.push({ personId: a.personId, date: a.date, a, b });
    }
  }
  return out;
}

// ── Role-specific guidance ─────────────────────────────────────────────────────────────────────────
export type RoleState = "not-required" | "unassigned" | "assigned-unavailable" | "no-qualified-person" | "unknown-qualification" | "expired" | "assigned" | "confirmed";
export interface RoleFinding { role: SupervisionRole; state: RoleState; needed: number | null; assigned: number; detail: string; remedy: string | null }

/** What to say about one role on one shift. `available` = qualified, authorized people free for the window (null = qualification or availability unknown). */
export function roleFinding(r: RoleRequirement, learners: number, assigned: number, available: number | null, siteName: string | null, opts: { placementDate?: string; confirmed?: boolean; conflictLabel?: string | null } = {}): RoleFinding {
  const who = r.role === "instructor" ? "college instructor" : "site preceptor";
  if (!r.required) return { role: r.role, state: "not-required", needed: 0, assigned, detail: `${who}s are not required for this session`, remedy: null };
  if (r.validTo && opts.placementDate && opts.placementDate > r.validTo) return { role: r.role, state: "expired", needed: null, assigned, detail: `the ${who} policy on record expired ${r.validTo}`, remedy: `renew or re-confirm the ${who} requirement` };
  const needed = peopleForGroup(r, learners);
  if (needed == null) return { role: r.role, state: "unknown-qualification", needed: null, assigned, detail: `${who}s are required but no count or ratio is on record`, remedy: `record the ${who} policy for this session (people per group, or learners per person)` };
  if (assigned >= needed) {
    if (opts.conflictLabel) return { role: r.role, state: "assigned-unavailable", needed, assigned, detail: `the assigned ${who} is not free: ${opts.conflictLabel}`, remedy: `resolve the overlap or assign another ${who}` };
    return { role: r.role, state: opts.confirmed || !r.namedAssignmentRequired ? "confirmed" : "assigned", needed, assigned, detail: `${assigned} of ${needed} ${who}${needed === 1 ? "" : "s"} assigned`, remedy: null };
  }
  if (available == null) return { role: r.role, state: "unknown-qualification", needed, assigned, detail: `${needed - assigned} more ${who}${needed - assigned === 1 ? "" : "s"} needed; whether a qualified person is available is not known`, remedy: `record ${who} qualifications and availability${siteName ? ` at ${siteName}` : ""}` };
  if (available <= 0) return { role: r.role, state: "no-qualified-person", needed, assigned, detail: r.role === "instructor" ? `no qualified college instructor is free for this group` : `no qualified, available preceptor${siteName ? ` at ${siteName}` : ""} for this window`, remedy: r.role === "instructor" ? "assign a qualified college instructor for this clinical group (or free one from an overlapping assignment)" : `secure a qualified preceptor${siteName ? ` at ${siteName}` : ""} for this window` };
  return { role: r.role, state: "unassigned", needed, assigned, detail: `${needed - assigned} ${who}${needed - assigned === 1 ? "" : "s"} not yet assigned (${available} available)`, remedy: r.role === "instructor" ? "assign a qualified college instructor for this clinical group" : `assign a preceptor${siteName ? ` at ${siteName}` : ""} to this shift` };
}
