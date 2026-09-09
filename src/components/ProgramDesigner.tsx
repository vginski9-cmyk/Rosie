"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { sessionService, DEFAULT_SERVICE } from "@/lib/service";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import { SessionSheet } from "@/components/SessionSheet";
import { SheetImport } from "@/components/SheetImport";
import { ClinicalAnalytics } from "@/components/ClinicalAnalytics";
import { type AnalyticsCourse, shiftOf } from "@/lib/clinicalanalytics";
import { deriveAssumptions, type WorkloadAssumptions } from "@/lib/capacitymodel";
import { dec } from "@/lib/format";
import {
  addTerm, deleteTerm, updateTerm, addCourse, updateCourse, deleteCourse,
  updateWorkloadAssumptions,
} from "@/lib/actions";

type Kind = "CLASS" | "LAB" | "CLINICAL";

export interface DSession {
  id: string; kind: Kind; number: number; title: string | null;
  lengthHours: number; maxStudents: number; facultyNeeded: number; preceptorsNeeded: number; supportStaffNeeded: number;
  week: number | null; dayOfWeek: string | null; startTime: string | null; location: string | null;
  homework: string | null; rotationType: string | null; clinicalMode: string | null;
  deliveryMode: string | null; notes: string | null;
  facultyContactPolicy: number | null; supportContactPolicy: number | null; preceptorContactPolicy: number | null;
}
export interface DCourse {
  id: string; code: string | null; name: string; creditHours: number | null;
  weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number;
  semesterOffered: string | null; courseType: string | null; description: string | null; requisites: string | null;
  sessions: DSession[];
}
export interface DTerm { id: string; name: string; index: number; semester?: string | null; startWeek: number | null; endWeek: number | null; courses: DCourse[] }

const n0 = (n: number) => dec(n);
const n1 = (n: number) => dec(n);
const n2 = (n: number) => dec(n);

