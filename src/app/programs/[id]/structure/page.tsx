import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull, getProgramRequirementCoverage } from "@/lib/queries";
import { ProgramDesigner, type DTerm } from "@/components/ProgramDesigner";
import { ClinicalRequirementsGrid } from "@/components/ClinicalRequirementsGrid";
import { RequirementRollup } from "@/components/RequirementRollup";

export const dynamic = "force-dynamic";

export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const reqCov = await getProgramRequirementCoverage(params.id);
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);

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
        homework: s.homework, rotationType: s.rotationType, clinicalMode: s.clinicalMode,
        deliveryMode: s.deliveryMode, notes: s.notes,
        facultyContactPolicy: s.facultyContactPolicy, supportContactPolicy: s.supportContactPolicy, preceptorContactPolicy: s.preceptorContactPolicy,
      })),
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Program &amp; course design</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The <strong>timeless template</strong>, laid out like the capacity workbook&apos;s Raw Data &amp; Calculations sheet:
          every class, lab, and clinical session of every course as one row — blue cells are editable inputs, green cells
          are the live formulas (sections = ROUNDUP(enrollment ÷ capacity), space hours, faculty &amp; preceptor contact
          hours, semesterly and weekly conversions). Change any input, or run a test enrollment through the slider, and
          the whole chain recalculates — then waterfalls into <strong>Instructors &amp; preceptors needed</strong>,
          <strong> Clinical sites</strong>, and <strong>Daily coverage</strong> under Insights.
          No instructors or students — those live on a <Link href={`/programs/${program.id}`} className="text-rose-700 hover:underline">scheduled offering</Link>.
          Use the sticky bar to jump between terms, collapse what you&apos;re not editing, or open <strong>⇄ Re-sequence</strong> to drag courses across terms.
        </p>
      </div>

      <ProgramDesigner
        programId={program.id}
        programName={program.name}
        terms={terms}
        defaultEnrollment={defaultEnrollment}
        assumptions={{
          facContactHours: program.facContactHours, facWorkWeekHours: program.facWorkWeekHours, facTermWeeks: program.facTermWeeks,
          preContactHours: program.preContactHours, preWorkWeekHours: program.preWorkWeekHours, preTermWeeks: program.preTermWeeks,
        }}
      />

      {reqCov && (
        <section id="requirements" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">How the clinical sequence rolls up to what completion requires <span className="text-sm font-normal text-slate-400">— {reqCov.sets.map((x) => x.authority.split(" · ")[0]).join(" · ")} for every {reqCov.family.name} graduate, course by course</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">Each clinical course puts students in certain settings for certain hours or cases; each experience on the credentialing body&apos;s list can only be had in certain settings. So the sequence, in order, decides which experiences first become reachable when, what is reachable in total by the end of each course, and whether the whole thing can ever satisfy the list. Set a target per rule by the end of each course (or let it pace evenly); every student&apos;s log is then measured against those targets on their page and on the offering.</p>
          </div>
          <RequirementRollup cov={reqCov} />
        </section>
      )}

      {program.family && (
        <ClinicalRequirementsGrid
          programName={program.name}
          family={{ id: program.family.id, name: program.family.name, clinicalModel: program.family.clinicalModel, clinicalNotes: program.family.clinicalNotes }}
          areas={program.family.serviceAreas.map((a) => ({
            id: a.id, code: a.code, name: a.name, notes: a.notes,
            settingCodes: a.settingCodes.split(",").map((s) => s.trim()).filter(Boolean),
            unitCategories: a.unitCategories.split(",").map((s) => s.trim()).filter(Boolean),
          }))}
          courses={program.terms.flatMap((t) => t.courses.map((c) => ({
            id: c.id, code: c.code, name: c.name, termName: t.name, termIndex: t.index,
            weeks: Math.max(1, (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1), weeklyClinicalHours: c.weeklyClinicalHours,
            requirements: c.clinicalRequirements.map((r) => ({ serviceAreaId: r.serviceAreaId, hoursPerStudent: r.hoursPerStudent, casesPerStudent: r.casesPerStudent })),
          })))}
          enrollment={defaultEnrollment}
        />
      )}
    </div>
  );
}
