import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProgramFull } from "@/lib/queries";
import {
  addTerm, deleteTerm, addCourse, updateCourse, deleteCourse,
  addSession, deleteSession, addCourseSkill, removeCourseSkill,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const library = await prisma.skill.findMany({ where: { institutionId: program.institutionId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const pid = program.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/programs/${pid}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit structure</h1>
          <p className="text-sm text-slate-500">Author terms, courses, sessions, and course-level KSA development — all in-app. Everything flows into the capacity engine and coverage analysis.</p>
        </div>
        <form action={addTerm.bind(null, pid)}><button className="btn-primary">+ Add term</button></form>
      </div>

      <div className="space-y-6">
        {program.terms.map((term) => (
          <div key={term.id} className="card card-pad space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{term.name} <span className="text-xs font-normal text-slate-400">weeks {term.startWeek}–{term.endWeek}</span></h2>
              <form action={deleteTerm.bind(null, term.id, pid)}><button className="text-xs text-slate-400 hover:text-rose-600">Delete term</button></form>
            </div>

            {term.courses.map((course) => (
              <div key={course.id} className="rounded-lg border border-slate-200 p-3">
                {/* Course header / edit */}
                <div className="flex flex-wrap items-end gap-2">
                  <form action={updateCourse.bind(null, course.id, pid)} className="flex flex-wrap items-end gap-2">
                    <Lab label="Code"><input name="code" defaultValue={course.code ?? ""} className="input-sm w-24" /></Lab>
                    <Lab label="Course name"><input name="name" defaultValue={course.name} className="input-sm w-56" /></Lab>
                    <Lab label="Class h/wk"><input name="weeklyClassHours" type="number" step="0.5" defaultValue={course.weeklyClassHours} className="input-sm w-20" /></Lab>
                    <Lab label="Lab h/wk"><input name="weeklyLabHours" type="number" step="0.5" defaultValue={course.weeklyLabHours} className="input-sm w-20" /></Lab>
                    <Lab label="Clin h/wk"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue={course.weeklyClinicalHours} className="input-sm w-20" /></Lab>
                    <button className="btn-ghost py-1 text-xs">Save</button>
                  </form>
                  <span className="flex-1" />
                  <form action={deleteCourse.bind(null, course.id, pid)}><button className="text-xs text-slate-400 hover:text-rose-600">Delete</button></form>
                </div>

                {/* Sessions */}
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Sessions ({course.sessions.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {course.sessions.sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number).map((s) => (
                      <span key={s.id} className="group inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px]">
                        <span className={s.kind === "CLASS" ? "text-sky-700" : s.kind === "LAB" ? "text-violet-700" : "text-rose-700"}>
                          {s.kind[0]}{s.number}
                        </span>
                        <span className="text-slate-400">{s.lengthHours}h·≤{s.maxStudents}·{s.facultyNeeded}f{s.preceptorsNeeded ? `·${s.preceptorsNeeded}p` : ""}</span>
                        <form action={deleteSession.bind(null, s.id, pid)}><button className="text-slate-300 hover:text-rose-600">✕</button></form>
                      </span>
                    ))}
                    {course.sessions.length === 0 && <span className="text-xs text-slate-400">No sessions.</span>}
                  </div>
                  {/* Add session */}
                  <form action={addSession.bind(null, course.id, pid)} className="mt-2 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
                    <Lab label="Kind">
                      <select name="kind" className="input-sm w-24"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select>
                    </Lab>
                    <Lab label="Title"><input name="title" placeholder="Session title" className="input-sm w-40" /></Lab>
                    <Lab label="Hours"><input name="lengthHours" type="number" step="0.5" defaultValue="4" className="input-sm w-16" /></Lab>
                    <Lab label="Max/seat"><input name="maxStudents" type="number" defaultValue="30" className="input-sm w-16" /></Lab>
                    <Lab label="Faculty"><input name="facultyNeeded" type="number" defaultValue="1" className="input-sm w-14" /></Lab>
                    <Lab label="Precept"><input name="preceptorsNeeded" type="number" defaultValue="0" className="input-sm w-14" /></Lab>
                    <Lab label="Week"><input name="week" type="number" className="input-sm w-14" /></Lab>
                    <button className="btn-primary py-1 text-xs">+ Session</button>
                  </form>
                </div>

                {/* Course KSAs */}
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Develops KSAs</div>
                  <div className="flex flex-wrap gap-1">
                    {course.courseSkills.map((cs) => (
                      <span key={cs.id} className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">
                        {cs.skill.name} → L{cs.targetLevel}{cs.role ? ` (${cs.role.toLowerCase()})` : ""}
                        <form action={removeCourseSkill.bind(null, cs.id, pid)}><button className="text-violet-300 hover:text-rose-600">✕</button></form>
                      </span>
                    ))}
                    {course.courseSkills.length === 0 && <span className="text-xs text-slate-400">None.</span>}
                  </div>
                  <form action={addCourseSkill.bind(null, course.id, pid)} className="mt-2 flex flex-wrap items-end gap-2">
                    <select name="skillId" required className="input-sm w-48"><option value="">Add skill…</option>{library.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}</select>
                    <Lab label="To level"><input name="targetLevel" type="number" min="1" max="5" defaultValue="2" className="input-sm w-16" /></Lab>
                    <select name="role" className="input-sm w-32"><option value="INTRODUCED">Introduced</option><option value="REINFORCED">Reinforced</option><option value="MASTERED">Mastered</option></select>
                    <button className="btn-ghost py-1 text-xs">Add KSA</button>
                  </form>
                </div>
              </div>
            ))}

            {/* Add course */}
            <form action={addCourse.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <Lab label="Code"><input name="code" placeholder="RAD-110" className="input-sm w-24" /></Lab>
              <Lab label="New course name"><input name="name" required placeholder="Course name" className="input-sm w-56" /></Lab>
              <Lab label="Class h/wk"><input name="weeklyClassHours" type="number" step="0.5" defaultValue="0" className="input-sm w-20" /></Lab>
              <Lab label="Lab h/wk"><input name="weeklyLabHours" type="number" step="0.5" defaultValue="0" className="input-sm w-20" /></Lab>
              <Lab label="Clin h/wk"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue="0" className="input-sm w-20" /></Lab>
              <button className="btn-primary py-1 text-xs">+ Add course</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lab({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}