export function ProgramDesigner({ programId, programName, terms, defaultEnrollment, assumptions }: { programId: string; programName?: string; terms: DTerm[]; defaultEnrollment: number; assumptions: WorkloadAssumptions }) {
  const [enrollment, setEnrollment] = useState(Math.max(1, Math.round(defaultEnrollment) || 40));
  // Courses are closed by default: one row each; open one to edit its catalog fields and sessions.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showSeq, setShowSeq] = useState(false);
  const pid = programId;
  const allCourseIds = terms.flatMap((t) => t.courses.map((c) => c.id));
  const toggleCourse = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOpen = allCourseIds.length > 0 && allCourseIds.every((id) => open.has(id));
  const toggleAllCourses = () => setOpen(allOpen ? new Set() : new Set(allCourseIds));

  // Sequencer inputs (drag-drop), built from the same template.
  const seqTerms: SeqTerm[] = terms.map((t) => ({ id: t.id, name: t.name, courseCount: t.courses.length }));
  const seqCourses: SeqCourse[] = terms.flatMap((t) => t.courses.map((c) => ({
    id: c.id, code: c.code, name: c.name, termId: t.id, requisites: c.requisites,
    classCount: c.sessions.filter((s) => s.kind === "CLASS").length,
    labCount: c.sessions.filter((s) => s.kind === "LAB").length,
    clinicalCount: c.sessions.filter((s) => s.kind === "CLINICAL").length,
  })));

  const calc = useMemo(() => {
    const perStudent = { CLASS: 0, LAB: 0, CLINICAL: 0 };
    const sectionHrs = { CLASS: 0, LAB: 0, CLINICAL: 0 };
    const sections = { CLASS: 0, LAB: 0, CLINICAL: 0 };
    let facHrs = 0, facFte = 0, precHrs = 0, precFte = 0;
    const bySession = new Map<string, ReturnType<typeof sessionService>>();
    const courseStudentHrs = new Map<string, { CLASS: number; LAB: number; CLINICAL: number }>();
    const courseFootprint = new Map<string, { sec: { CLASS: number; LAB: number; CLINICAL: number }; space: { CLASS: number; LAB: number; CLINICAL: number }; facFte: number; precFte: number }>();
    const termStudentHrs = new Map<string, { CLASS: number; LAB: number; CLINICAL: number }>();
    for (const t of terms) {
      const th = { CLASS: 0, LAB: 0, CLINICAL: 0 };
      for (const c of t.courses) {
        const ch = { CLASS: 0, LAB: 0, CLINICAL: 0 };
        const fp = { sec: { CLASS: 0, LAB: 0, CLINICAL: 0 }, space: { CLASS: 0, LAB: 0, CLINICAL: 0 }, facFte: 0, precFte: 0 };
        for (const s of c.sessions) {
          const r = sessionService(s, enrollment, DEFAULT_SERVICE);
          bySession.set(s.id, r);
          perStudent[s.kind] += s.lengthHours; ch[s.kind] += s.lengthHours; th[s.kind] += s.lengthHours;
          sectionHrs[s.kind] += r.spaceHours; sections[s.kind] += r.sections;
          fp.sec[s.kind] += r.sections; fp.space[s.kind] += r.spaceHours; fp.facFte += r.facultyFte; fp.precFte += r.preceptorFte;
          facHrs += r.facultyContactHours; facFte += r.facultyFte; precHrs += r.preceptorContactHours; precFte += r.preceptorFte;
        }
        courseStudentHrs.set(c.id, ch);
        courseFootprint.set(c.id, fp);
      }
      termStudentHrs.set(t.id, th);
    }
    return { perStudent, sectionHrs, sections, facHrs, facFte, precHrs, precFte, bySession, courseStudentHrs, courseFootprint, termStudentHrs };
  }, [terms, enrollment]);

  // Every session in the program — its values feed the drop-downs on every row.
  const allSessions = useMemo(() => terms.flatMap((t) => t.courses.flatMap((c) => c.sessions)), [terms]);

  // Clinical analytics input: every course with its term and week count.
  const analyticsCourses: AnalyticsCourse[] = useMemo(() => terms.flatMap((t) => t.courses.map((c) => ({
    id: c.id, code: c.code, name: c.name, termName: t.name, termIndex: t.index, weeks: Math.max(1, (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1),
    sessions: c.sessions.map((s) => ({ id: s.id, kind: s.kind, lengthHours: s.lengthHours, maxStudents: s.maxStudents, preceptorsNeeded: s.preceptorsNeeded, facultyNeeded: s.facultyNeeded, deliveryMode: s.deliveryMode, location: s.location, rotationType: s.rotationType, clinicalMode: s.clinicalMode, startTime: s.startTime, dayOfWeek: s.dayOfWeek, week: s.week })),
  }))), [terms]);
  // Per-course clinical settings / modes / shifts, for the tally line under each course.
  const courseClinical = (c: DCourse) => {
    const clin = c.sessions.filter((s) => s.kind === "CLINICAL");
    const agg = (key: (s: DSession) => string | null | undefined) => { const m = new Map<string, number>(); for (const s of clin) { const k = key(s)?.trim() || "(not set)"; m.set(k, (m.get(k) ?? 0) + s.lengthHours); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    return { settings: agg((s) => s.rotationType), modes: agg((s) => s.clinicalMode), shifts: agg((s) => shiftOf(s.startTime)), days: agg((s) => s.dayOfWeek), n: clin.length };
  };

  const psTotal = calc.perStudent.CLASS + calc.perStudent.LAB + calc.perStudent.CLINICAL;
  const shTotal = calc.sectionHrs.CLASS + calc.sectionHrs.LAB + calc.sectionHrs.CLINICAL;

  return (
    <div className="space-y-4">
      {/* Enrollment driver + what the design adds up to, one row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-slate-700">Planned enrollment</span>
          <input type="range" min={1} max={150} value={enrollment} onChange={(e) => setEnrollment(Number(e.target.value))} className="h-2 w-40 accent-rose-600" />
          <input type="number" min={1} value={enrollment} onChange={(e) => setEnrollment(Math.max(1, Number(e.target.value)))} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right font-semibold" />
        </label>
        <span className="text-xs text-slate-500">Per student: <strong className="text-slate-800">{n1(psTotal)} h</strong> ({n1(calc.perStudent.CLASS)} class · {n1(calc.perStudent.LAB)} lab · {n1(calc.perStudent.CLINICAL)} clinical)</span>
        <span className="text-xs text-slate-500">At {n0(enrollment)}: <strong className="text-slate-800">{n0(calc.sections.CLASS + calc.sections.LAB + calc.sections.CLINICAL)} sections</strong> · {n0(shTotal)} space h · faculty <strong className="text-rose-700">{n2(calc.facFte)} FTE</strong> · preceptors <strong className="text-rose-700">{n2(calc.precFte)} FTE</strong></span>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-rose-700">Clinical analytics <span className="font-normal text-slate-400">— settings, modes, shifts and days across the sequence</span></summary>
        <div className="border-t border-slate-100 p-3"><ClinicalAnalytics subject={programName ? `${programName} (template)` : "this template"} courses={analyticsCourses} enrollment={enrollment} /></div>
      </details>

      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-rose-700">Workload assumptions <span className="font-normal text-slate-400">— a full-time faculty or preceptor week, the divisors behind every FTE</span></summary>
        <form action={updateWorkloadAssumptions.bind(null, programId)} className="grid gap-4 border-t border-slate-100 p-4 lg:grid-cols-2">
          {([
            { title: "Faculty", pre: false },
            { title: "Preceptors", pre: true },
          ] as const).map(({ title, pre }) => {
            const d = deriveAssumptions(assumptions);
            const contact = pre ? assumptions.preContactHours : assumptions.facContactHours;
            const week = pre ? assumptions.preWorkWeekHours : assumptions.facWorkWeekHours;
            const tw = pre ? assumptions.preTermWeeks : assumptions.facTermWeeks;
            const conv = pre ? d.preConversion : d.facConversion;
            const sem = pre ? d.preSemesterHours : d.facSemesterHours;
            return (
              <div key={title} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-600">{title}</div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <label className="block"><span className="mb-0.5 block leading-tight text-slate-500">Full-time contact hours / week</span><input name={pre ? "preContactHours" : "facContactHours"} type="number" step="any" defaultValue={contact} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-right font-mono text-blue-900" /></label>
                  <label className="block"><span className="mb-0.5 block leading-tight text-slate-500">Work week hours</span><input name={pre ? "preWorkWeekHours" : "facWorkWeekHours"} type="number" step="any" defaultValue={week} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-right font-mono text-blue-900" /></label>
                  <label className="block"><span className="mb-0.5 block leading-tight text-slate-500">Weeks in a term</span><input name={pre ? "preTermWeeks" : "facTermWeeks"} type="number" step="any" defaultValue={tw} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-right font-mono text-blue-900" /></label>
                  <span className="block"><span className="mb-0.5 block leading-tight text-slate-500">Work hours per contact hour</span><span className="block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-right font-mono text-emerald-900">{n2(conv)}</span></span>
                  <span className="block col-span-2"><span className="mb-0.5 block leading-tight text-slate-500">Contact hours in a full-time term</span><span className="block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-right font-mono text-emerald-900">{n0(sem)}</span></span>
                </div>
              </div>
            );
          })}
          <div className="lg:col-span-2"><button className="btn-primary py-1 text-xs">Save assumptions</button></div>
        </form>
      </details>

      <SheetImport mode="template" programId={pid} />

      {/* Sticky jump-nav: terms, expand, re-sequence, add term */}
      <div className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-2 py-2 backdrop-blur">
        {terms.map((t) => (
          <a key={t.id} href={`#term-${t.index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-rose-100 hover:text-rose-700">{t.name}{t.semester ? <span className="ml-1 text-slate-400">· {t.semester}</span> : null}</a>
        ))}
        <span className="flex-1" />
        <button onClick={() => setShowSeq((v) => !v)} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${showSeq ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>⇄ Re-sequence</button>
        <button onClick={toggleAllCourses} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">{allOpen ? "Collapse every course" : "Expand every course"}</button>
        <form action={addTerm.bind(null, pid)}><button className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700">+ Add term</button></form>
      </div>

      {showSeq && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Re-sequence courses across terms (drag &amp; drop)</div>
          <CourseSequencer programId={pid} terms={seqTerms} initialCourses={seqCourses} />
        </div>
      )}

      {terms.map((term) => {
        const th = calc.termStudentHrs.get(term.id) ?? { CLASS: 0, LAB: 0, CLINICAL: 0 };
        return (
          <div key={term.id} id={`term-${term.index}`} className="card scroll-mt-16">
            {/* Term header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-base font-semibold text-slate-900">{term.name}{term.semester ? <span className="ml-2 text-sm font-normal text-slate-500">{term.semester}</span> : null}</div>
                <div className="text-[11px] text-slate-500">weeks {term.startWeek ?? "?"}–{term.endWeek ?? "?"} · {term.courses.length} courses · per student {n1(th.CLASS)} h class · {n1(th.LAB)} h lab · {n1(th.CLINICAL)} h clinical</div>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500 hover:text-rose-700">edit term</summary>
                <form action={updateTerm.bind(null, term.id, pid)} className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label="Name"><input name="name" defaultValue={term.name} className="inp w-40" /></Field>
                  <Field label="Semester"><select name="semester" defaultValue={term.semester ?? ""} className="inp w-24"><option value="">—</option><option value="Fall">Fall</option><option value="Spring">Spring</option><option value="Summer">Summer</option></select></Field>
                  <Field label="Starts week"><input name="startWeek" type="number" min="1" defaultValue={term.startWeek ?? ""} className="inp w-16" /></Field>
                  <Field label="Ends week"><input name="endWeek" type="number" min="1" defaultValue={term.endWeek ?? ""} className="inp w-16" /></Field>
                  <button className="btn-ghost py-1 text-xs">Save</button>
                  <button formAction={deleteTerm.bind(null, term.id, pid)} className="text-xs text-slate-400 hover:text-rose-600">Delete term</button>
                </form>
              </details>
            </div>

            <div className="divide-y divide-slate-100">
              {term.courses.map((course) => {
                const ch = calc.courseStudentHrs.get(course.id) ?? { CLASS: 0, LAB: 0, CLINICAL: 0 };
                const fp = calc.courseFootprint.get(course.id) ?? { sec: { CLASS: 0, LAB: 0, CLINICAL: 0 }, space: { CLASS: 0, LAB: 0, CLINICAL: 0 }, facFte: 0, precFte: 0 };
                const isOpen = open.has(course.id);
                const cc = courseClinical(course);
                const n = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<Kind, number>; for (const s of course.sessions) n[s.kind]++;
                return (
                  <div key={course.id} className={isOpen ? "bg-slate-50/40" : ""}>
                    {/* One row per course, closed */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                      <button onClick={() => toggleCourse(course.id)} className="w-4 text-slate-400 hover:text-slate-700" title={isOpen ? "collapse" : "open the sessions"}>{isOpen ? "▾" : "▸"}</button>
                      <button onClick={() => toggleCourse(course.id)} className="text-left font-medium text-slate-800 hover:text-rose-700"><span className="text-slate-400">{course.code ?? ""}</span> {course.name}</button>
                      <span className="text-xs text-slate-500">{course.creditHours != null ? `${n1(course.creditHours)} cr · ` : ""}{n1(course.weeklyClassHours)}/{n1(course.weeklyLabHours)}/{n1(course.weeklyClinicalHours)} h/wk</span>
                      <span className="flex gap-1 text-[10px]">
                        {n.CLASS > 0 && <span className="rounded bg-sky-100 px-1 text-sky-700">{n.CLASS} class</span>}
                        {n.LAB > 0 && <span className="rounded bg-violet-100 px-1 text-violet-700">{n.LAB} lab</span>}
                        {n.CLINICAL > 0 && <span className="rounded bg-rose-100 px-1 text-rose-700">{n.CLINICAL} clinical</span>}
                        {n.CLASS + n.LAB + n.CLINICAL === 0 && <span className="rounded bg-amber-50 px-1 text-amber-700">no sessions yet</span>}
                      </span>
                      {cc.n > 0 && <span className="flex flex-wrap gap-1 text-[10px]">{cc.settings.map(([k, h]) => <span key={k} className={`rounded border px-1 ${k === "(not set)" ? "border-amber-300 bg-amber-50 italic text-amber-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{k} {n1(h)}h</span>)}</span>}
                      <span className="ml-auto text-[11px] tabular-nums text-slate-500">{n1(ch.CLASS + ch.LAB + ch.CLINICAL)} h / student · {n0(fp.sec.CLASS + fp.sec.LAB + fp.sec.CLINICAL)} sections · fac <strong className="text-rose-700">{n2(fp.facFte)}</strong>{fp.precFte > 0 ? <> · prec <strong className="text-rose-700">{n2(fp.precFte)}</strong></> : null} FTE</span>
                      <Link href={`/courses/${course.id}`} className="text-[11px] text-rose-600 hover:underline">open ↦</Link>
                    </div>

                    {isOpen && (
                      <div className="space-y-3 px-4 pb-4">
                        <form action={updateCourse.bind(null, course.id, pid)} className="grid items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
                          <Field label="Code"><input name="code" defaultValue={course.code ?? ""} className="inp w-full" /></Field>
                          <Field label="Title"><input name="name" defaultValue={course.name} className="inp w-full lg:col-span-2" /></Field>
                          <Field label="Credit hours"><input name="creditHours" type="number" step="any" defaultValue={course.creditHours ?? ""} className="inp w-full" /></Field>
                          <Field label="Type"><select name="courseType" defaultValue={course.courseType ?? ""} className="inp w-full"><option value="">—</option><option value="CORE">Core</option><option value="GENED">General education</option><option value="SUPPORT">Support</option></select></Field>
                          <Field label="Offered"><select name="semesterOffered" defaultValue={course.semesterOffered ?? ""} className="inp w-full"><option value="">—</option><option value="Fall">Fall</option><option value="Spring">Spring</option><option value="Summer">Summer</option><option value="Fall, Spring">Fall, Spring</option><option value="All">All</option></select></Field>
                          <Field label="Class h / wk"><input name="weeklyClassHours" type="number" step="any" defaultValue={course.weeklyClassHours} className="inp w-full" /></Field>
                          <Field label="Lab h / wk"><input name="weeklyLabHours" type="number" step="any" defaultValue={course.weeklyLabHours} className="inp w-full" /></Field>
                          <Field label="Clinical h / wk"><input name="weeklyClinicalHours" type="number" step="any" defaultValue={course.weeklyClinicalHours} className="inp w-full" /></Field>
                          <Field label="Prerequisites / co-requisites"><input name="requisites" defaultValue={course.requisites ?? ""} className="inp w-full" /></Field>
                          <Field label="Description"><input name="description" defaultValue={course.description ?? ""} className="inp w-full lg:col-span-3" /></Field>
                          <div className="flex items-center gap-3 lg:col-span-2">
                            <button className="btn-primary py-1 text-xs">Save course</button>
                            <button formAction={deleteCourse.bind(null, course.id, pid)} className="text-[11px] text-slate-300 hover:text-rose-600">Delete course</button>
                          </div>
                        </form>
                        {cc.n > 0 && (
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="font-semibold uppercase tracking-wide text-rose-500">Clinical</span>
                            <span className="text-slate-500">modes:</span>{cc.modes.map(([k, h]) => <span key={k} className={`rounded border px-1 py-px text-[10px] ${k === "(not set)" ? "border-amber-300 bg-amber-50 italic text-amber-800" : "border-violet-200 bg-violet-50 text-violet-800"}`}>{k} {n1(h)}h</span>)}
                            <span className="ml-1 text-slate-500">shifts:</span>{cc.shifts.map(([k, h]) => <span key={k} className={`rounded border px-1 py-px text-[10px] ${k === "(not set)" ? "border-amber-300 bg-amber-50 italic text-amber-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{k} {n1(h)}h</span>)}
                            <span className="ml-1 text-slate-500">days:</span>{cc.days.map(([k, h]) => <span key={k} className={`rounded border px-1 py-px text-[10px] ${k === "(not set)" ? "border-amber-300 bg-amber-50 italic text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{k} {n1(h)}h</span>)}
                          </div>
                        )}
                        <SessionSheet
                          programId={pid}
                          courseId={course.id}
                          courseCode={course.code}
                          courseTitle={course.name}
                          termNumber={term.index}
                          semester={term.name}
                          sessions={course.sessions.map((s) => ({
                            id: s.id, kind: s.kind, number: s.number, title: s.title,
                            deliveryMode: s.deliveryMode, location: s.location,
                            lengthHours: s.lengthHours, maxStudents: s.maxStudents,
                            facultyNeeded: s.facultyNeeded, facultyContactPolicy: s.facultyContactPolicy,
                            supportStaffNeeded: s.supportStaffNeeded, supportContactPolicy: s.supportContactPolicy,
                            week: s.week, dayOfWeek: s.dayOfWeek, notes: s.notes,
                            preceptorsNeeded: s.preceptorsNeeded, preceptorContactPolicy: s.preceptorContactPolicy,
                            rotationType: s.rotationType, clinicalMode: s.clinicalMode,
                            startTime: s.startTime,
                          }))}
                          enrollment={enrollment}
                          assumptions={assumptions}
                          allSessions={allSessions}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {term.courses.length === 0 && <p className="px-4 py-3 text-xs text-slate-400">No courses yet.</p>}
            </div>

            {/* Add course */}
            <details className="border-t border-slate-100 px-4 py-2">
              <summary className="cursor-pointer text-xs font-medium text-rose-600">+ Add a course to {term.name}</summary>
              <form action={addCourse.bind(null, term.id, pid)} className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Code"><input name="code" placeholder="RAD-110" className="inp w-24" /></Field>
                <Field label="Title"><input name="name" required placeholder="Course title" className="inp w-56" /></Field>
                <Field label="Credits"><input name="creditHours" type="number" step="any" className="inp w-16" /></Field>
                <Field label="Class h / wk"><input name="weeklyClassHours" type="number" step="any" defaultValue="0" className="inp w-20" /></Field>
                <Field label="Lab h / wk"><input name="weeklyLabHours" type="number" step="any" defaultValue="0" className="inp w-20" /></Field>
                <Field label="Clinical h / wk"><input name="weeklyClinicalHours" type="number" step="any" defaultValue="0" className="inp w-20" /></Field>
                <button className="btn-primary py-1 text-xs">+ Add course</button>
              </form>
            </details>
          </div>
        );
      })}
      <style>{`.inp{border:1px solid #cbd5e1;border-radius:6px;padding:2px 6px;font-size:12px;background:#fff}.inp:focus{outline:2px solid #fb7185;outline-offset:-1px}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>{children}</label>;
}
