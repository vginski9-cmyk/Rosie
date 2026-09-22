// THE TEMPLATE IS THE SOURCE OF TRUTH — what a requirement is "represented" by is derived from the
// course's own clinical sessions and the setting rule each one's rotation type means, never from a
// hand-kept list of links. A session counts toward a requirement when its rotation rule reaches a
// setting the requirement's rule allows. When one session reaches several requirements of the same
// scope and unit, how its hours divide is a fact a person states (a stated share); until then it is
// listed as shared and counts for nothing — never split evenly by guesswork.
//
// COURSE ROTATION POOLS. Some templates tag every clinical session of a course generically ("Other
// (imaging rotations)" → GEN) while the course's requirements spread hours across settings no session
// is tagged for (ED, PORT, OR, FLUORO, CT). Those sessions cannot be matched setting by setting; the
// course's clinical hours are one pool that rotates through the requirements' settings. The pool is an
// explicit rule — every requirement setting, with the requirement quantities as minimums — that the
// scheduler seats minimums-first, and coverage allocates the pool's hours to the requirements in order,
// showing whether the total suffices. The per-session tagging stays an open question, never invented.
//
// Pure: takes the sessions, the requirements and the rule book; tested without a database.

import { eligibleSettings, type SettingRuleSpec } from "./settingrule";

export interface CoverageSession { id: string; courseId: string; label: string; hours: number; rotationType: string | null }
export interface CoverageRequirement {
  id: string; scope: string; courseId: string | null; unit: string;
  rule: SettingRuleSpec | null;
  /** The published (or draft) quantity — the pool's minimum for this requirement's setting. */
  quantity?: number | null;
  /** The requirement's interpretation and its rule are reviewed — a pool built only from reviewed requirements is reviewed. */
  reviewed?: boolean;
  /** A published version exists — only published requirements shape a course pool; a draft (a quantity nobody stated yet) is listed as a question, never a minimum. */
  published?: boolean;
  /** Shares a person stated for particular sessions (per learner), keyed by session id. */
  stated: Record<string, number>;
}
export interface Contributor { sessionId: string; label: string; hours: number; amount: number | null; source: "template" | "stated" | "pool"; sharedWith: string[] }
export interface CoursePool {
  courseId: string; rule: SettingRuleSpec; hours: number; sessions: number; minimums: number;
  /** Settings the requirements name that no session of the course is tagged for. */ untagged: string[];
  /** When every session has the same length: whole sessions needed to satisfy every minimum (Σ ceil(minimum ÷ length)) — a session is one setting per shift, so this is what the minimums really cost. */
  sessionsNeeded: number | null;
}
export interface Coverage {
  represented: number; contributors: Contributor[];
  /** Sessions whose share is not yet stated. */ unstated: number;
  /** Set when the course's rotation pool represents this requirement (its sessions are not tagged setting by setting). */
  pool?: { hours: number; sessions: number; minimums: number; allocated: number; sessionsNeeded: number | null };
}

const rotationRuleOf = (session: CoverageSession, rules: Map<string, SettingRuleSpec>) => (session.rotationType ? rules.get(session.rotationType.trim().toLowerCase()) ?? null : null);

/** Which requirements (of the given set) a session's rotation reaches. */
function reaches(session: CoverageSession, reqs: CoverageRequirement[], rules: Map<string, SettingRuleSpec>): CoverageRequirement[] {
  const rule = rotationRuleOf(session, rules);
  if (!rule) return [];
  const reach = eligibleSettings(rule.rule);
  return reqs.filter((r) => r.rule && eligibleSettings(r.rule.rule).some((s) => reach.includes(s)));
}

/** Sessions in a requirement's scope: its course's clinical sessions, or every clinical session of the program. */
function inScope(r: CoverageRequirement, sessions: CoverageSession[]): CoverageSession[] {
  if (r.scope === "course") return sessions.filter((s) => s.courseId === r.courseId);
  if (r.scope === "program") return sessions;
  return [];
}

/** A session is "generically tagged" when its rotation rule is a single setting (or missing) — the shape a course pool may specialize. */
const generic = (session: CoverageSession, rules: Map<string, SettingRuleSpec>) => { const r = rotationRuleOf(session, rules); return !r || r.rule.kind === "only"; };

