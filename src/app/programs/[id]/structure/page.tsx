import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { ProgramDesigner, type DTerm } from "@/components/ProgramDesigner";
import { setProgramCalendarMode } from "@/lib/actions";
import { requirementLedger, supervisionBook, ruleBook, autoProposedRules, coursePoolRules } from "@/lib/requirementstore";
import { prisma } from "@/lib/db";
import { ExtractionReview } from "@/components/ExtractionReview";
import { listExtractions } from "@/lib/extractionactions";

export const dynamic = "force-dynamic";

// DESIGN & SEQUENCE — the program template: the design at a glance (sessions, shifts and hours
// by kind), then terms, courses, every class, lab and clinical session with its capacity and
// staffing. What the credentialing body requires of the clinicals lives under Clinical sites &
// requirements.
export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);
  // Structured requirements beside the structure (recommendation 1), the supervision rule each clinical session resolves to (5), and the settings the college knows (2).
  const [ledger, supervision, rules, assets, familySites] = await Promise.all([
    requirementLedger(program.id), supervisionBook([program.id]), ruleBook(program.institutionId),
    prisma.clinicalAsset.findMany({ where: { employer: { institutionId: program.institutionId }, status: { not: "archived" } }, select: { settingCode: true, learnersPerShift: true, employer: { select: { id: true, name: true, agreementStatus: true } } } }),
    program.familyId ? prisma.familySite.findMany({ where: { familyId: program.familyId }, select: { employerId: true, agreementStatus: true } }) : Promise.resolve([]),
  ]);
  // THE TAXONOMY, APPLIED AUTOMATICALLY: which of the college's sites carry each setting code (and the family's agreement with
  // each), so every clinical row can say which settings and sites it is eligible for; plus rotation wordings nobody has mapped,
  // tagged from the taxonomy as proposed rules for one-click keeping.
  const agreementOf = new Map(familySites.map((f) => [f.employerId, f.agreementStatus]));
  const supplyBySetting: Record<string, { employerId: string; name: string; assets: number; seats: number; agreement: string }[]> = {};
  for (const a of assets) {
    const list = supplyBySetting[a.settingCode] ?? (supplyBySetting[a.settingCode] = []);
    const site = list.find((x) => x.employerId === a.employer.id) ?? (list[list.push({ employerId: a.employer.id, name: a.employer.name, assets: 0, seats: 0, agreement: agreementOf.get(a.employer.id) ?? a.employer.agreementStatus ?? "none" }) - 1]);
    site.assets++; site.seats += a.learnersPerShift;
  }
  for (const l of Object.values(supplyBySetting)) l.sort((x, y) => (x.agreement === "secured" ? 0 : 1) - (y.agreement === "secured" ? 0 : 1) || y.seats - x.seats);
  const rotationTypesInUse = program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.filter((s) => s.kind === "CLINICAL" && s.rotationType).map((s) => s.rotationType!)));
  const auto = autoProposedRules(rules, rotationTypesInUse);
  const courseRules = await coursePoolRules([program.id]);
  const revisions = new Map((await prisma.supervisionRule.findMany({ where: { scope: "session", sessionId: { in: program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => s.id))) } }, select: { sessionId: true, revision: true } })).map((r) => [r.sessionId!, r.revision]));

  const terms: DTerm[] = program.terms.map((t) => ({
    id: t.id, name: t.name, index: t.index, semester: t.semester, startWeek: t.startWeek, endWeek: t.endWeek,
    courses: t.courses.map((c) => ({
      id: c.id, code: c.code, name: c.name, creditHours: c.creditHours,
      weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours,
      semesterOffered: c.semesterOffered, courseType: c.courseType, description: c.description, requisites: c.requisites,
      sessions: c.sessions.map((s) => ({
        id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", number: s.number, title: s.title,
        lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded, supportStaffNeeded: s.supportStaffNeeded,
        week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime, location: s.location,
        homework: s.homework, rotationType: s.rotationType, clinicalMode: s.clinicalMode, experiences: s.experiences, progression: s.progression,
        deliveryMode: s.deliveryMode, notes: s.notes,
        facultyContactPolicy: s.facultyContactPolicy, supportContactPolicy: s.supportContactPolicy, preceptorContactPolicy: s.preceptorContactPolicy,
        supervision: s.kind === "CLINICAL" && supervision.get(s.id) ? { ...supervision.get(s.id)!, revision: revisions.get(s.id) ?? 0, scope: "session" as const } : undefined,
      })),
    })),
  }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">The template every offering runs. Open a course to edit its sessions.</p>
        <form action={setProgramCalendarMode.bind(null, program.id)} className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Terms sit on the calendar</span>
          <select name="calendarMode" defaultValue={program.calendarMode} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" title="semester: each term ends with the college's semester. continuous: a continuing-education class runs its weeks straight from the day it starts, across semester boundaries.">
            <option value="semester">with the semester</option>
            <option value="continuous">straight through (continuing education)</option>
          </select>
          <button className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">Apply to planned offerings</button>
        </form>
      </div>
      <ProgramDesigner
        programId={program.id}
        programName={program.name}
        terms={terms}
        defaultEnrollment={defaultEnrollment}
        requirements={ledger.requirements}
        familyId={ledger.familyId}
        settings={[...rules.known].sort()}
        institutionId={program.institutionId}
        ruleRows={Object.fromEntries([
          ...rules.rows.map((r) => [r.rotationType.trim().toLowerCase(), { rotationType: r.rotationType, unitCategory: r.unitCategory, rule: rules.rules.get(r.rotationType.trim().toLowerCase()) ?? null, revision: r.revision, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null, sourceText: r.sourceText }] as const),
          ...auto.map((a) => [a.rotationType.toLowerCase(), { rotationType: a.rotationType, unitCategory: "Inpatient beds", rule: a.rule, revision: 0, reviewedBy: null, reviewedAt: null, sourceText: a.rotationType, auto: true }] as const),
        ])}
        supplyBySetting={supplyBySetting}
        courseRules={courseRules}
        extraction={<ExtractionReview target={{ kind: "program", programId: program.id, familyId: program.familyId }} jobs={await listExtractions({ kind: "program", programId: program.id })} title="Describe or upload the program's requirements" />}
        assumptions={{
          facContactHours: program.facContactHours, facWorkWeekHours: program.facWorkWeekHours, facTermWeeks: program.facTermWeeks,
          preContactHours: program.preContactHours, preWorkWeekHours: program.preWorkWeekHours, preTermWeeks: program.preTermWeeks,
        }}
      />

    </div>
  );
}
