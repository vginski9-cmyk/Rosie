// REQUIREMENT STORE — server-side reads that turn stored rows into the typed contracts every consumer uses.
//
//   ruleBook(institutionId)          rotation type → SettingRuleSpec (stored rule, else the compatibility adapter)
//   supervisionBook(programIds)      session id → SupervisionSpec (session > course > program > family > legacy columns)
//   requirementLedger(programId)     every requirement in scope with its published version, fulfilment links and the
//                                    reconciliation against session hours and setting-coded hours
//
// The compatibility adapter is the ONLY place a legacy single `settingCode` is still read: a plain rotation
// name with one code becomes a reviewed "only" rule; compound wording ("A or B", "A & B", "A / B") becomes a
// proposed rule that needs review — never silently the first setting. The backfill script persists the same
// outcome, so the adapter and the migration cannot disagree.

import { prisma } from "./db";
import { parseRuleSpec, ruleFromLegacy, KNOWN_SETTINGS, eligibleSettings, proposeRuleFromText, type SettingRuleSpec } from "./settingrule";
import { parseSupervision, supervisionFromLegacy, type SupervisionSpec } from "./supervision";

export interface RotationRuleRow { id: string; rotationType: string; settingCode: string | null; rule: string | null; sourceText: string | null; interpretationStatus: string; reviewedBy: string | null; reviewedAt: Date | null; revision: number; unitCategory: string; unitType: string | null; patientsPerStudent: number | null; notes: string | null }

/** The rule a stored rotation row means today (lib/settingrule ruleFromLegacy — pure, shared with the demand builders and the backfill). */
export const ruleOfRow = ruleFromLegacy;

export interface RuleBook { rules: Map<string, SettingRuleSpec>; rows: RotationRuleRow[]; known: Set<string> }
/** Every rotation type of an institution with the rule it means; keys are lower-cased rotation types. */
export async function ruleBook(institutionId: string): Promise<RuleBook> {
  const [rows, codes] = await Promise.all([
    prisma.rotationSetting.findMany({ where: { institutionId }, orderBy: { rotationType: "asc" } }),
    prisma.clinicalAsset.findMany({ where: { employer: { institutionId }, status: { not: "archived" } }, distinct: ["settingCode"], select: { settingCode: true } }),
  ]);
  const known = new Set([...KNOWN_SETTINGS, ...codes.map((c) => c.settingCode)]);
  const rules = new Map<string, SettingRuleSpec>();
  for (const r of rows) { const spec = ruleOfRow(r, known); if (spec) rules.set(r.rotationType.trim().toLowerCase(), spec); }
  return { rules, rows, known };
}
/** The rotation rows as the demand builders want them: the legacy code (first eligible setting) AND the rule. */
/** Rotation types in use that have no row: tagged automatically from their wording against the taxonomy, as PROPOSED rules
 *  (never saved here) — the session rows show them with one-click keep, and demand reaches their settings conditionally. */
export function autoProposedRules(book: RuleBook, rotationTypesInUse: string[]): { rotationType: string; rule: SettingRuleSpec }[] {
  const out: { rotationType: string; rule: SettingRuleSpec }[] = []; const seen = new Set<string>();
  for (const t of rotationTypesInUse) {
    const k = t.trim().toLowerCase(); if (!k || seen.has(k) || book.rules.has(k)) continue; seen.add(k);
    const rule = proposeRuleFromText(t, book.known); if (rule) out.push({ rotationType: t.trim(), rule });
  }
  return out;
}

export function rotationCodes(book: RuleBook):{ rotationType: string; settingCode: string | null; unitCategory: string; rule: SettingRuleSpec | null }[] {
  return book.rows.map((r) => { const rule = book.rules.get(r.rotationType.trim().toLowerCase()) ?? null; return { rotationType: r.rotationType, settingCode: rule ? eligibleSettings(rule.rule)[0] ?? null : r.settingCode, unitCategory: r.unitCategory, rule }; });
}

