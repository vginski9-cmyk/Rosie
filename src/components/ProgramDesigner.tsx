"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { sessionService, DEFAULT_SERVICE } from "@/lib/service";
import {
  addTerm, deleteTerm, updateTerm, addCourse, updateCourse, deleteCourse,
  addSession, updateSession, deleteSession, setSessionTiming,
  addCourseSkill, removeCourseSkill, tagCourseSessions, untagCourseSessions,
} from "@/lib/actions";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Kind = "CLASS" | "LAB" | "CLINICAL";

export interface DSession {
  id: string; kind: Kind; number: number; title: string | null;
  lengthHours: number; maxStudents: number; facultyNeeded: number; preceptorsNeeded: number; supportStaffNeeded: number;
  week: number | null; dayOfWeek: string | null; startTime: string | null; location: string | null;
  homework: string | null; rotationType: string | null; clinicalMode: string | null;
  skills: { skillId: string; name: string; mode: string }[];
}
export interface DCourse {
  id: string; code: string | null; name: string; creditHours: number | null;
  weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number;
  semesterOffered: string | null; courseType: string | null; description: string | null; requisites: string | null;
  sessions: DSession[];
  courseSkills: { id: string; skillId: string; name: string; targetLevel: number; role: string | null }[];
}
export interface DTerm { id: string; name: string; index: number; startWeek: number | null; endWeek: number | null; courses: DCourse[] }

const KIND_TEXT: Record<Kind, string> = { CLASS: "text-sky-700", LAB: "text-violet-700", CLINICAL: "text-rose-700" };
const KIND_BG: Record<Kind, string> = { CLASS: "bg-sky-500", LAB: "bg-violet-500", CLINICAL: "bg-rose-500" };
const n0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const n1 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const n2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Shared grid template so the header and every editable row line up.
const ROW = "grid grid-cols-[30px_38px_minmax(150px,1.5fr)_44px_60px_94px_50px_50px_78px_minmax(110px,1fr)_46px_56px_56px_48px_20px] items-center gap-1";

