import { setStudentSection, addStudentShift, removeStudentShift, addStudentShiftsForCourse } from "@/lib/actions";

// A learner's assignments inside their offering: the section (shift group) they
// sit in for each course kind, and the specific clinical shifts they are on —
// optionally on a specific physical asset. Server component with forms.

type Kind = { kind: string; sessions: number; sections: number };
type Course = { id: string; code: string | null; name: string; term: string; termId: string; kinds: Kind[]; clinicalSessions: { id: string; number: number; title: string | null; week: number | null; dayOfWeek: string | null; startTime: string | null; lengthHours: number; rotationType: string | null; sections: number; dateIso: string | null }[] };
type Section = { courseId: string; kind: string; sectionIndex: number };
type Shift = { id: string; sessionId: string; sectionIndex: number; note: string | null; course: { id: string; code: string | null; name: string }; session: { number: number; title: string | null; week: number | null; dayOfWeek: string | null; startTime: string | null; lengthHours: number; rotationType: string | null }; dateIso: string | null; asset: string | null };
type Asset = { id: string; label: string; settingCode: string };

const KIND_LABEL: Record<string, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };
const fmtDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "undated");

export function StudentAssignments({ studentId, cohort, courses, sections, shifts, assets, seat }: { studentId: string; cohort: { id: string; name: string; enrolled: number } | null; courses: Course[]; sections: Section[]; shifts: Shift[]; assets: Asset[]; seat: number }) {
  if (!cohort) return <p className="text-xs text-slate-400">Assign this learner to a cohort first — sections and clinical shifts belong to an offering.</p>;
  const sectionOf = (courseId: string, kind: string) => sections.find((s) => s.courseId === courseId && s.kind === kind)?.sectionIndex ?? 0;
  const byTerm = new Map<string, Course[]>(); for (const c of courses) { const l = byTerm.get(c.term) ?? []; l.push(c); byTerm.set(c.term, l); }
  const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Class, lab &amp; clinical sections — {cohort.name} · seat #{seat}</div>
        <p className="text-[11px] text-slate-400">Each course kind runs in as many sections as its capacity needs; choose which one this learner sits in (blank = not assigned; the default seat-order section is shown greyed).</p>
        <div className="mt-2 space-y-2">
          {[...byTerm.entries()].map(([term, cs]) => (
            <div key={term} className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{term}</div>
              <div className="divide-y divide-slate-100">
                {cs.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs">
                    <span className="w-64 font-medium text-slate-800">{c.code ? <span className="text-slate-400">{c.code} · </span> : null}{c.name}</span>
                    {c.kinds.map((k) => (
                      <form key={k.kind} action={setStudentSection.bind(null, studentId)} className="flex items-center gap-1">
                        <input type="hidden" name="cohortId" value={cohort.id} /><input type="hidden" name="courseId" value={c.id} /><input type="hidden" name="kind" value={k.kind} />
                        <span className="text-slate-500">{KIND_LABEL[k.kind]}</span>
                        <select name="sectionIndex" defaultValue={sectionOf(c.id, k.kind)} className={inp}>
                          <option value={0}>—</option>
                          {Array.from({ length: k.sections }, (_, i) => i + 1).map((s) => <option key={s} value={s}>section {s} of {k.sections}</option>)}
                        </select>
                        <button className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">set</button>
                      </form>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Clinical shifts — {shifts.length} assigned</div>
        <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Course · session</th><th className="px-2 py-1 text-left">Rotation</th><th className="px-2 py-1 text-right">Shift</th><th className="px-2 py-1 text-left">Asset</th><th className="px-2 py-1"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shifts.map((s) => <tr key={s.id}><td className="px-3 py-1 tabular-nums text-slate-700">{fmtDate(s.dateIso)}{s.session.startTime ? ` ${s.session.startTime}` : ""} · {s.session.lengthHours} h</td><td className="px-2 py-1 text-slate-800">{s.course.code ?? s.course.name} · #{s.session.number}{s.session.title ? ` ${s.session.title}` : ""}</td><td className="px-2 py-1 text-slate-600">{s.session.rotationType ?? "—"}</td><td className="px-2 py-1 text-right tabular-nums">{s.sectionIndex}</td><td className="px-2 py-1 text-slate-600">{s.asset ?? <span className="text-slate-300">any</span>}</td><td className="px-2 py-1 text-right"><form action={removeStudentShift.bind(null, s.id, studentId)}><button className="text-slate-300 hover:text-rose-600">✕</button></form></td></tr>)}
              {shifts.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-center text-slate-400">No clinical shifts yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {courses.some((c) => c.clinicalSessions.length) && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <form action={addStudentShiftsForCourse.bind(null, studentId)} className="flex flex-wrap items-end gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
              <input type="hidden" name="cohortId" value={cohort.id} />
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Every clinical shift of a course</span><select name="courseId" className={inp}>{courses.filter((c) => c.clinicalSessions.length).map((c) => <option key={c.id} value={c.id}>{c.code ?? c.name} ({c.clinicalSessions.length} shifts)</option>)}</select></label>
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Section</span><input name="sectionIndex" type="number" min="1" defaultValue={Math.max(1, Math.ceil(seat / 1))} className={inp + " w-16"} /></label>
              <button className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white">add all</button>
            </form>
            <form action={addStudentShift.bind(null, studentId)} className="flex flex-wrap items-end gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
              <input type="hidden" name="cohortId" value={cohort.id} />
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">One clinical shift</span>
                <select name="sessionId" className={inp + " max-w-[18rem]"}>{courses.flatMap((c) => c.clinicalSessions.map((s) => <option key={s.id} value={s.id}>{c.code ?? c.name} #{s.number} · {fmtDate(s.dateIso)}{s.rotationType ? ` · ${s.rotationType}` : ""}</option>))}</select></label>
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Section</span><input name="sectionIndex" type="number" min="1" defaultValue={1} className={inp + " w-14"} /></label>
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Asset (optional)</span><select name="assetId" className={inp + " max-w-[14rem]"}><option value="">any</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
              <button className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white">add</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