// ── Supervision ────────────────────────────────────────────────────────────────────────────────────
export interface SupervisionResolution { spec: SupervisionSpec; source: string; /** A planning rule below a mandatory one that relaxes it — flagged, never applied. */ conflicts: string[] }
/** Session id → the supervision that applies: the most specific reviewed rule, with mandatory rules above it never relaxed; else the legacy columns. */
export async function supervisionBook(programIds: string[]): Promise<Map<string, SupervisionResolution>> {
  if (!programIds.length) return new Map();
  const programs = await prisma.program.findMany({ where: { id: { in: programIds } }, select: { id: true, familyId: true, terms: { select: { courses: { select: { id: true, sessions: { where: { kind: "CLINICAL" }, select: { id: true, clinicalMode: true, facultyNeeded: true, preceptorsNeeded: true, maxStudents: true } } } } } } } });
  const familyIds = [...new Set(programs.map((p) => p.familyId).filter((x): x is string => !!x))];
  const courseIds = programs.flatMap((p) => p.terms.flatMap((t) => t.courses.map((c) => c.id)));
  const sessionIds = programs.flatMap((p) => p.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => s.id))));
  const rules = await prisma.supervisionRule.findMany({ where: { OR: [{ familyId: { in: familyIds } }, { programId: { in: programIds } }, { courseId: { in: courseIds } }, { sessionId: { in: sessionIds } }] } });
  const byKey = (k: string, id: string | null) => rules.filter((r) => (r as Record<string, unknown>)[k] === id);
  const out = new Map<string, SupervisionResolution>();
  for (const p of programs) for (const t of p.terms) for (const c of t.courses) for (const s of c.sessions) {
    const chain = [
      ...byKey("familyId", p.familyId).map((r) => ({ r, level: "family" })),
      ...byKey("programId", p.id).map((r) => ({ r, level: "program" })),
      ...byKey("courseId", c.id).map((r) => ({ r, level: "course" })),
      ...byKey("sessionId", s.id).map((r) => ({ r, level: "session" })),
    ];
    const legacy = supervisionFromLegacy(s);
    let chosen: { spec: SupervisionSpec; source: string } = { spec: legacy, source: "session staffing columns" };
    const conflicts: string[] = [];
    const mandatory: { spec: SupervisionSpec; level: string }[] = [];
    for (const { r, level } of chain) {
      const spec = parseSupervision(r.spec); if (!spec) continue;
      if (r.authority === "mandatory") mandatory.push({ spec, level });
      // A planning rule may not drop a role a mandatory rule above it requires.
      const relaxes = mandatory.filter((m) => m.spec !== spec).flatMap((m) => m.spec.roles.filter((mr) => mr.required && !spec.roles.some((x) => x.role === mr.role && x.required)).map((mr) => `${level} rule drops the ${mr.role} the ${m.level} rule requires`));
      if (relaxes.length) { conflicts.push(...relaxes); continue; }
      chosen = { spec, source: `${level} rule${r.status === "reviewed" ? "" : " (needs review)"}` };
    }
    out.set(s.id, { ...chosen, conflicts });
  }
  return out;
}

// ── Coverage inputs shared by the ledger and the demand builders ────────────────────────────────
type ReqRow = { id: string; scope: string; courseId: string | null; versions: { status: string; unit: string; settingRule: string | null; interpretationStatus: string; quantity: number | null }[]; fulfillments: { sessionId: string | null; amount: number | null; note: string | null }[] };
function coverageRequirementOf(r: ReqRow): import("./requirementcoverage").CoverageRequirement {
  const pub = r.versions.find((v) => v.status === "published") ?? r.versions.find((v) => v.status === "draft") ?? null;
  const rule = parseRuleSpec(pub?.settingRule);
  return { id: r.id, scope: r.scope, courseId: r.courseId, unit: pub?.unit ?? "hours", rule, quantity: pub?.quantity ?? null, published: !!pub && pub.status === "published", reviewed: !!pub && pub.status === "published" && pub.interpretationStatus === "reviewed" && (!rule || rule.status === "reviewed"), stated: Object.fromEntries(r.fulfillments.filter((f) => f.sessionId && f.amount != null && !(f.note ?? "").startsWith("backfill:")).map((f) => [f.sessionId!, f.amount!])) };
}
/** COURSE ROTATION POOLS (lib/requirementcoverage): for every course of the programs whose requirements name settings none
 *  of its sessions is tagged for, the pool rule the scheduler and the capacity views read for that course's sessions —
 *  every requirement setting, with the quantities as minimums. Keyed by course id. */
