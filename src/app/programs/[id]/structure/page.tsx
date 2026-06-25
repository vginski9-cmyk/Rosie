import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProgramFull } from "@/lib/queries";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import {
  addTerm, deleteTerm, updateTerm, addCourse, updateCourse, deleteCourse,
  addSession, updateSession, deleteSession, setSessionTiming,
  addCourseSkill, removeCourseSkill, tagCourseSessions, untagCourseSessions,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const library = await prisma.skill.findMany({ where: { institutionId: program.institutionId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const pid = program.id;

  // Sequencer inputs (drag-drop) built from the same template.
  const seqTerms: SeqTerm[] = program.terms.map((t) => ({ id: t.id, name: t.name, courseCount: t.courses.length }));
  const seqCourses: SeqCourse[] = program.terms.flatMap((t) =>
    t.courses.map((c) => ({
      id: c.id, code: c.code, name: c.name, termId: t.id, requisites: c.requisites,
      classCount: c.sessions.filter((s) => s.kind === "CLASS").length,
      labCount: c.sessions.filter((s) => s.kind === "LAB").length,
      clinicalCount: c.sessions.filter((s) => s.kind === "CLINICAL").length,
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/programs/${pid}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Program &amp; course design</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Design the <strong>timeless template</strong> — terms, courses, and the session-by-session experience: what&apos;s
            taught, when in the week it happens, where, how long, capacity, and the KSAs each session develops or assesses.
            No instructors or students here — those live on a <strong>scheduled offering</strong>. Extend or compress the
            plan by adding/removing terms and editing each term&apos;s week span. Changes save to the program template.
          </p>
        </div>
        <form action={addTerm.bind(null, pid)}><button className="btn-primary">+ Add term</button></form>
      </div>

      {/* Drag & drop sequencing, in place */}
      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-semibold text-rose-700">Re-sequence courses (drag &amp; drop) &amp; check prerequisite order</summary>
        <div className="mt-4">
          <CourseSequencer programId={pid} terms={seqTerms} initialCourses={seqCourses} />
        </div>
      </details>

      <div className="space-y-6">
        {program.terms.map((term) => (
          <div key={term.id} className="card card-pad space-y-4">
            {/* Term header — editable name + week span (extend / compress) */}
            <div className="flex flex-wrap items-end justify-between gap-2">
              <form action={updateTerm.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2">
                <Lab label="Term name"><input name="name" defaultValue={term.name} className="input-sm w-48" /></Lab>
                <Lab label="Start week"><input name="startWeek" type="number" min="1" defaultValue={term.startWeek ?? ""} className="input-sm w-20" /></Lab>
                <Lab label="End week"><input name="endWeek" type="number" min="1" defaultValue={term.endWeek ?? ""} className="input-sm w-20" /></Lab>
                <button className="btn-ghost py-1 text-xs">Save term</button>
                <span className="pb-1.5 text-[11px] text-slate-400">{(term.endWeek ?? 0) - (term.startWeek ?? 0) + 1} weeks</span>
              </form>
              <form action={deleteTerm.bind(null, term.id, pid)}><button className="text-xs text-slate-400 hover:text-rose-600">Delete term</button></form>
            </div>

            {term.courses.map((course) => (
              <div key={course.id} className="rounded-lg border border-slate-200 p-3">
                {/* Course catalog editor (full detail) */}
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="text-slate-400">{course.code}</span> {course.name}
                    <span className="text-[11px] text-slate-400">· {course.sessions.length} sessions · {course.creditHours ?? "—"} cr</span>
                    <span className="flex-1" />
                    <Link href={`/courses/${course.id}`} className="text-xs text-rose-600 hover:underline">open ↦</Link>
                  </summary>
                  <form action={updateCourse.bind(null, course.id, pid)} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Lab label="Code"><input name="code" defaultValue={course.code ?? ""} className="input-sm w-full" /></Lab>
                    <Lab label="Course name"><input name="name" defaultValue={course.name} className="input-sm w-full" /></Lab>
                    <Lab label="Credit hours"><input name="creditHours" type="number" step="0.5" defaultValue={course.creditHours ?? ""} className="input-sm w-full" /></Lab>
                    <Lab label="Class h/wk"><input name="weeklyClassHours" type="number" step="0.5" defaultValue={course.weeklyClassHours} className="input-sm w-full" /></Lab>
                    <Lab label="Lab h/wk"><input name="weeklyLabHours" type="number" step="0.5" defaultValue={course.weeklyLabHours} className="input-sm w-full" /></Lab>
                    <Lab label="Clinical h/wk"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue={course.weeklyClinicalHours} className="input-sm w-full" /></Lab>
                    <Lab label="Offered (semester)"><input name="semesterOffered" defaultValue={course.semesterOffered ?? ""} placeholder="Fall / Spring / All" className="input-sm w-full" /></Lab>
                    <Lab label="Type"><select name="courseType" defaultValue={course.courseType ?? ""} className="input-sm w-full"><option value="">—</option><option value="CORE">Core</option><option value="GENED">Gen-ed</option><option value="SUPPORT">Support</option></select></Lab>
                    <span />
                    <Lab label="Description"><textarea name="description" defaultValue={course.description ?? ""} rows={2} className="input-sm w-full" /></Lab>
                    <Lab label="Requisites"><textarea name="requisites" defaultValue={course.requisites ?? ""} rows={2} className="input-sm w-full" /></Lab>
                    <div className="flex items-end gap-2">
                      <button className="btn-primary py-1 text-xs">Save course</button>
                      <span className="flex-1" />
                    </div>
                  </form>
                  <form action={deleteCourse.bind(null, course.id, pid)} className="mt-1"><button className="text-xs text-slate-400 hover:text-rose-600">Delete course</button></form>
                </details>

                {/* Bulk timing per kind — set day/time/where for all sessions of a kind */}
                <div className="mt-3 rounded bg-slate-50 p-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Set timing &amp; place for all sessions of a kind</div>
                  <form action={setSessionTiming.bind(null, course.id, pid)} className="flex flex-wrap items-end gap-2">
                    <Lab label="Kind"><select name="kind" className="input-sm w-24"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select></Lab>
                    <Lab label="Day"><select name="dayOfWeek" className="input-sm w-20"><option value="">—</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Lab>
                    <Lab label="Start time"><input name="startTime" type="time" className="input-sm w-28" /></Lab>
                    <Lab label="Length"><input name="lengthHours" type="number" step="0.5" placeholder="hrs" className="input-sm w-16" /></Lab>
                    <Lab label="Cap/sec"><input name="maxStudents" type="number" placeholder="cap" className="input-sm w-16" /></Lab>
                    <Lab label="Location"><input name="location" placeholder="Room / site" className="input-sm w-44" /></Lab>
                    <button className="btn-ghost py-1 text-xs">Apply to kind</button>
                  </form>
                </div>

                {/* Per-session list — click to edit time/day/where/detail */}
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Sessions ({course.sessions.length}) — click one to edit</div>
                  <div className="space-y-1">
                    {course.sessions.sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number).map((s) => (
                      <details key={s.id} className="rounded border border-slate-200">
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-2 py-1 text-[11px]">
                          <span className={s.kind === "CLASS" ? "font-semibold text-sky-700" : s.kind === "LAB" ? "font-semibold text-violet-700" : "font-semibold text-rose-700"}>{s.kind[0]}{s.number}</span>
                          <span className="text-slate-700">{s.title ?? "(untitled)"}</span>
                          <span className="text-slate-400">{s.week ? `wk ${s.week} · ` : ""}{s.dayOfWeek ?? "—"} {s.startTime ?? ""} · {s.lengthHours}h · ≤{s.maxStudents} · {s.facultyNeeded}f{s.preceptorsNeeded ? `·${s.preceptorsNeeded}p` : ""}</span>
                          <span className="flex-1" />
                          <span className="truncate text-slate-400">{s.location ?? ""}</span>
                        </summary>
                        <div className="border-t border-slate-100 p-2">
                          <form action={updateSession.bind(null, s.id, pid)} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                            <Lab label="Title"><input name="title" defaultValue={s.title ?? ""} className="input-sm w-full" /></Lab>
                            <Lab label="Week"><input name="week" type="number" defaultValue={s.week ?? ""} className="input-sm w-full" /></Lab>
                            <Lab label="Day"><select name="dayOfWeek" defaultValue={s.dayOfWeek ?? ""} className="input-sm w-full"><option value="">—</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Lab>
                            <Lab label="Start time"><input name="startTime" type="time" defaultValue={s.startTime ?? ""} className="input-sm w-full" /></Lab>
                            <Lab label="Length (h)"><input name="lengthHours" type="number" step="0.5" defaultValue={s.lengthHours} className="input-sm w-full" /></Lab>
                            <Lab label="Cap/section"><input name="maxStudents" type="number" defaultValue={s.maxStudents} className="input-sm w-full" /></Lab>
                            <Lab label="Faculty needed"><input name="facultyNeeded" type="number" defaultValue={s.facultyNeeded} className="input-sm w-full" /></Lab>
                            <Lab label="Preceptors needed"><input name="preceptorsNeeded" type="number" defaultValue={s.preceptorsNeeded} className="input-sm w-full" /></Lab>
                            <Lab label="Location"><input name="location" defaultValue={s.location ?? ""} className="input-sm w-full" /></Lab>
                            <Lab label="Rotation (clinical)"><input name="rotationType" defaultValue={s.rotationType ?? ""} className="input-sm w-full" /></Lab>
                            <Lab label="Mode (clinical)"><input name="clinicalMode" defaultValue={s.clinicalMode ?? ""} className="input-sm w-full" /></Lab>
                            <Lab label="Homework / prep"><input name="homework" defaultValue={s.homework ?? ""} className="input-sm w-full" /></Lab>
                            <div className="flex items-end gap-2">
                              <button className="btn-primary py-1 text-xs">Save session</button>
                            </div>
                          </form>
                          <div className="mt-1 flex items-center gap-2">
                            {s.skillLinks.length > 0 && <span className="text-[10px] text-slate-400">KSAs: {s.skillLinks.map((l) => `${l.skill.name} (${l.mode.toLowerCase()})`).join(", ")}</span>}
                            <span className="flex-1" />
                            <form action={deleteSession.bind(null, s.id, pid)}><button className="text-[11px] text-slate-300 hover:text-rose-600">Delete session</button></form>
                          </div>
                        </div>
                      </details>
                    ))}
                    {course.sessions.length === 0 && <span className="text-xs text-slate-400">No sessions yet.</span>}
                  </div>
                  {/* Add session */}
                  <form action={addSession.bind(null, course.id, pid)} className="mt-2 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
                    <Lab label="Kind"><select name="kind" className="input-sm w-24"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select></Lab>
                    <Lab label="Title"><input name="title" placeholder="Session title" className="input-sm w-40" /></Lab>
                    <Lab label="Week"><input name="week" type="number" className="input-sm w-14" /></Lab>
                    <Lab label="Day"><select name="dayOfWeek" className="input-sm w-20"><option value="">—</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Lab>
                    <Lab label="Time"><input name="startTime" type="time" className="input-sm w-28" /></Lab>
                    <Lab label="Hours"><input name="lengthHours" type="number" step="0.5" defaultValue="2" className="input-sm w-16" /></Lab>
                    <Lab label="Max/seat"><input name="maxStudents" type="number" defaultValue="30" className="input-sm w-16" /></Lab>
                    <Lab label="Faculty"><input name="facultyNeeded" type="number" defaultValue="1" className="input-sm w-14" /></Lab>
                    <Lab label="Precept"><input name="preceptorsNeeded" type="number" defaultValue="0" className="input-sm w-14" /></Lab>
                    <Lab label="Location"><input name="location" placeholder="Room / site" className="input-sm w-40" /></Lab>
                    <button className="btn-primary py-1 text-xs">+ Session</button>
                  </form>
                </div>

                {/* Course KSAs (graduate development target) */}
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Develops KSAs (course → graduate level)</div>
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

                {/* Delivery / assessment at the session grain (taught / read / assessed) */}
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Delivers / assesses (session-level)</div>
                  <div className="flex flex-wrap gap-1">
                    {aggregateSessionSkills(course.sessions).map((g) => (
                      <span key={g.skillId + g.mode} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${g.mode === "ASSESS" ? "bg-amber-50 text-amber-700" : g.mode === "BOTH" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                        {g.skillName} · {g.mode.toLowerCase()} · {g.count} sess
                        <form action={untagCourseSessions.bind(null, course.id, pid, g.skillId)}><button className="text-slate-300 hover:text-rose-600">✕</button></form>
                      </span>
                    ))}
                    {course.sessions.every((s) => s.skillLinks.length === 0) && <span className="text-xs text-slate-400">None.</span>}
                  </div>
                  <form action={tagCourseSessions.bind(null, course.id, pid)} className="mt-2 flex flex-wrap items-end gap-2">
                    <select name="skillId" required className="input-sm w-44"><option value="">Tag skill…</option>{library.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}</select>
                    <select name="kind" className="input-sm w-24"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select>
                    <select name="mode" className="input-sm w-28"><option value="DELIVER">Deliver</option><option value="ASSESS">Assess</option><option value="BOTH">Both</option></select>
                    <Lab label="Level"><input name="targetLevel" type="number" min="1" max="5" className="input-sm w-14" /></Lab>
                    <button className="btn-ghost py-1 text-xs">Tag sessions</button>
                  </form>
                </div>
              </div>
            ))}

            {/* Add course */}
            <form action={addCourse.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <Lab label="Code"><input name="code" placeholder="RAD-110" className="input-sm w-24" /></Lab>
              <Lab label="New course name"><input name="name" required placeholder="Course name" className="input-sm w-56" /></Lab>
              <Lab label="Credits"><input name="creditHours" type="number" step="0.5" className="input-sm w-16" /></Lab>
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

type SessionWithLinks = { skillLinks: { skillId: string; mode: string; skill: { name: string } }[] };
function aggregateSessionSkills(sessions: SessionWithLinks[]) {
  const map = new Map<string, { skillId: string; skillName: string; mode: string; count: number }>();
  for (const s of sessions) {
    for (const l of s.skillLinks) {
      const key = l.skillId + "|" + l.mode;
      const cur = map.get(key) ?? { skillId: l.skillId, skillName: l.skill.name, mode: l.mode, count: 0 };
      cur.count += 1;
      map.set(key, cur);
    }
  }
  return [...map.values()];
}

function Lab({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}