export function ProgramDesigner({ programId, terms, library, defaultEnrollment }: { programId: string; terms: DTerm[]; library: { id: string; name: string }[]; defaultEnrollment: number }) {
  const [enrollment, setEnrollment] = useState(Math.max(1, Math.round(defaultEnrollment) || 40));
  const pid = programId;

  const calc = useMemo(() => {
    const perStudent = { CLASS: 0, LAB: 0, CLINICAL: 0 };
    const sectionHrs = { CLASS: 0, LAB: 0, CLINICAL: 0 };
    const sections = { CLASS: 0, LAB: 0, CLINICAL: 0 };
    let facHrs = 0, facFte = 0, precHrs = 0, precFte = 0;
    const bySession = new Map<string, ReturnType<typeof sessionService>>();
    const courseStudentHrs = new Map<string, { CLASS: number; LAB: number; CLINICAL: number }>();
    const termStudentHrs = new Map<string, { CLASS: number; LAB: number; CLINICAL: number }>();
    for (const t of terms) {
      const th = { CLASS: 0, LAB: 0, CLINICAL: 0 };
      for (const c of t.courses) {
        const ch = { CLASS: 0, LAB: 0, CLINICAL: 0 };
        for (const s of c.sessions) {
          const r = sessionService(s, enrollment, DEFAULT_SERVICE);
          bySession.set(s.id, r);
          perStudent[s.kind] += s.lengthHours; ch[s.kind] += s.lengthHours; th[s.kind] += s.lengthHours;
          sectionHrs[s.kind] += r.spaceHours; sections[s.kind] += r.sections;
          facHrs += r.facultyContactHours; facFte += r.facultyFte; precHrs += r.preceptorContactHours; precFte += r.preceptorFte;
        }
        courseStudentHrs.set(c.id, ch);
      }
      termStudentHrs.set(t.id, th);
    }
    return { perStudent, sectionHrs, sections, facHrs, facFte, precHrs, precFte, bySession, courseStudentHrs, termStudentHrs };
  }, [terms, enrollment]);

  const psTotal = calc.perStudent.CLASS + calc.perStudent.LAB + calc.perStudent.CLINICAL;
  const shTotal = calc.sectionHrs.CLASS + calc.sectionHrs.LAB + calc.sectionHrs.CLINICAL;

  return (
    <div className="space-y-6">
      {/* Enrollment driver + program tally */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-rose-50/60 to-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="text-sm font-semibold text-slate-700">Planned cohort enrollment</div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
              Pure planning — drag to see how the delivery footprint scales. Sections = ROUNDUP(enrollment ÷ capacity).
              No instructors or students here; that&apos;s a scheduled offering.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input type="range" min={1} max={150} value={enrollment} onChange={(e) => setEnrollment(Number(e.target.value))} className="h-2 w-56 accent-rose-600" />
            <div className="text-right">
              <input type="number" min={1} value={enrollment} onChange={(e) => setEnrollment(Math.max(1, Number(e.target.value)))} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-right text-2xl font-semibold" />
              <div className="text-[11px] uppercase tracking-wide text-slate-400">students enrolled</div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {/* Per student (one seat) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hours a single student attends (whole program)</div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center">
              <Hr label="Class" v={calc.perStudent.CLASS} dot="bg-sky-500" />
              <Hr label="Lab" v={calc.perStudent.LAB} dot="bg-violet-500" />
              <Hr label="Clinical" v={calc.perStudent.CLINICAL} dot="bg-rose-500" />
              <Hr label="Total" v={psTotal} bold />
            </div>
          </div>
          {/* Across all sections at N */}
          <div className="rounded-xl border border-rose-200 bg-white p-4 ring-1 ring-rose-100">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">Delivery footprint across all sections @ {n0(enrollment)} students</div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center">
              <Hr label={`Class · ${n0(calc.sections.CLASS)} sec`} v={calc.sectionHrs.CLASS} dot="bg-sky-500" />
              <Hr label={`Lab · ${n0(calc.sections.LAB)} sec`} v={calc.sectionHrs.LAB} dot="bg-violet-500" />
              <Hr label={`Clinical · ${n0(calc.sections.CLINICAL)} sec`} v={calc.sectionHrs.CLINICAL} dot="bg-rose-500" />
              <Hr label="Total space" v={shTotal} bold />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>Faculty contact: <strong className="tabular-nums text-slate-700">{n1(calc.facHrs)}h</strong></span>
              <span>Faculty FTE: <strong className="tabular-nums text-rose-700">{n2(calc.facFte)}</strong></span>
              <span>Preceptor contact: <strong className="tabular-nums text-slate-700">{n1(calc.precHrs)}h</strong></span>
              <span>Preceptor FTE: <strong className="tabular-nums text-rose-700">{n2(calc.precFte)}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Add term */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">{terms.length} term{terms.length === 1 ? "" : "s"} · edit any field and hit its Save.</div>
        <form action={addTerm.bind(null, pid)}><button className="btn-primary text-sm">+ Add term</button></form>
      </div>

      {terms.map((term) => {
        const th = calc.termStudentHrs.get(term.id) ?? { CLASS: 0, LAB: 0, CLINICAL: 0 };
        return (
          <div key={term.id} className="card card-pad space-y-4">
            {/* Term header — name + weeks (extend / compress) */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-3">
              <form action={updateTerm.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2">
                <Field label="Term name"><input name="name" defaultValue={term.name} className="inp w-48" /></Field>
                <Field label="Start wk"><input name="startWeek" type="number" min="1" defaultValue={term.startWeek ?? ""} className="inp w-16" /></Field>
                <Field label="End wk"><input name="endWeek" type="number" min="1" defaultValue={term.endWeek ?? ""} className="inp w-16" /></Field>
                <button className="btn-ghost py-1 text-xs">Save term</button>
                <span className="pb-1 text-[11px] text-slate-400">{(term.endWeek ?? 0) - (term.startWeek ?? 0) + 1} wks · per student {n1(th.CLASS)}h class / {n1(th.LAB)}h lab / {n1(th.CLINICAL)}h clinical</span>
              </form>
              <form action={deleteTerm.bind(null, term.id, pid)}><button className="text-xs text-slate-400 hover:text-rose-600">Delete term</button></form>
            </div>

            {term.courses.map((course) => {
              const ch = calc.courseStudentHrs.get(course.id) ?? { CLASS: 0, LAB: 0, CLINICAL: 0 };
              return (
                <div key={course.id} className="rounded-lg border border-slate-200 p-3">
                  {/* Course catalog — open, single grid */}
                  <form action={updateCourse.bind(null, course.id, pid)} className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Code"><input name="code" defaultValue={course.code ?? ""} className="inp w-full" /></Field>
                    <Field label="Course name"><input name="name" defaultValue={course.name} className="inp w-full" /></Field>
                    <Field label="Credits"><input name="creditHours" type="number" step="0.5" defaultValue={course.creditHours ?? ""} className="inp w-full" /></Field>
                    <Field label="Offered"><input name="semesterOffered" defaultValue={course.semesterOffered ?? ""} placeholder="Fall / All" className="inp w-full" /></Field>
                    <Field label="Class h/wk"><input name="weeklyClassHours" type="number" step="0.5" defaultValue={course.weeklyClassHours} className="inp w-full" /></Field>
                    <Field label="Lab h/wk"><input name="weeklyLabHours" type="number" step="0.5" defaultValue={course.weeklyLabHours} className="inp w-full" /></Field>
                    <Field label="Clinical h/wk"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue={course.weeklyClinicalHours} className="inp w-full" /></Field>
                    <Field label="Type"><select name="courseType" defaultValue={course.courseType ?? ""} className="inp w-full"><option value="">—</option><option value="CORE">Core</option><option value="GENED">Gen-ed</option><option value="SUPPORT">Support</option></select></Field>
                    <Field label="Description"><input name="description" defaultValue={course.description ?? ""} className="inp w-full" /></Field>
                    <Field label="Requisites"><input name="requisites" defaultValue={course.requisites ?? ""} className="inp w-full lg:col-span-2" /></Field>
                    <div className="flex items-center gap-3">
                      <button className="btn-primary py-1 text-xs">Save course</button>
                      <Link href={`/courses/${course.id}`} className="text-xs text-rose-600 hover:underline">open ↦</Link>
                    </div>
                  </form>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Per student: {n1(ch.CLASS)}h class · {n1(ch.LAB)}h lab · {n1(ch.CLINICAL)}h clinical</span>
                    <form action={deleteCourse.bind(null, course.id, pid)}><button className="text-[11px] text-slate-300 hover:text-rose-600">Delete course</button></form>
                  </div>

                  {/* Sessions — all open, single row each, with live computed columns */}
                  <div className="mt-3 overflow-x-auto">
                    <div className="min-w-[940px]">
                      <div className={`${ROW} border-b border-slate-200 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400`}>
                        <span>#</span><span>Kind</span><span>Title</span><span>Wk</span><span>Day</span><span>Time</span><span>Len</span><span>Cap</span><span>Staff f/p</span><span>Location</span>
                        <span className="text-rose-500">Sec</span><span className="text-rose-500">Space</span><span className="text-sky-600">FacHr</span><span></span><span></span>
                      </div>
                      {[...course.sessions].sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number).map((s) => {
                        const r = calc.bySession.get(s.id);
                        return (
                          <div key={s.id} className={`${ROW} border-b border-slate-50 py-1`}>
                            <form action={updateSession.bind(null, s.id, pid)} className="contents">
                              <span className="text-[11px] text-slate-400">{s.number}</span>
                              <span className={`text-[11px] font-bold ${KIND_TEXT[s.kind]}`}>{s.kind[0]}</span>
                              <input name="title" defaultValue={s.title ?? ""} className="inp w-full" />
                              <input name="week" type="number" defaultValue={s.week ?? ""} className="inp w-full" />
                              <select name="dayOfWeek" defaultValue={s.dayOfWeek ?? ""} className="inp w-full"><option value="">—</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                              <input name="startTime" type="time" defaultValue={s.startTime ?? ""} className="inp w-full" />
                              <input name="lengthHours" type="number" step="0.5" defaultValue={s.lengthHours} className="inp w-full" />
                              <input name="maxStudents" type="number" defaultValue={s.maxStudents} className="inp w-full" />
                              <span className="flex items-center gap-0.5">
                                <input name="facultyNeeded" type="number" step="0.1" defaultValue={s.facultyNeeded} className="inp w-9" title="faculty per section" />
                                <input name="preceptorsNeeded" type="number" step="0.1" defaultValue={s.preceptorsNeeded} className="inp w-9" title="preceptors per section" />
                              </span>
                              <input name="location" defaultValue={s.location ?? ""} className="inp w-full" />
                              <span className="rounded bg-rose-50 px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums text-rose-700">{r ? n0(r.sections) : "—"}</span>
                              <span className="rounded bg-rose-50/60 px-1 py-0.5 text-center text-[11px] tabular-nums text-slate-600">{r ? n0(r.spaceHours) : "—"}</span>
                              <span className="rounded bg-sky-50 px-1 py-0.5 text-center text-[11px] tabular-nums text-slate-600">{r ? n1(r.facultyContactHours) : "—"}</span>
                              <button className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-rose-700">Save</button>
                              <input type="hidden" name="rotationType" defaultValue={s.rotationType ?? ""} />
                              <input type="hidden" name="clinicalMode" defaultValue={s.clinicalMode ?? ""} />
                              <input type="hidden" name="homework" defaultValue={s.homework ?? ""} />
                              <input type="hidden" name="supportStaffNeeded" defaultValue={s.supportStaffNeeded} />
                            </form>
                            <form action={deleteSession.bind(null, s.id, pid)} className="contents"><button className="text-slate-300 hover:text-rose-600" title="delete">✕</button></form>
                          </div>
                        );
                      })}
                      {course.sessions.length === 0 && <div className="py-2 text-xs text-slate-400">No sessions yet.</div>}
                    </div>
                  </div>

                  {/* Add session (open) */}
                  <form action={addSession.bind(null, course.id, pid)} className="mt-2 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
                    <Field label="Kind"><select name="kind" className="inp w-24"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select></Field>
                    <Field label="Title"><input name="title" placeholder="Session title" className="inp w-40" /></Field>
                    <Field label="Wk"><input name="week" type="number" className="inp w-12" /></Field>
                    <Field label="Day"><select name="dayOfWeek" className="inp w-16"><option value="">—</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
                    <Field label="Time"><input name="startTime" type="time" className="inp w-28" /></Field>
                    <Field label="Len"><input name="lengthHours" type="number" step="0.5" defaultValue="2" className="inp w-14" /></Field>
                    <Field label="Cap"><input name="maxStudents" type="number" defaultValue="30" className="inp w-14" /></Field>
                    <Field label="Fac"><input name="facultyNeeded" type="number" step="0.1" defaultValue="1" className="inp w-12" /></Field>
                    <Field label="Prec"><input name="preceptorsNeeded" type="number" step="0.1" defaultValue="0" className="inp w-12" /></Field>
                    <Field label="Location"><input name="location" placeholder="Room / site" className="inp w-36" /></Field>
                    <button className="btn-primary py-1 text-xs">+ Session</button>
                  </form>

                  {/* Bulk timing for a whole kind */}
                  <form action={setSessionTiming.bind(null, course.id, pid)} className="mt-2 flex flex-wrap items-end gap-2 text-[11px]">
                    <span className="pb-1 font-semibold uppercase tracking-wide text-slate-400">Bulk set all</span>
                    <select name="kind" className="inp w-20"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select>
                    <span className="pb-1 text-slate-400">to</span>
                    <select name="dayOfWeek" className="inp w-16"><option value="">day</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                    <input name="startTime" type="time" className="inp w-28" />
                    <input name="lengthHours" type="number" step="0.5" placeholder="len" className="inp w-14" />
                    <input name="maxStudents" type="number" placeholder="cap" className="inp w-14" />
                    <input name="location" placeholder="location" className="inp w-40" />
                    <button className="btn-ghost py-1 text-xs">Apply</button>
                  </form>

                  {/* KSAs (taught / assessed) */}
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Develops KSAs (course → grad level)</div>
                      <div className="flex flex-wrap gap-1">
                        {course.courseSkills.map((cs) => (
                          <span key={cs.id} className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">
                            {cs.name} → L{cs.targetLevel}{cs.role ? ` (${cs.role.toLowerCase()})` : ""}
                            <form action={removeCourseSkill.bind(null, cs.id, pid)}><button className="text-violet-300 hover:text-rose-600">✕</button></form>
                          </span>
                        ))}
                        {course.courseSkills.length === 0 && <span className="text-[11px] text-slate-400">None.</span>}
                      </div>
                      <form action={addCourseSkill.bind(null, course.id, pid)} className="mt-1.5 flex flex-wrap items-end gap-1.5">
                        <select name="skillId" required className="inp w-40"><option value="">Add skill…</option>{library.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}</select>
                        <input name="targetLevel" type="number" min="1" max="5" defaultValue="2" className="inp w-12" title="level" />
                        <select name="role" className="inp w-28"><option value="INTRODUCED">Introduced</option><option value="REINFORCED">Reinforced</option><option value="MASTERED">Mastered</option></select>
                        <button className="btn-ghost py-1 text-[11px]">Add</button>
                      </form>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Delivers / assesses (per session)</div>
                      <div className="flex flex-wrap gap-1">
                        {aggregateSkills(course.sessions).map((g) => (
                          <span key={g.skillId + g.mode} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${g.mode === "ASSESS" ? "bg-amber-50 text-amber-700" : g.mode === "BOTH" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                            {g.name} · {g.mode.toLowerCase()} · {g.count} sess
                            <form action={untagCourseSessions.bind(null, course.id, pid, g.skillId)}><button className="text-slate-300 hover:text-rose-600">✕</button></form>
                          </span>
                        ))}
                        {course.sessions.every((s) => s.skills.length === 0) && <span className="text-[11px] text-slate-400">None.</span>}
                      </div>
                      <form action={tagCourseSessions.bind(null, course.id, pid)} className="mt-1.5 flex flex-wrap items-end gap-1.5">
                        <select name="skillId" required className="inp w-36"><option value="">Tag skill…</option>{library.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}</select>
                        <select name="kind" className="inp w-20"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select>
                        <select name="mode" className="inp w-24"><option value="DELIVER">Deliver</option><option value="ASSESS">Assess</option><option value="BOTH">Both</option></select>
                        <input name="targetLevel" type="number" min="1" max="5" className="inp w-12" title="level" />
                        <button className="btn-ghost py-1 text-[11px]">Tag</button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add course */}
            <form action={addCourse.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <Field label="Code"><input name="code" placeholder="RAD-110" className="inp w-24" /></Field>
              <Field label="New course name"><input name="name" required placeholder="Course name" className="inp w-56" /></Field>
              <Field label="Credits"><input name="creditHours" type="number" step="0.5" className="inp w-16" /></Field>
              <Field label="Class h/wk"><input name="weeklyClassHours" type="number" step="0.5" defaultValue="0" className="inp w-20" /></Field>
              <Field label="Lab h/wk"><input name="weeklyLabHours" type="number" step="0.5" defaultValue="0" className="inp w-20" /></Field>
              <Field label="Clin h/wk"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue="0" className="inp w-20" /></Field>
              <button className="btn-primary py-1 text-xs">+ Add course</button>
            </form>
          </div>
        );
      })}
      <style>{`.inp{border:1px solid #cbd5e1;border-radius:6px;padding:2px 6px;font-size:12px;background:#fff}.inp:focus{outline:2px solid #fb7185;outline-offset:-1px}`}</style>
    </div>
  );
}

function Hr({ label, v, dot, bold }: { label: string; v: number; dot?: string; bold?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-${bold ? "extrabold" : "semibold"} tabular-nums ${bold ? "text-slate-900" : "text-slate-800"}`}>{n0(v)}</div>
      <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">{dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}{label}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>{children}</label>;
}
function aggregateSkills(sessions: DSession[]) {
  const map = new Map<string, { skillId: string; name: string; mode: string; count: number }>();
  for (const s of sessions) for (const l of s.skills) {
    const key = l.skillId + "|" + l.mode;
    const cur = map.get(key) ?? { skillId: l.skillId, name: l.name, mode: l.mode, count: 0 };
    cur.count += 1; map.set(key, cur);
  }
  return [...map.values()];
}
