"use server";

// SERVER ACTIONS for structured requirements, setting rules, supervision rules and site capabilities
// (recommendations 1, 2, 3, 5). Every write validates on the server (the browser only previews), checks
// that the referenced rows belong to the caller's scope, refuses a stale revision so a reviewed
// interpretation is never silently overwritten, and leaves an audit record. A published requirement
// version is immutable: a change is a new version. Nothing here marks anything "approved by the
// regulator": review records that a person confirmed an interpretation, no more.

import { prisma } from "./db";
import { revalidatePath } from "next/cache";
import { validateSettingRule, eligibleSettings, unresolvedQuantities, ruleSpecJson, parseRuleSpec, KNOWN_SETTINGS, type SettingRule, type SettingRuleSpec, type Mixing, type Continuity, type RuleScope } from "./settingrule";
import { type SupervisionSpec, type RoleRequirement, type SupervisionMode } from "./supervision";
import { auditChange } from "./changesets";

const str = (v: FormDataEntryValue | null) => (v == null ? "" : String(v).trim());
const optNum = (v: FormDataEntryValue | null): number | null => { const s = str(v); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const optDate = (v: FormDataEntryValue | null): Date | null => { const s = str(v); return s ? new Date(s + (s.length === 10 ? "T00:00:00Z" : "")) : null; };
const json = <T,>(v: FormDataEntryValue | null): T | null => { const s = str(v); if (!s) return null; try { return JSON.parse(s) as T; } catch { return null; } };

export interface ActionResult { ok: boolean; errors: string[]; id?: string }
const fail = (...errors: string[]): ActionResult => ({ ok: false, errors });

const revalidateRules = (institutionId: string) => { revalidatePath("/insights/clinical-sites"); revalidatePath("/scheduler"); revalidatePath("/programs/[id]/structure", "page"); revalidatePath("/families/[id]/clinical", "page"); void institutionId; };

/** The settings an institution knows: the presets plus every setting its assets carry. */
async function knownSettings(institutionId: string): Promise<Set<string>> {
  const codes = await prisma.clinicalAsset.findMany({ where: { employer: { institutionId }, status: { not: "archived" } }, distinct: ["settingCode"], select: { settingCode: true } });
  return new Set([...KNOWN_SETTINGS, ...codes.map((c) => c.settingCode)]);
}

/** Build a rule spec from form fields and validate it. `rule` is the JSON the editor produced (a bounded structure, never an expression). */
function ruleSpecFrom(formData: FormData, known: Set<string>, total: number | null): { spec: SettingRuleSpec | null; errors: string[] } {
  const rule = json<SettingRule>(formData.get("rule"));
  if (!rule) return { spec: null, errors: ["no rule given"] };
  const errs = validateSettingRule(rule, known, total);
  if (errs.length) return { spec: null, errors: errs.map((e) => `${e.path ? e.path + ": " : ""}${e.message}`) };
  const mixing = str(formData.get("mixing")); const continuity = str(formData.get("continuity")); const scope = str(formData.get("scope"));
  const decision = str(formData.get("decision"));
  const questions = (json<string[]>(formData.get("questions")) ?? []).filter((q) => typeof q === "string");
  const spec: SettingRuleSpec = {
    rule, mixing: (["allowed", "forbidden", "unknown"] as Mixing[]).includes(mixing as Mixing) ? (mixing as Mixing) : "unknown",
    continuity: (["one-site", "none", "unknown"] as Continuity[]).includes(continuity as Continuity) ? (continuity as Continuity) : "unknown",
    scope: (["learner", "group", "rotation", "session", "offering"] as RuleScope[]).includes(scope as RuleScope) ? (scope as RuleScope) : "learner",
    sourceText: str(formData.get("sourceText")) || null, status: decision === "review" ? "reviewed" : "needs-review", questions,
  };
  const errors: string[] = [];
  if (decision === "review") {
    if (!str(formData.get("reviewedBy"))) errors.push("a reviewer's name is required to mark an interpretation reviewed");
    const un = unresolvedQuantities(rule); if (un.length) errors.push(`cannot review with open quantities: ${un.join("; ")}`);
    const alternatives = rule.kind === "any-of" || rule.kind === "pool" || rule.kind === "n-of";
    if (alternatives && spec.mixing === "unknown") errors.push("say whether a learner's hours may be split across the eligible settings before marking the rule reviewed");
  }
  return { spec, errors };
}

// ── Rotation type → setting rule ─────────────────────────────────────────────────────────────────
/** Save (and optionally review) the setting rule for one rotation type of an institution. Refuses a stale revision. */
export async function saveRotationRule(institutionId: string, formData: FormData): Promise<ActionResult> {
  const rotationType = str(formData.get("rotationType"));
  if (!rotationType) return fail("rotation type required");
  const known = await knownSettings(institutionId);
  const { spec, errors } = ruleSpecFrom(formData, known, null);
  if (!spec || errors.length) return fail(...errors);
  const existing = await prisma.rotationSetting.findUnique({ where: { institutionId_rotationType: { institutionId, rotationType } } });
  const expected = optNum(formData.get("expectedRevision"));
  if (existing && expected != null && existing.revision !== expected) return fail(`this rule changed while you were editing it (revision ${existing.revision}, you had ${expected}) — reload and look again before saving`);
  const reviewedBy = spec.status === "reviewed" ? str(formData.get("reviewedBy")) : null;
  const data = { rule: ruleSpecJson(spec), sourceText: spec.sourceText ?? rotationType, interpretationStatus: spec.status, reviewedBy, reviewedAt: reviewedBy ? new Date() : null, settingCode: eligibleSettings(spec.rule)[0] ?? null, revision: (existing?.revision ?? 0) + 1, unitCategory: str(formData.get("unitCategory")) || existing?.unitCategory || "Inpatient beds" };
  const row = existing ? await prisma.rotationSetting.update({ where: { id: existing.id }, data }) : await prisma.rotationSetting.create({ data: { institutionId, rotationType, ...data } });
  await auditChange({ kind: "rule-review", label: `${spec.status === "reviewed" ? "Reviewed" : "Saved"} setting rule for "${rotationType}"`, institutionId, summary: { created: {}, changed: { "rotation rule": 1 }, removed: {}, notes: [`rule: ${JSON.stringify(spec.rule)}`, `mixing ${spec.mixing} · continuity ${spec.continuity}`, ...(reviewedBy ? [`reviewed by ${reviewedBy}`] : [])] } });
  revalidateRules(institutionId);
  return { ok: true, errors: [], id: row.id };
}

// ── Requirements and versions ─────────────────────────────────────────────────────────────────────
export interface RequirementTarget { scope: "family" | "program" | "course" | "session"; familyId?: string | null; programId?: string | null; courseId?: string | null; sessionId?: string | null }
/** The institution, program and family a target belongs to — and that every id named is consistent (no cross-scope references). */
async function resolveTarget(t: RequirementTarget): Promise<{ institutionId: string; familyId: string | null; programId: string | null; courseId: string | null; sessionId: string | null } | null> {
  if (t.scope === "session" && t.sessionId) { const s = await prisma.session.findUnique({ where: { id: t.sessionId }, select: { id: true, course: { select: { id: true, term: { select: { program: { select: { id: true, institutionId: true, familyId: true } } } } } } } }); return s ? { institutionId: s.course.term.program.institutionId, familyId: s.course.term.program.familyId, programId: s.course.term.program.id, courseId: s.course.id, sessionId: s.id } : null; }
  if (t.scope === "course" && t.courseId) { const c = await prisma.course.findUnique({ where: { id: t.courseId }, select: { id: true, term: { select: { program: { select: { id: true, institutionId: true, familyId: true } } } } } }); return c ? { institutionId: c.term.program.institutionId, familyId: c.term.program.familyId, programId: c.term.program.id, courseId: c.id, sessionId: null } : null; }
  if (t.scope === "program" && t.programId) { const p = await prisma.program.findUnique({ where: { id: t.programId }, select: { id: true, institutionId: true, familyId: true } }); return p ? { institutionId: p.institutionId, familyId: p.familyId, programId: p.id, courseId: null, sessionId: null } : null; }
  if (t.scope === "family" && t.familyId) { const f = await prisma.programFamily.findUnique({ where: { id: t.familyId }, select: { id: true, institutionId: true } }); return f ? { institutionId: f.institutionId, familyId: f.id, programId: null, courseId: null, sessionId: null } : null; }
  return null;
}

/** Create a requirement with a draft version, or update an existing DRAFT version (a published one is immutable). */
export async function saveRequirementDraft(target: RequirementTarget, formData: FormData): Promise<ActionResult> {
  const scope = await resolveTarget(target);
  if (!scope) return fail("the requirement's scope does not exist or the ids do not belong together");
  const label = str(formData.get("label")); if (!label) return fail("a label is required");
  const key = (str(formData.get("key")) || label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "requirement";
  const quantity = optNum(formData.get("quantity")); if (quantity != null && quantity < 0) return fail("a quantity is zero or more");
  const unit = str(formData.get("unit")) || "hours"; if (!["hours", "shifts", "cases", "competencies", "exposures"].includes(unit)) return fail("unsupported unit");
  const basis = str(formData.get("basis")) || "per-learner"; if (!["per-learner", "per-group", "per-session", "per-offering"].includes(basis)) return fail("unsupported basis");
  const known = await knownSettings(scope.institutionId);
  let settingRule: string | null = null; let interpretationStatus = "needs-review";
  if (str(formData.get("rule"))) { const { spec, errors } = ruleSpecFrom(formData, known, quantity); if (!spec || errors.length) return fail(...errors); settingRule = ruleSpecJson(spec); interpretationStatus = spec.status; }
  const supervision = json<SupervisionSpec>(formData.get("supervision"));
  const capabilities = json<unknown[]>(formData.get("capabilities")) ?? [];
  if (!Array.isArray(capabilities)) return fail("capabilities must be a list");
  const sourceAuthority = str(formData.get("sourceAuthority")); if (sourceAuthority && !["unknown", "unofficial", "official"].includes(sourceAuthority)) return fail("unsupported source authority");
  const versionId = str(formData.get("versionId"));
  const requirementId = str(formData.get("requirementId"));
  const data = { quantity, unit, basis, settingRule, capabilities: JSON.stringify(capabilities), supervision: supervision ? JSON.stringify(supervision) : null, timing: str(formData.get("timing")) || null, sourceText: str(formData.get("sourceText")) || null, sourceRef: str(formData.get("sourceRef")) || null, sourceAuthority: sourceAuthority || "unknown", interpretationStatus, notes: str(formData.get("notes")) || null };
  if (versionId) {
    const v = await prisma.requirementVersion.findUnique({ where: { id: versionId }, include: { requirement: true } });
    if (!v || v.requirement.institutionId !== scope.institutionId) return fail("version not found in this scope");
    if (v.status !== "draft") return fail(`version ${v.version} is ${v.status} and cannot be edited — create a new draft version instead`);
    const expected = str(formData.get("expectedUpdatedAt"));
    if (expected && v.updatedAt.toISOString() !== expected) return fail("this draft changed while you were editing it — reload and merge your change");
    await prisma.requirementVersion.update({ where: { id: v.id }, data });
    await prisma.clinicalRequirement.update({ where: { id: v.requirementId }, data: { label } });
    revalidateRules(scope.institutionId);
    return { ok: true, errors: [], id: v.id };
  }
  let req = requirementId ? await prisma.clinicalRequirement.findUnique({ where: { id: requirementId } }) : null;
  if (requirementId && (!req || req.institutionId !== scope.institutionId)) return fail("requirement not found in this scope");
  if (!req) req = await prisma.clinicalRequirement.create({ data: { institutionId: scope.institutionId, scope: target.scope, familyId: scope.familyId, programId: scope.programId, courseId: scope.courseId, sessionId: scope.sessionId, key, label, parentId: str(formData.get("parentId")) || null } });
  else if (await prisma.requirementVersion.findFirst({ where: { requirementId: req.id, status: "draft" } })) return fail("this requirement already has a draft version — edit that one");
  const last = await prisma.requirementVersion.aggregate({ where: { requirementId: req.id }, _max: { version: true } });
  const v = await prisma.requirementVersion.create({ data: { requirementId: req.id, version: (last._max.version ?? 0) + 1, status: "draft", ...data } });
  revalidateRules(scope.institutionId);
  return { ok: true, errors: [], id: v.id };
}

/** Publish a draft version: valid structure, a reviewed interpretation and a named reviewer; the previous published version is retired. Immutable from then on. */
export async function publishRequirementVersion(versionId: string, formData: FormData): Promise<ActionResult> {
  const v = await prisma.requirementVersion.findUnique({ where: { id: versionId }, include: { requirement: true } });
  if (!v) return fail("version not found");
  if (v.status !== "draft") return fail(`version ${v.version} is already ${v.status}`);
  const expected = str(formData.get("expectedUpdatedAt"));
  if (expected && v.updatedAt.toISOString() !== expected) return fail("this draft changed since you opened it — reload before publishing");
  const reviewedBy = str(formData.get("reviewedBy")); if (!reviewedBy) return fail("a reviewer's name is required to publish");
  const errors: string[] = [];
  const caps = (() => { try { return JSON.parse(v.capabilities) as unknown[]; } catch { return []; } })();
  if ((v.quantity == null || v.quantity <= 0) && !caps.length) errors.push("a published requirement needs a quantity or at least one required capability");
  const spec = parseRuleSpec(v.settingRule);
  if (spec) {
    const errs = validateSettingRule(spec.rule, await knownSettings(v.requirement.institutionId), v.quantity); if (errs.length) errors.push(...errs.map((e) => e.message));
    const un = unresolvedQuantities(spec.rule); if (un.length) errors.push(`open quantities: ${un.join("; ")}`);
    if (spec.status !== "reviewed") errors.push("the setting rule's interpretation must be reviewed before publishing");
  }
  if (errors.length) return fail(...errors);
  const now = new Date();
  await prisma.$transaction([
    prisma.requirementVersion.updateMany({ where: { requirementId: v.requirementId, status: "published" }, data: { status: "retired", effectiveTo: now } }),
    prisma.requirementVersion.update({ where: { id: v.id }, data: { status: "published", publishedAt: now, publishedBy: reviewedBy, reviewedBy, reviewedAt: now, interpretationStatus: "reviewed", effectiveFrom: v.effectiveFrom ?? now } }),
  ]);
  await auditChange({ kind: "requirement-publish", label: `Published ${v.requirement.label} v${v.version}`, institutionId: v.requirement.institutionId, summary: { created: { "requirement version": 1 }, changed: {}, removed: {}, notes: [`reviewed by ${reviewedBy}`, `source authority: ${v.sourceAuthority}`] } });
  revalidateRules(v.requirement.institutionId);
  return { ok: true, errors: [], id: v.id };
}

export async function retireRequirementVersion(versionId: string): Promise<ActionResult> {
  const v = await prisma.requirementVersion.findUnique({ where: { id: versionId }, include: { requirement: true } });
  if (!v) return fail("version not found");
  await prisma.requirementVersion.update({ where: { id: v.id }, data: { status: "retired", effectiveTo: new Date() } });
  revalidateRules(v.requirement.institutionId);
  return { ok: true, errors: [] };
}

/** Link a session (or course) to a requirement with the amount it contributes per learner. The obligation is never multiplied by the link count. */
export async function linkRequirementFulfillment(requirementId: string, formData: FormData): Promise<ActionResult> {
  const req = await prisma.clinicalRequirement.findUnique({ where: { id: requirementId }, include: { versions: { where: { status: "published" }, take: 1 } } });
  if (!req) return fail("requirement not found");
  const sessionId = str(formData.get("sessionId")) || null, courseId = str(formData.get("courseId")) || null;
  if (!sessionId && !courseId) return fail("a session or course is required");
  if (sessionId) { const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { course: { select: { term: { select: { program: { select: { institutionId: true } } } } } } } }); if (!s || s.course.term.program.institutionId !== req.institutionId) return fail("session not in this institution"); }
  if (courseId) { const c = await prisma.course.findUnique({ where: { id: courseId }, select: { term: { select: { program: { select: { institutionId: true } } } } } }); if (!c || c.term.program.institutionId !== req.institutionId) return fail("course not in this institution"); }
  const amount = optNum(formData.get("amount")); if (amount != null && amount < 0) return fail("an amount is zero or more");
  const dup = await prisma.requirementFulfillment.findFirst({ where: { requirementId, sessionId, courseId } });
  if (dup) await prisma.requirementFulfillment.update({ where: { id: dup.id }, data: { amount, note: str(formData.get("note")) || null } });
  else await prisma.requirementFulfillment.create({ data: { requirementId, versionId: req.versions[0]?.id ?? null, sessionId, courseId, amount, note: str(formData.get("note")) || null } });
  revalidateRules(req.institutionId);
  return { ok: true, errors: [] };
}
export async function unlinkRequirementFulfillment(id: string): Promise<ActionResult> {
  const f = await prisma.requirementFulfillment.findUnique({ where: { id }, include: { requirement: true } });
  if (!f) return fail("link not found");
  await prisma.requirementFulfillment.delete({ where: { id } });
  revalidateRules(f.requirement.institutionId);
  return { ok: true, errors: [] };
}