/** The courses whose hour requirements name settings none of their sessions is tagged for — each gets a pool rule. */
export function coursePools(requirements: CoverageRequirement[], sessions: CoverageSession[], rules: Map<string, SettingRuleSpec>): Map<string, CoursePool> {
  const out = new Map<string, CoursePool>();
  const courseIds = [...new Set(requirements.filter((r) => r.scope === "course" && r.courseId).map((r) => r.courseId!))];
  for (const courseId of courseIds) {
    const all = requirements.filter((r) => r.scope === "course" && r.courseId === courseId && r.unit === "hours" && r.rule);
    const reqs = all.filter((r) => r.published !== false);
    const drafts = all.filter((r) => r.published === false);
    if (reqs.length < 2) continue;
    const mine = sessions.filter((s) => s.courseId === courseId);
    if (!mine.length || !mine.every((s) => generic(s, rules))) continue;
    const tagged = new Set(mine.flatMap((s) => { const r = rotationRuleOf(s, rules); return r ? eligibleSettings(r.rule) : []; }));
    const untagged = [...new Set(reqs.flatMap((r) => eligibleSettings(r.rule!.rule)))].filter((c) => !tagged.has(c));
    if (!untagged.length) continue; // every requirement setting has tagged sessions — coverage is exact setting by setting
    const settings = [...new Set(reqs.flatMap((r) => eligibleSettings(r.rule!.rule)))];
    const minimums = reqs.filter((r) => r.rule!.rule.kind === "only" && r.quantity != null && r.quantity > 0).map((r) => ({ setting: (r.rule!.rule as { setting: string }).setting, quantity: r.quantity as number }));
    // The pool's status comes from the requirements that SHAPE it (a minimum, or a setting no other requirement names); a
    // requirement that adds nothing to the pool — an unreviewed "any of" over settings already in it — is a listed question.
    const onlySettings = new Set(minimums.map((m) => m.setting));
    const shaping = reqs.filter((r) => minimums.some((m) => m.setting === (r.rule!.rule as { setting?: string }).setting && r.rule!.rule.kind === "only") || eligibleSettings(r.rule!.rule).some((c) => !onlySettings.has(c)));
    const reviewed = shaping.every((r) => r.reviewed);
    const unreviewedOthers = reqs.filter((r) => !shaping.includes(r) && !r.reviewed);
    const rule: SettingRuleSpec = {
      rule: { kind: "pool", settings, minimums }, mixing: "allowed", continuity: "unknown", scope: "learner",
      sourceText: `the course's clinical requirements: ${reqs.map((r) => `${eligibleSettings(r.rule!.rule).join("/")} ${r.quantity ?? "?"} h`).join(" · ")}`,
      status: reviewed ? "reviewed" : "needs-review",
      questions: [`The course's sessions are tagged ${[...tagged].join(", ") || "with no setting"} but its requirements also name ${untagged.join(", ")}: the sessions rotate through them as one pool; tag sessions by setting to make coverage exact.`, ...(drafts.length ? [`${drafts.length} requirement${drafts.length === 1 ? "" : "s"} of this course (${drafts.map((r) => eligibleSettings(r.rule!.rule).join("/")).join(", ")}) have no stated quantity yet and are not in the pool's minimums.`] : []), ...(unreviewedOthers.length ? [`${unreviewedOthers.length} requirement${unreviewedOthers.length === 1 ? "" : "s"} (${unreviewedOthers.map((r) => eligibleSettings(r.rule!.rule).join("/")).join("; ")}) still need${unreviewedOthers.length === 1 ? "s" : ""} interpretation review; they add no setting or minimum to the pool.`] : [])],
    };
    const lengths = new Set(mine.map((s) => s.hours));
    const len = lengths.size === 1 ? [...lengths][0] : null;
    out.set(courseId, { courseId, rule, hours: mine.reduce((n, s) => n + s.hours, 0), sessions: mine.length, minimums: minimums.reduce((n, m) => n + m.quantity, 0), untagged, sessionsNeeded: len && len > 0 ? minimums.reduce((n, m) => n + Math.ceil(m.quantity / len - 1e-9), 0) : null });
  }
  return out;
}

export function coverageOfRequirements(requirements: CoverageRequirement[], sessions: CoverageSession[], rules: Map<string, SettingRuleSpec>): Map<string, Coverage> {
  const out = new Map<string, Coverage>();
  const pools = coursePools(requirements, sessions, rules);
  // Pool allocation: the course's hours go to its requirements in order; each gets at most its quantity.
  const remaining = new Map<string, number>([...pools.values()].map((p) => [p.courseId, p.hours]));
  for (const r of requirements) {
    const contributors: Contributor[] = [];
    const scoped = inScope(r, sessions);
    const pool = r.scope === "course" && r.courseId && r.unit === "hours" && r.rule ? pools.get(r.courseId) : undefined;
    if (pool) {
      const left = remaining.get(pool.courseId) ?? 0;
      const allocated = r.quantity != null ? Math.min(r.quantity, left) : 0;
      remaining.set(pool.courseId, left - allocated);
      for (const s of scoped) contributors.push({ sessionId: s.id, label: s.label, hours: s.hours, amount: null, source: "pool", sharedWith: [] });
      out.set(r.id, { represented: allocated, contributors, unstated: 0, pool: { hours: pool.hours, sessions: pool.sessions, minimums: pool.minimums, allocated, sessionsNeeded: pool.sessionsNeeded } });
      continue;
    }
    // Siblings: same scope, same course (or program), same unit — the set one session's hours might have to divide among.
    const siblings = requirements.filter((x) => x.scope === r.scope && x.courseId === r.courseId && x.unit === r.unit && x.rule);
    for (const s of scoped) {
      const hit = reaches(s, siblings, rules);
      const stated = r.stated[s.id];
      if (!hit.some((x) => x.id === r.id)) {
        if (stated != null) contributors.push({ sessionId: s.id, label: s.label, hours: s.hours, amount: stated, source: "stated", sharedWith: [] });
        continue;
      }
      const others = hit.filter((x) => x.id !== r.id).map((x) => x.id);
      if (stated != null) contributors.push({ sessionId: s.id, label: s.label, hours: s.hours, amount: stated, source: "stated", sharedWith: others });
      else if (others.length === 0 && r.unit === "hours") contributors.push({ sessionId: s.id, label: s.label, hours: s.hours, amount: s.hours, source: "template", sharedWith: [] });
      else contributors.push({ sessionId: s.id, label: s.label, hours: s.hours, amount: null, source: "template", sharedWith: others });
    }
    // Stated shares on sessions outside the scope (a person's explicit statement still counts).
    for (const [sid, amt] of Object.entries(r.stated)) if (!contributors.some((c) => c.sessionId === sid)) { const s = sessions.find((x) => x.id === sid); contributors.push({ sessionId: sid, label: s?.label ?? "session", hours: s?.hours ?? 0, amount: amt, source: "stated", sharedWith: [] }); }
    out.set(r.id, { represented: contributors.reduce((n, c) => n + (c.amount ?? 0), 0), contributors, unstated: contributors.filter((c) => c.amount == null).length });
  }
  return out;
}
