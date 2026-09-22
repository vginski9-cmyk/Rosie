// BACKFILL — legacy rotation mappings, session staffing columns, site limits and course clinical hours into the
// structured, versioned records (recommendations 1, 2, 3, 5). Repeat-safe: every write is an upsert keyed on the
// legacy row, source strings and ids are preserved, and ambiguous wording becomes a REVIEW-NEEDED candidate — never
// a silently approved "or" / "and". Run with --dry-run to print the inventory and change nothing.
//
//   npx tsx scripts/backfill-requirements.ts --dry-run
//   npx tsx scripts/backfill-requirements.ts
//
// The seed calls the same function (prisma/seed.ts) so a fresh database carries the structured records from day one.

import { PrismaClient } from "@prisma/client";
import { ruleOfRow } from "../src/lib/requirementstore";
import { ruleSpecJson, eligibleSettings, KNOWN_SETTINGS } from "../src/lib/settingrule";
import { supervisionFromLegacy } from "../src/lib/supervision";

export interface BackfillReport {
  dryRun: boolean;
  rotations: { total: number; reviewedSingle: number; reviewNeeded: number; unmapped: number; alreadyStructured: number; examples: string[] };
  supervision: { sessions: number; reviewed: number; reviewNeeded: number; written: number };
  sites: { familySites: number; limitKnown: number; limitUnknown: number; availabilityInherited: number; assets: number };
  requirements: { courseHours: number; created: number; versions: number; fulfillments: number; setStandards: number; discrepancies: { course: string; area: string; required: number; represented: number }[] };
}