export async function coursePoolRules(programIds: string[]): Promise<Record<string, SettingRuleSpec>> {
  const out: Record<string, SettingRuleSpec> = {};
  if (!programIds.length) return out;
  const { coursePools } = await import("./requirementcoverage");
  const programs = await prisma.program.findMany({ where: { id: { in: programIds } }, select: { id: true, institutionId: true, terms: { select: { courses: { select: { id: true, sessions: { where: { kind: "CLINICAL" }, select: { id: true, lengthHours: true, rotationType: true } } } } } } } });
  const books = new Map<string, RuleBook>();
  for (const p of programs) {
    const book = books.get(p.institutionId) ?? await ruleBook(p.institutionId); books.set(p.institutionId, book);
    const courseIds = p.terms.flatMap((t) => t.courses.map((c) => c.id));
    const rows = await prisma.clinicalRequirement.findMany({ where: { scope: "course", courseId: { in: courseIds } }, include: { versions: { orderBy: { version: "desc" } }, fulfillments: true } });
    const sessions = p.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => ({ id: s.id, courseId: c.id, label: s.id, hours: s.lengthHours, rotationType: s.rotationType }))));
    for (const [courseId, pool] of coursePools(rows.map(coverageRequirementOf), sessions, book.rules)) out[courseId] = pool.rule;
  }
  return out;
}

