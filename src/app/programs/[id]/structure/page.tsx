import { notFound } from "next/navigation";
import { getProgramFull, getProgramRequirementCoverage } from "@/lib/queries";
import { ProgramDesigner, type DTerm } from "@/components/ProgramDesigner";
import { ClinicalRequirementsGrid } from "@/components/ClinicalRequirementsGrid";
import { RequirementRollup } from "@/components/RequirementRollup";
import { Collapse } from "@/components/Collapse";

export const dynamic = "force-dynamic";

// DESIGN & SEQUENCE — the program template: terms, courses, every class, lab and clinical
// session with its capacity and staffing; then how the clinical sequence rolls up to what
// the credentialing body requires.
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
  const clinicalCourses = program.terms.flatMap((t) => t.courses.filter((c) => c.weeklyClinicalHours > 0 || c.clinicalRequirements.length > 0)).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">The template every offering runs: terms, courses, and each class, lab and clinical session with its length, capacity and staffing. Open a course to edit its sessions.</p>

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

      {reqCov && reqCov.sets.length > 0 && (
        <section id="requirements" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">How the clinical sequence satisfies {reqCov.sets.map((x) => x.authority.split(" · ")[0]).join(" · ")} <span className="text-sm font-normal text-slate-400">— course by course, which required experiences become reachable, and the target a student should have logged by the end of each</span></h2>
          <RequirementRollup cov={reqCov} />
        </section>
      )}

      {program.family && (
        <Collapse title="Clinical hours & cases per course, by setting" sub="The settings this program's clinicals happen in, and what each student must log per course in each — the demand the roll-up above reads" summary={<>{program.family.serviceAreas.length} settings · {clinicalCourses} clinical courses</>}>
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
        </Collapse>
      )}
    </div>
  );
}