// ── Supervision rules ─────────────────────────────────────────────────────────────────────────────
/** Build a supervision spec from the conditional form (mode → roles) and validate it. */
function supervisionFrom(formData: FormData): { spec: SupervisionSpec | null; errors: string[] } {
  const mode = str(formData.get("mode")) as SupervisionMode;
  if (!["instructor-led", "preceptor-led", "combined", "unknown"].includes(mode)) return { spec: null, errors: ["unsupported supervision mode"] };
  const errors: string[] = []; const questions: string[] = [];
  const role = (r: "instructor" | "preceptor"): RoleRequirement => {
    const required = mode === "combined" || (mode === "instructor-led" && r === "instructor") || (mode === "preceptor-led" && r === "preceptor") || formData.get(`${r}_required`) != null;
    const staffPerGroup = optNum(formData.get(`${r}_staffPerGroup`)), maxLearnersPerStaff = optNum(formData.get(`${r}_maxLearnersPerStaff`));
    if (staffPerGroup != null && staffPerGroup <= 0) errors.push(`${r}: people per group is more than zero`);
    if (maxLearnersPerStaff != null && maxLearnersPerStaff <= 0) errors.push(`${r}: learners per person is more than zero`);
    if (required && staffPerGroup == null && maxLearnersPerStaff == null) questions.push(`${r === "instructor" ? "Instructors" : "Preceptors"} are required but no count or ratio is on record — what is the policy?`);
    const presence = str(formData.get(`${r}_presence`));
    return { role: r, responsibleOrg: r === "instructor" ? "college" : "site", required, staffPerGroup, maxLearnersPerStaff, namedAssignmentRequired: required && formData.get(`${r}_namedNotRequired`) == null, presence: presence === "continuous" || presence === "intermittent" ? presence : "unknown", qualifications: str(formData.get(`${r}_qualifications`)) || null, validFrom: str(formData.get(`${r}_validFrom`)) || null, validTo: str(formData.get(`${r}_validTo`)) || null, source: str(formData.get("sourceText")) || null, status: required && staffPerGroup == null && maxLearnersPerStaff == null ? "needs-review" : "reviewed", note: null };
  };
  const roles = [role("instructor"), role("preceptor")];
  if (mode === "unknown") questions.push("Is this session instructor-led, preceptor-led or both?");
  const decision = str(formData.get("decision"));
  if (decision === "review" && questions.length) errors.push(`cannot mark reviewed with open questions: ${questions.join(" ")}`);
  if (decision === "review" && !str(formData.get("reviewedBy"))) errors.push("a reviewer's name is required");
  return { spec: { mode, roles, sourceText: str(formData.get("sourceText")) || null, status: decision === "review" && !questions.length ? "reviewed" : "needs-review", questions }, errors };
}
/** Save a supervision rule at a scope. Refuses a stale revision; a planning rule may never relax a mandatory one above it (that conflict is reported, not saved). */
export async function saveSupervisionRule(target: RequirementTarget, formData: FormData): Promise<ActionResult> {
  const scope = await resolveTarget(target);
  if (!scope) return fail("scope not found");
  const { spec, errors } = supervisionFrom(formData);
  if (!spec || errors.length) return fail(...errors);
  const authority = str(formData.get("authority")) === "mandatory" ? "mandatory" : "planning";
  const where = { scope: target.scope, familyId: scope.familyId ?? undefined, programId: scope.programId ?? undefined, courseId: scope.courseId ?? undefined, sessionId: scope.sessionId ?? undefined } as const;
  const key = target.scope === "session" ? { sessionId: scope.sessionId } : target.scope === "course" ? { courseId: scope.courseId } : target.scope === "program" ? { programId: scope.programId } : { familyId: scope.familyId };
  const existing = await prisma.supervisionRule.findFirst({ where: { scope: target.scope, ...key } });
  const expected = optNum(formData.get("expectedRevision"));
  if (existing && expected != null && existing.revision !== expected) return fail("this rule changed while you were editing it — reload before saving");
  // Mandatory rules above this scope that this planning rule would relax.
  if (authority === "planning") {
    const above = await prisma.supervisionRule.findMany({ where: { authority: "mandatory", OR: [{ familyId: scope.familyId ?? "-" }, { programId: scope.programId ?? "-" }, { courseId: scope.courseId ?? "-" }] } });
    for (const a of above) { try { const as = JSON.parse(a.spec) as SupervisionSpec; const dropped = as.roles.filter((r) => r.required && !spec.roles.some((x) => x.role === r.role && x.required)); if (dropped.length) return fail(`a ${a.scope}-level mandatory rule requires ${dropped.map((r) => r.role).join(" and ")}; a planning rule cannot relax it`); } catch { /* unreadable rule ignored */ } }
  }
  const reviewedBy = spec.status === "reviewed" ? str(formData.get("reviewedBy")) : null;
  const data = { spec: JSON.stringify(spec), authority, sourceText: spec.sourceText, sourceRef: str(formData.get("sourceRef")) || null, status: spec.status, reviewedBy, reviewedAt: reviewedBy ? new Date() : null, validFrom: optDate(formData.get("validFrom")), validTo: optDate(formData.get("validTo")), revision: (existing?.revision ?? 0) + 1 };
  void where;
  const row = existing ? await prisma.supervisionRule.update({ where: { id: existing.id }, data }) : await prisma.supervisionRule.create({ data: { scope: target.scope, familyId: target.scope === "family" ? scope.familyId : null, programId: target.scope === "program" ? scope.programId : null, courseId: target.scope === "course" ? scope.courseId : null, sessionId: target.scope === "session" ? scope.sessionId : null, ...data } });
  await auditChange({ kind: "supervision-rule", label: `${spec.status === "reviewed" ? "Reviewed" : "Saved"} supervision rule (${target.scope}: ${spec.mode})`, institutionId: scope.institutionId, summary: { created: {}, changed: { "supervision rule": 1 }, removed: {}, notes: spec.roles.filter((r) => r.required).map((r) => `${r.role}: ${r.staffPerGroup != null ? `${r.staffPerGroup} per group` : r.maxLearnersPerStaff != null ? `1 per ${r.maxLearnersPerStaff} learners` : "policy missing"}`) } });
  revalidateRules(scope.institutionId);
  return { ok: true, errors: [], id: row.id };
}