export async function backfillRequirements(prisma: PrismaClient, opts: { dryRun?: boolean; log?: (s: string) => void } = {}): Promise<BackfillReport> {
  const dry = !!opts.dryRun; const log = opts.log ?? (() => {});
  const report: BackfillReport = {
    dryRun: dry,
    rotations: { total: 0, reviewedSingle: 0, reviewNeeded: 0, unmapped: 0, alreadyStructured: 0, examples: [] },
    supervision: { sessions: 0, reviewed: 0, reviewNeeded: 0, written: 0 },
    sites: { familySites: 0, limitKnown: 0, limitUnknown: 0, availabilityInherited: 0, assets: 0 },
    requirements: { courseHours: 0, created: 0, versions: 0, fulfillments: 0, setStandards: 0, discrepancies: [] },
  };

  // 1. Rotation type → setting RULE. Single clear code → reviewed "only" (its existing evidence level); compound wording → proposed, needs review.
  const codes = new Set([...KNOWN_SETTINGS, ...(await prisma.clinicalAsset.findMany({ distinct: ["settingCode"], select: { settingCode: true } })).map((c) => c.settingCode)]);
  const rows = await prisma.rotationSetting.findMany();
  for (const r of rows) {
    report.rotations.total++;
    if (r.rule) { report.rotations.alreadyStructured++; continue; }
    const spec = ruleOfRow({ rotationType: r.rotationType, settingCode: r.settingCode, rule: null, sourceText: r.sourceText ?? r.rotationType, interpretationStatus: r.interpretationStatus }, codes);
    if (!spec) { report.rotations.unmapped++; continue; }
    if (spec.status === "reviewed") report.rotations.reviewedSingle++; else { report.rotations.reviewNeeded++; if (report.rotations.examples.length < 8) report.rotations.examples.push(`${r.rotationType} → ${eligibleSettings(spec.rule).join(" / ")} (${spec.rule.kind}, ${spec.status})`); }
    if (!dry) await prisma.rotationSetting.update({ where: { id: r.id }, data: { rule: ruleSpecJson(spec), sourceText: r.sourceText ?? r.rotationType, interpretationStatus: spec.status, settingCode: r.settingCode ?? eligibleSettings(spec.rule)[0] ?? null } });
  }

  // 2. Session staffing columns → an explicit supervision rule per clinical session (semantics unchanged; unknown modes flagged).
  const sessions = await prisma.session.findMany({ where: { kind: "CLINICAL" }, select: { id: true, clinicalMode: true, facultyNeeded: true, preceptorsNeeded: true, maxStudents: true, supervisionRules: { where: { scope: "session" }, select: { id: true, status: true } } } });
  for (const s of sessions) {
    report.supervision.sessions++;
    const spec = supervisionFromLegacy(s);
    if (spec.status === "reviewed") report.supervision.reviewed++; else report.supervision.reviewNeeded++;
    if (s.supervisionRules.length) continue; // a rule already exists (possibly reviewed by a person) — never overwritten
    report.supervision.written++;
    if (!dry) await prisma.supervisionRule.create({ data: { scope: "session", sessionId: s.id, spec: JSON.stringify(spec), authority: "planning", sourceText: s.clinicalMode, status: spec.status } });
  }

  // 3. Site limits and availability: a stated students-at-once is "known"; blank stays "unknown"; blank days / blocks were always "whenever the assets run" → inherit.
  const fs = await prisma.familySite.findMany({ select: { id: true, studentsAtOnce: true, studentsAtOnceMode: true, daysAllowed: true, blocksAllowed: true, availabilityMode: true } });
  for (const f of fs) {
    report.sites.familySites++;
    const limitMode = f.studentsAtOnce != null ? "known" : f.studentsAtOnceMode === "unrestricted" ? "unrestricted" : "unknown";
    if (limitMode === "known") report.sites.limitKnown++; else report.sites.limitUnknown++;
    const availabilityMode = f.availabilityMode === "unavailable" || f.availabilityMode === "unknown" ? f.availabilityMode : f.daysAllowed || f.blocksAllowed ? "specific" : "inherit";
    if (availabilityMode === "inherit") report.sites.availabilityInherited++;
    if (!dry && (limitMode !== f.studentsAtOnceMode || availabilityMode !== f.availabilityMode)) await prisma.familySite.update({ where: { id: f.id }, data: { studentsAtOnceMode: limitMode, availabilityMode } });
  }
  report.sites.assets = await prisma.clinicalAsset.count();

  // 4. Course clinical hours per service area → a course-scope requirement with a published v1 and fulfilment links to the
  //    course's clinical sessions whose rotation rule reaches the area's settings. The obligation is the hoursPerStudent,
  //    once; sessions ACCUMULATE toward it. A single-setting area is reviewed; a multi-setting area is "any of" needing review.
  const reqs = await prisma.courseClinicalRequirement.findMany({ include: { serviceArea: true, course: { select: { id: true, code: true, name: true, term: { select: { program: { select: { id: true, institutionId: true, familyId: true } } } }, sessions: { where: { kind: "CLINICAL" }, select: { id: true, lengthHours: true, rotationType: true } } } } } });
  const ruleByInst = new Map<string, Map<string, ReturnType<typeof ruleOfRow>>>();
  for (const r of rows) { const m = ruleByInst.get(r.institutionId) ?? new Map(); m.set(r.rotationType.trim().toLowerCase(), ruleOfRow({ ...r, sourceText: r.sourceText ?? r.rotationType }, codes)); ruleByInst.set(r.institutionId, m); }
  for (const cr of reqs) {
    report.requirements.courseHours++;
    const inst = cr.course.term.program.institutionId;
    const areaSettings = cr.serviceArea.settingCodes.split(",").map((x) => x.trim()).filter(Boolean);
    const key = `hours:${cr.serviceArea.code}`;
    const spec = areaSettings.length === 1
      ? { rule: { kind: "only" as const, setting: areaSettings[0] }, mixing: "allowed" as const, continuity: "unknown" as const, scope: "learner" as const, sourceText: cr.serviceArea.name, status: "reviewed" as const, questions: [] }
      : areaSettings.length > 1
        ? { rule: { kind: "any-of" as const, settings: areaSettings }, mixing: "unknown" as const, continuity: "unknown" as const, scope: "learner" as const, sourceText: cr.serviceArea.name, status: "needs-review" as const, questions: [`${cr.serviceArea.name} lists ${areaSettings.join(", ")}: are they alternatives, and may a learner's hours be split across them?`] }
        : null;
    // Sessions that fulfil it: the rotation rule reaches one of the area's settings. A session whose rule reaches
    // ONLY this course's area contributes its whole length; one that reaches several areas is linked with no amount —
    // how its hours divide is a fact a person must state, never an even split invented here.
    const rb = ruleByInst.get(inst) ?? new Map();
    const areasOfCourse = reqs.filter((x) => x.course.id === cr.course.id).map((x) => ({ code: x.serviceArea.code, settings: x.serviceArea.settingCodes.split(",").map((y) => y.trim()).filter(Boolean) }));
    const links = cr.course.sessions.flatMap((s) => {
      const rule = rb.get((s.rotationType ?? "").trim().toLowerCase()); if (!rule) return [];
      const reach = eligibleSettings(rule.rule);
      if (!reach.some((c) => areaSettings.includes(c))) return [];
      const areasReached = areasOfCourse.filter((a) => reach.some((c) => a.settings.includes(c)));
      return [{ ...s, amount: areasReached.length === 1 ? s.lengthHours ?? null : null, shared: areasReached.map((a) => a.code) }];
    });
    const represented = links.reduce((n, s) => n + (s.amount ?? 0), 0);
    // A legacy "0 hours" is not a stated minimum of zero: it is a quantity nobody has stated (missing ≠ zero). It is carried as
    // an unresolved quantity that needs review, never published as "0 hours, reviewed".
    const stated = cr.hoursPerStudent > 0 ? cr.hoursPerStudent : null;
    if (stated != null && Math.abs(represented - stated) > 0.01) report.requirements.discrepancies.push({ course: cr.course.code ?? cr.course.name, area: cr.serviceArea.code, required: stated, represented });
    if (dry) continue;
    let req = await prisma.clinicalRequirement.findFirst({ where: { courseId: cr.course.id, key } });
    if (!req) { req = await prisma.clinicalRequirement.create({ data: { institutionId: inst, scope: "course", courseId: cr.course.id, programId: cr.course.term.program.id, familyId: cr.course.term.program.familyId, key, label: stated != null ? `${cr.serviceArea.name} — ${stated} hours per learner` : `${cr.serviceArea.name} — hours per learner not stated` } }); report.requirements.created++; }
    const has = await prisma.requirementVersion.findFirst({ where: { requirementId: req.id } });
    let versionId = has?.id ?? null;
    if (!has) {
      const zeroNote = stated == null ? "The course record shows 0 hours for this area — confirm whether that means no requirement here or an unstated minimum." : null;
      // A stated quantity is published as v1 (approved for planning here, not regulatory approval); an unstated one stays a draft
      // — a published requirement needs a quantity, and only a person can supply it.
      const v = await prisma.requirementVersion.create({ data: { requirementId: req.id, version: 1, status: stated == null ? "draft" : "published", quantity: stated, unit: "hours", basis: "per-learner", settingRule: spec ? ruleSpecJson(spec) : null, sourceText: `${cr.serviceArea.name}: ${cr.hoursPerStudent} hours per student (course clinical requirement)`, sourceRef: JSON.stringify({ kind: "legacy", model: "CourseClinicalRequirement", id: cr.id }), sourceAuthority: "unknown", interpretationStatus: stated == null ? "needs-review" : spec?.status ?? "needs-review", publishedAt: stated == null ? null : new Date(), publishedBy: stated == null ? null : "backfill", notes: [cr.notes, zeroNote].filter(Boolean).join(" ") || null } });
      versionId = v.id; report.requirements.versions++;
    }
    const existing = new Set((await prisma.requirementFulfillment.findMany({ where: { requirementId: req.id }, select: { sessionId: true } })).map((f) => f.sessionId));
    for (const s of links) { if (existing.has(s.id)) continue; await prisma.requirementFulfillment.create({ data: { requirementId: req.id, versionId, sessionId: s.id, amount: s.amount, note: s.amount == null ? `backfill: the session's rotation reaches ${s.shared.join(", ")} — how its hours divide is not yet stated` : "backfill: the session's rotation reaches only this area" } }); report.requirements.fulfillments++; }
  }

  // 5. Credentialing sets → a family-scope standard per set (competencies / cases), capabilities = the items. Shared, referenced, never duplicated per program.
  const sets = await prisma.clinicalRequirementSet.findMany({ include: { items: { orderBy: { sortOrder: "asc" } }, family: { select: { id: true, institutionId: true } } } });
  for (const set of sets) {
    report.requirements.setStandards++;
    if (dry) continue;
    const key = `standard:${set.id}`;
    let req = await prisma.clinicalRequirement.findFirst({ where: { familyId: set.family.id, key } });
    if (!req) { req = await prisma.clinicalRequirement.create({ data: { institutionId: set.family.institutionId, scope: "family", familyId: set.family.id, key, label: `${set.name} (${set.authority})` } }); report.requirements.created++; }
    if (!(await prisma.requirementVersion.findFirst({ where: { requirementId: req.id } }))) {
      const unit = set.kind === "cases" ? "cases" : set.kind === "hours" ? "hours" : "competencies";
      const quantity = set.kind === "cases" ? set.items.reduce((n, i) => n + (i.minCount ?? 0), 0) : set.items.filter((i) => i.mandatory).length;
      await prisma.requirementVersion.create({ data: { requirementId: req.id, version: 1, status: "published", quantity: quantity || null, unit, basis: "per-learner", capabilities: JSON.stringify(set.items.map((i) => ({ kind: "experience", code: i.id, label: `${i.category} · ${i.name}`, required: i.mandatory, minCount: i.minCount, role: i.role, settings: i.settingCodes.split(",").map((x) => x.trim()).filter(Boolean) }))), sourceText: set.summary ?? set.name, sourceRef: JSON.stringify({ kind: "legacy", model: "ClinicalRequirementSet", id: set.id, edition: set.edition, url: set.sourceUrl }), sourceAuthority: set.verified ? "official" : "unofficial", interpretationStatus: set.verified ? "reviewed" : "needs-review", reviewedBy: set.verifiedBy, reviewedAt: set.verifiedAt, publishedAt: new Date(), publishedBy: "backfill" } });
      report.requirements.versions++;
    }
  }
  log(JSON.stringify(report, null, 1));
  return report;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  backfillRequirements(prisma, { dryRun: process.argv.includes("--dry-run"), log: console.log }).then(async () => { await prisma.$disconnect(); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
