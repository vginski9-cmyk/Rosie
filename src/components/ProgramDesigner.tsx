"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { sessionService, DEFAULT_SERVICE } from "@/lib/service";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import { SessionSheet } from "@/components/SessionSheet";
import { SheetImport } from "@/components/SheetImport";
import { deriveAssumptions, type WorkloadAssumptions } from "@/lib/capacitymodel";
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
export interface DTerm { id: string; name: string; index: number; startWeek: number | null; endWeek: number | null; courses: DCourse[] }

const n0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const n1 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const n2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ProgramDesigner({ programId, terms, defaultEnrollment, assumptions }: { programId: string; terms: DTerm[]; defaultEnrollment: number; assumptions: WorkloadAssumptions }) {
  const [enrollment, setEnrollment] = useState(Math.max(1, Math.round(defaultEnrollment) || 40));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showSeq, setShowSeq] = useState(false);
  const pid = programId;
  const toggleTerm = (id: string) => setCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allCollapsed = terms.length > 0 && terms.every((t) => collapsed.has(t.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(terms.map((t) => t.id)));

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

      {/* Workload assumption helpers (capacity model columns AH–AN) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Workload assumption helpers (columns AH–AN)</h3>
          <span className="text-[11px] text-slate-400">The divisors behind the semesterly &amp; weekly conversions — every green formula column below divides by these cells</span>
        </div>
        <form action={updateWorkloadAssumptions.bind(null, programId)} className="grid gap-4 lg:grid-cols-2">
          {([
            { title: "Faculty Workload Assumptions", fx: "columns AA & AB divide by AM2 / AI2", pre: false },
            { title: "Preceptor Workload Assumptions", fx: "columns AD & AE divide by AM5 / AN5", pre: true },
          ] as const).map(({ title, fx, pre }) => {
            const d = deriveAssumptions(assumptions);
            const who = pre ? "preceptor" : "faculty";
            const contact = pre ? assumptions.preContactHours : assumptions.facContactHours;
            const week = pre ? assumptions.preWorkWeekHours : assumptions.facWorkWeekHours;
            const tw = pre ? assumptions.preTermWeeks : assumptions.facTermWeeks;
            const conv = pre ? d.preConversion : d.facConversion;
            const sem = pre ? d.preSemesterHours : d.facSemesterHours;
            const wk = pre ? d.preWeeklyHours : d.facWeeklyHours;
            return (
              <div key={title} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-600">{title} <span className="ml-1 font-mono text-[10px] font-normal text-emerald-700">{fx}</span></div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <label className="block">
                    <span className="mb-0.5 block leading-tight text-slate-500">Full time {who} {pre ? "contact hours" : "student contact hours"}</span>
                    <input name={pre ? "preContactHours" : "facContactHours"} type="number" step="any" defaultValue={contact} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-right font-mono text-blue-900" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block leading-tight text-slate-500">Number of hours in work week</span>
                    <input name={pre ? "preWorkWeekHours" : "facWorkWeekHours"} type="number" step="any" defaultValue={week} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-right font-mono text-blue-900" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block leading-tight text-slate-500">Full Time {pre ? "Preceptor" : "Faculty"} Contact Hour Conversion</span>
                    <span className="block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-right font-mono text-emerald-900" title={pre ? "=AJ5/AI5" : "=AJ2/AI2"}>{n2(conv)}</span>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block leading-tight text-slate-500">Number of weeks in Term</span>
                    <input name={pre ? "preTermWeeks" : "facTermWeeks"} type="number" step="any" defaultValue={tw} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-right font-mono text-blue-900" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block leading-tight text-slate-500">Total Semesterly {pre ? "Preceptor" : "Faculty"} Contact Hours</span>
                    <span className="block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-right font-mono text-emerald-900" title={pre ? "=AL5×AI5" : "=AL2×AI2"}>{n0(sem)}</span>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block leading-tight text-slate-500">Weekly {pre ? "Preceptor" : "Faculty"} Contact Hours</span>
                    <span className="block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-right font-mono text-emerald-900" title={pre ? "=AI5" : "=AI2"}>{n0(wk)}</span>
                  </label>
                </div>
              </div>
            );
          })}
          <div className="lg:col-span-2">
            <button className="btn-primary py-1 text-xs">Save assumptions</button>
            <span className="ml-2 text-[11px] text-slate-400">Saving recomputes every offering, calendar, and insight that reads this template.</span>
          </div>
        </form>
      </div>

      {/* Bring in a schedule someone already keeps in a spreadsheet */}
      <SheetImport mode="template" programId={pid} />

      {/* Sticky jump-nav: terms, collapse, re-sequence, add term */}
      <div className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-2 py-2 backdrop-blur">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Jump to</span>
        {terms.map((t) => (
          <a key={t.id} href={`#term-${t.index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-rose-100 hover:text-rose-700">{t.name}</a>
        ))}
        <span className="flex-1" />
        <button onClick={() => setShowSeq((v) => !v)} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${showSeq ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>⇄ Re-sequence</button>
        <button onClick={toggleAll} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">{allCollapsed ? "Expand all" : "Collapse all"}</button>
        <form action={addTerm.bind(null, pid)}><button className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700">+ Add term</button></form>
      </div>

      {/* Drag & drop sequencing, in place */}
      {showSeq && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Re-sequence courses across terms (drag &amp; drop)</div>
          <CourseSequencer programId={pid} terms={seqTerms} initialCourses={seqCourses} />
        </div>
      )}

      {terms.map((term) => {
        const th = calc.termStudentHrs.get(term.id) ?? { CLASS: 0, LAB: 0, CLINICAL: 0 };
        const isCollapsed = collapsed.has(term.id);
        return (
          <div key={term.id} id={`term-${term.index}`} className="card card-pad space-y-4 scroll-mt-16">
            {/* Term header — name + weeks (extend / compress) */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-end gap-2">
                <button onClick={() => toggleTerm(term.id)} className="pb-1 text-slate-400 hover:text-slate-700" title={isCollapsed ? "expand" : "collapse"}>{isCollapsed ? "▸" : "▾"}</button>
                <form action={updateTerm.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2">
                  <Field label="Term name"><input name="name" defaultValue={term.name} className="inp w-48" /></Field>
                  <Field label="Starts in program week"><input name="startWeek" type="number" min="1" defaultValue={term.startWeek ?? ""} className="inp w-20" /></Field>
                  <Field label="Ends in program week"><input name="endWeek" type="number" min="1" defaultValue={term.endWeek ?? ""} className="inp w-20" /></Field>
                  <button className="btn-ghost py-1 text-xs">Save term</button>
                  <span className="pb-1 text-[11px] text-slate-400">{(term.endWeek ?? 0) - (term.startWeek ?? 0) + 1} wks · {term.courses.length} courses · per student {n1(th.CLASS)}h class / {n1(th.LAB)}h lab / {n1(th.CLINICAL)}h clinical</span>
                </form>
              </div>
              <form action={deleteTerm.bind(null, term.id, pid)}><button className="text-xs text-slate-400 hover:text-rose-600">Delete term</button></form>
            </div>

            {!isCollapsed && term.courses.map((course) => {
              const ch = calc.courseStudentHrs.get(course.id) ?? { CLASS: 0, LAB: 0, CLINICAL: 0 };
              return (
                <div key={course.id} className="rounded-lg border border-slate-200 p-3">
                  {/* Course catalog — open, single grid */}
                  <form action={updateCourse.bind(null, course.id, pid)} className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Course code"><input name="code" defaultValue={course.code ?? ""} className="inp w-full" /></Field>
                    <Field label="Course title"><input name="name" defaultValue={course.name} className="inp w-full" /></Field>
                    <Field label="Credit hours"><input name="creditHours" type="number" step="0.5" defaultValue={course.creditHours ?? ""} className="inp w-full" /></Field>
                    <Field label="Semester(s) offered"><select name="semesterOffered" defaultValue={course.semesterOffered ?? ""} className="inp w-full"><option value="">—</option><option value="Fall">Fall</option><option value="Spring">Spring</option><option value="Summer">Summer</option><option value="Fall, Spring">Fall, Spring</option><option value="All">All</option></select></Field>
                    <Field label="Class hours per week"><input name="weeklyClassHours" type="number" step="0.5" defaultValue={course.weeklyClassHours} className="inp w-full" /></Field>
                    <Field label="Lab hours per week"><input name="weeklyLabHours" type="number" step="0.5" defaultValue={course.weeklyLabHours} className="inp w-full" /></Field>
                    <Field label="Clinical hours per week"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue={course.weeklyClinicalHours} className="inp w-full" /></Field>
                    <Field label="Course type"><select name="courseType" defaultValue={course.courseType ?? ""} className="inp w-full"><option value="">—</option><option value="CORE">Core</option><option value="GENED">General education</option><option value="SUPPORT">Support</option></select></Field>
                    <Field label="Description"><input name="description" defaultValue={course.description ?? ""} className="inp w-full" /></Field>
                    <Field label="Prerequisites / co-requisites"><input name="requisites" defaultValue={course.requisites ?? ""} className="inp w-full lg:col-span-2" /></Field>
                    <div className="flex items-center gap-3">
                      <button className="btn-primary py-1 text-xs">Save course</button>
                      <Link href={`/courses/${course.id}`} className="text-xs text-rose-600 hover:underline">open ↦</Link>
                    </div>
                  </form>
                  {/* Per-course tallies — per student + delivery footprint @ N, live */}
                  {(() => {
                    const fp = calc.courseFootprint.get(course.id) ?? { sec: { CLASS: 0, LAB: 0, CLINICAL: 0 }, space: { CLASS: 0, LAB: 0, CLINICAL: 0 }, facFte: 0, precFte: 0 };
                    const psTot = ch.CLASS + ch.LAB + ch.CLINICAL;
                    const secTot = fp.sec.CLASS + fp.sec.LAB + fp.sec.CLINICAL;
                    const spTot = fp.space.CLASS + fp.space.LAB + fp.space.CLINICAL;
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Per student</span>
                        <Pill dot="bg-sky-500" t={`${n1(ch.CLASS)}h class`} />
                        <Pill dot="bg-violet-500" t={`${n1(ch.LAB)}h lab`} />
                        <Pill dot="bg-rose-500" t={`${n1(ch.CLINICAL)}h clinical`} />
                        <span className="font-semibold text-slate-700">{n1(psTot)}h total</span>
                        <span className="mx-1 text-slate-300">|</span>
                        <span className="font-semibold uppercase tracking-wide text-rose-500">@ {n0(enrollment)}</span>
                        <span className="text-slate-600">{n0(secTot)} sections ({n0(fp.sec.CLASS)}/{n0(fp.sec.LAB)}/{n0(fp.sec.CLINICAL)})</span>
                        <span className="text-slate-600">{n0(spTot)} space hrs</span>
                        <span className="text-slate-600">fac <strong className="text-rose-700">{n2(fp.facFte)}</strong> FTE</span>
                        {fp.precFte > 0 && <span className="text-slate-600">prec <strong className="text-rose-700">{n2(fp.precFte)}</strong> FTE</span>}
                        <span className="flex-1" />
                        <form action={deleteCourse.bind(null, course.id, pid)}><button className="text-[11px] text-slate-300 hover:text-rose-600">Delete course</button></form>
                      </div>
                    );
                  })()}

                  {/* The Raw Data & Calculations session table for this course */}
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
              );
            })}

            {/* Add course */}
            {!isCollapsed && (
              <form action={addCourse.bind(null, term.id, pid)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <Field label="Course code"><input name="code" placeholder="RAD-110" className="inp w-24" /></Field>
                <Field label="Course title"><input name="name" required placeholder="Course title" className="inp w-56" /></Field>
                <Field label="Credit hours"><input name="creditHours" type="number" step="0.5" className="inp w-16" /></Field>
                <Field label="Class hours per week"><input name="weeklyClassHours" type="number" step="0.5" defaultValue="0" className="inp w-24" /></Field>
                <Field label="Lab hours per week"><input name="weeklyLabHours" type="number" step="0.5" defaultValue="0" className="inp w-24" /></Field>
                <Field label="Clinical hours per week"><input name="weeklyClinicalHours" type="number" step="0.5" defaultValue="0" className="inp w-24" /></Field>
                <button className="btn-primary py-1 text-xs">+ Add course</button>
              </form>
            )}
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
function Pill({ dot, t }: { dot: string; t: string }) {
  return <span className="inline-flex items-center gap-1 text-slate-600"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{t}</span>;
}