// ── Site capabilities, limits and availability ───────────────────────────────────────────────────
export async function saveSiteCapability(employerId: string, formData: FormData): Promise<ActionResult> {
  const e = await prisma.employer.findUnique({ where: { id: employerId }, select: { id: true, institutionId: true } });
  if (!e) return fail("site not found");
  const kind = str(formData.get("kind")); if (!["population", "procedure", "modality", "experience"].includes(kind)) return fail("unsupported capability kind");
  const label = str(formData.get("label")); if (!label) return fail("a label is required");
  const status = str(formData.get("status")) || "unknown"; if (!["supported", "limited", "unsupported", "unknown"].includes(status)) return fail("unsupported status");
  const assetId = str(formData.get("assetId")) || null;
  if (assetId) { const a = await prisma.clinicalAsset.findUnique({ where: { id: assetId }, select: { employerId: true } }); if (!a || a.employerId !== employerId) return fail("the asset is not at this site"); }
  const capacityValue = optNum(formData.get("capacityValue")); if (capacityValue != null && capacityValue < 0) return fail("capacity is zero or more");
  const capacityUnit = str(formData.get("capacityUnit")) || null; if (capacityValue != null && !capacityUnit) return fail("say what the capacity number counts (cases per year, learners at once …)");
  const data = { assetId, settingCode: str(formData.get("settingCode")).toUpperCase() || null, kind, code: (str(formData.get("code")) || label).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40), label, status, capacityValue, capacityUnit, learnerTypes: str(formData.get("learnerTypes")) || null, restrictions: str(formData.get("restrictions")) || null, supervisionNote: str(formData.get("supervisionNote")) || null, validFrom: optDate(formData.get("validFrom")), validTo: optDate(formData.get("validTo")), evidenceSource: str(formData.get("evidenceSource")) || null, evidenceOwner: str(formData.get("evidenceOwner")) || null, verifiedAt: optDate(formData.get("verifiedAt")), reviewBy: optDate(formData.get("reviewBy")), notes: str(formData.get("notes")) || null };
  const id = str(formData.get("id"));
  const row = id ? await prisma.siteCapability.update({ where: { id }, data }) : await prisma.siteCapability.create({ data: { employerId, ...data } });
  revalidatePath(`/employers/${employerId}`); revalidatePath("/families/[id]/clinical/sites/[employerId]", "page");
  return { ok: true, errors: [], id: row.id };
}
export async function deleteSiteCapability(id: string, employerId: string): Promise<void> {
  await prisma.siteCapability.deleteMany({ where: { id, employerId } });
  revalidatePath(`/employers/${employerId}`);
}