// ── The requirement ledger for one program ──────────────────────────────────────────────────────
export interface LedgerRequirement {
  id: string; scope: string; key: string; label: string; scopeLabel: string;
  courseId: string | null; sessionId: string | null;
  /** The sessions of the template that satisfy this requirement — derived from their rotation rules (lib/requirementcoverage), plus any share a person stated. */
  contributors: import("./requirementcoverage").Contributor[];
  /** Contributors whose share is not yet stated (a session reaching several requirements). */
  unstated: number;
  version: { id: string; version: number; status: string; quantity: number | null; unit: string; basis: string; settingRule: SettingRuleSpec | null; supervision: SupervisionSpec | null; capabilities: unknown[]; sourceText: string | null; sourceAuthority: string; interpretationStatus: string; reviewedBy: string | null; reviewedAt: string | null; publishedAt: string | null; notes: string | null; updatedAt: string } | null;
  draft: { id: string; version: number; updatedAt: string } | null;
  versions: number;
  /** Session / course links and the amount each contributes (per learner). */
  fulfillments: { id: string; sessionId: string | null; courseId: string | null; label: string; amount: number | null }[];
  /** Represented = Σ fulfilment amounts; the gap or overcount against the published quantity. */
  represented: number; unresolved: number;
  /** Set when the course's rotation pool represents this requirement (sessions are tagged generically; the pool's hours are allocated in order). */
  pool?: { hours: number; sessions: number; minimums: number; allocated: number; sessionsNeeded: number | null };
}
export async function requirementLedger(programId: string): Promise<{ requirements: LedgerRequirement[]; familyId: string | null }> {
  const program = await prisma.program.findUnique({ where: { id: programId }, select: { id: true, familyId: true, institutionId: true, terms: { select: { courses: { select: { id: true, code: true, name: true, sessions: { select: { id: true, kind: true, number: true, title: true, lengthHours: true, rotationType: true } } } } } } } });
  if (!program) return { requirements: [], familyId: null };
  const courseIds = program.terms.flatMap((t) => t.courses.map((c) => c.id));
  const sessionIds = program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => s.id)));
  const [rows, book] = await Promise.all([
    prisma.clinicalRequirement.findMany({
      where: { OR: [{ familyId: program.familyId ?? "-" }, { programId }, { courseId: { in: courseIds } }, { sessionId: { in: sessionIds } }] },
      include: { versions: { orderBy: { version: "desc" } }, fulfillments: true }, orderBy: [{ scope: "asc" }, { label: "asc" }],
    }),
    ruleBook(program.institutionId),
  ]);
  const courseLabel = new Map(program.terms.flatMap((t) => t.courses.map((c) => [c.id, c.code ?? c.name] as const)));
  const sessionLabel = new Map(program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => [s.id, `${c.code ?? c.name} clinical ${s.number}${s.title ? ` · ${s.title}` : ""}`] as const))));
  // The template is the source of truth: what each requirement is represented by comes from the course's own clinical
  // sessions and their rotation rules; a person's stated share for a session that reaches several requirements is honoured.
  const { coverageOfRequirements } = await import("./requirementcoverage");
  const covSessions = program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.filter((s) => s.kind === "CLINICAL").map((s) => ({ id: s.id, courseId: c.id, label: sessionLabel.get(s.id) ?? "session", hours: s.lengthHours, rotationType: s.rotationType }))));
  const covReqs = rows.map(coverageRequirementOf);
  const coverage = coverageOfRequirements(covReqs, covSessions, book.rules);
  const requirements: LedgerRequirement[] = rows.map((r) => {
    const pub = r.versions.find((v) => v.status === "published") ?? null;
    const draft = r.versions.find((v) => v.status === "draft") ?? null;
    const fulfillments = r.fulfillments.filter((f) => !(f.note ?? "").startsWith("backfill:")).map((f) => ({ id: f.id, sessionId: f.sessionId, courseId: f.courseId, label: f.sessionId ? sessionLabel.get(f.sessionId) ?? "session" : f.courseId ? courseLabel.get(f.courseId) ?? "course" : "—", amount: f.amount }));
    const cov = coverage.get(r.id) ?? { represented: 0, contributors: [], unstated: 0 };
    // Course-level stated amounts (a whole course counted for a requirement) still add on top of the template's sessions.
    const represented = cov.represented + fulfillments.filter((f) => f.courseId && !f.sessionId).reduce((n, f) => n + (f.amount ?? 0), 0);
    const version = pub ? {
      id: pub.id, version: pub.version, status: pub.status, quantity: pub.quantity, unit: pub.unit, basis: pub.basis, settingRule: parseRuleSpec(pub.settingRule), supervision: parseSupervision(pub.supervision),
      capabilities: (() => { try { return JSON.parse(pub.capabilities) as unknown[]; } catch { return []; } })(), sourceText: pub.sourceText, sourceAuthority: pub.sourceAuthority, interpretationStatus: pub.interpretationStatus, reviewedBy: pub.reviewedBy, reviewedAt: pub.reviewedAt?.toISOString() ?? null, publishedAt: pub.publishedAt?.toISOString() ?? null, notes: pub.notes, updatedAt: pub.updatedAt.toISOString(),
    } : null;
    const scopeLabel = r.scope === "family" ? "family standard" : r.scope === "program" ? "program" : r.scope === "course" ? courseLabel.get(r.courseId ?? "") ?? "course" : sessionLabel.get(r.sessionId ?? "") ?? "session";
    return { id: r.id, scope: r.scope, key: r.key, label: r.label, scopeLabel, courseId: r.courseId, sessionId: r.sessionId, contributors: cov.contributors, unstated: cov.unstated, pool: cov.pool, version, draft: draft ? { id: draft.id, version: draft.version, updatedAt: draft.updatedAt.toISOString() } : null, versions: r.versions.length, fulfillments, represented, unresolved: version?.quantity != null ? Math.max(0, version.quantity - represented) : 0 };
  });
  return { requirements, familyId: program.familyId };
}