/** An asset's learner limit and availability MODES, learner types, restrictions and educational capabilities — the fields that say what a number means. */
export async function updateAssetLimits(assetId: string, formData: FormData): Promise<ActionResult> {
  const a = await prisma.clinicalAsset.findUnique({ where: { id: assetId }, select: { id: true, employerId: true } });
  if (!a) return fail("asset not found");
  const limitMode = str(formData.get("limitMode")) || "known"; if (!["known", "unrestricted", "unknown"].includes(limitMode)) return fail("unsupported limit mode");
  const availabilityMode = str(formData.get("availabilityMode")) || "specific"; if (!["specific", "unavailable", "unknown"].includes(availabilityMode)) return fail("unsupported availability mode");
  const learners = optNum(formData.get("learnersPerShift"));
  if (limitMode === "known" && (learners == null || learners < 0)) return fail("a known limit needs a number of learners per shift (zero or more)");
  const capabilities = json<unknown[]>(formData.get("capabilities")) ?? [];
  await prisma.clinicalAsset.update({ where: { id: assetId }, data: { limitMode, availabilityMode, learnersPerShift: limitMode === "known" ? Math.round(learners as number) : 0, dataSource: limitMode === "unknown" ? "GAP" : str(formData.get("dataSource")) === "VERIFIED" ? "VERIFIED" : "ESTIMATE", timezone: str(formData.get("timezone")) || null, learnerTypes: str(formData.get("learnerTypes")) || null, restrictions: str(formData.get("restrictions")) || null, capabilities: JSON.stringify(Array.isArray(capabilities) ? capabilities : []), evidenceSource: str(formData.get("evidenceSource")) || null, evidenceOwner: str(formData.get("evidenceOwner")) || null, verifiedAt: optDate(formData.get("verifiedAt")), reviewBy: optDate(formData.get("reviewBy")) } });
  revalidatePath(`/employers/${a.employerId}`); revalidatePath("/families/[id]/clinical/sites/[employerId]", "page"); revalidatePath("/insights/clinical-sites");
  return { ok: true, errors: [] };
}
