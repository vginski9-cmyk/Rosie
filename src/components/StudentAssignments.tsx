import { setStudentSection, addStudentShift, removeStudentShift, addStudentShiftsForCourse, logStudentShift, logShiftsThrough } from "@/lib/actions";
import { dec } from "@/lib/format";

// A learner's assignments inside their offering: the section (shift group) they
// sit in for each course kind — and who teaches / precepts that section — the
// clinical hours ledger per course (required by the family's requirement grid,
// scheduled on shifts, logged, missed, still to come, short), and the shift log
// itself: every clinical shift with its date, site, preceptor, hours and status,
// logged in place. Server component with forms.

type Kind = { kind: string; sessions: number; sections: number; needsPreceptor: boolean };
type Required = { code: string; name: string; settingCodes: string[]; hours: number; cases: number | null };
type Course = { id: string; code: string | null; name: string; term: string; termId: string; kinds: Kind[]; clinicalSessions: { id: string; number: number; title: string | null; week: number | null; dayOfWeek: string | null; startTime: string | null; lengthHours: number; rotationType: string | null; sections: number; dateIso: string | null }[]; required: Required[] };
type Section = { courseId: string; kind: string; sectionIndex: number };
type Staff = { courseId: string; kind: string; sectionIndex: number; people: { id: string; name: string; role: string; shifts: number }[] };
type Shift = {
  id: string; sessionId: string; sectionIndex: number; note: string | null; course: { id: string; code: string | null; name: string };
  session: { number: number; title: string | null; week: number | null; dayOfWeek: string | null; startTime: string | null; lengthHours: number; rotationType: string | null; preceptorsNeeded: number };
  dateIso: string | null; asset: string | null; site: string | null; status: "scheduled" | "completed" | "absent" | "excused"; hoursLogged: number | null; loggedAt: string | null; settingCode: string | null; preceptor: { id: string; name: string } | null;
};
type Asset = { id: string; label: string; settingCode: string };

const KIND_LABEL: Record<string, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };
const STATUS_BADGE: Record<string, string> = { scheduled: "bg-sky-100 text-sky-700", completed: "bg-emerald-100 text-emerald-700", absent: "bg-rose-100 text-rose-700", excused: "bg-amber-100 text-amber-700" };
const fmtDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "undated");
const h1 = (n: number) => dec(n);

export function StudentAssignments({ studentId, cohort, courses, sections, staff, shifts, assets, seat, today }: { studentId: string; cohort: { id: string; name: string; enrolled: number } | null; courses: Course[]; sections: Section[]; staff: Staff[]; shifts: Shift[]; assets: Asset[]; seat: number; today: string }) {
  if (!cohort) return <p className="text-xs text-slate-400">Assign this learner to a cohort first — sections and clinical shifts belong to an offering.</p>;
  const sectionOf = (courseId: string, kind: string) => sections.find((s) => s.courseId === courseId && s.kind === kind)?.sectionIndex ?? 0;
  const staffOf = (courseId: string, kind: string) => staff.find((s) => s.courseId === courseId && s.kind === kind)?.people ?? [];
  const byTerm = new Map<string, Course[]>(); for (const c of courses) { const l = byTerm.get(c.term) ?? []; l.push(c); byTerm.set(c.term, l); }
  const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";

  // ── Hours ledger per clinical course ──
  const clinicalCourses = courses.filter((c) => c.clinicalSessions.length > 0);
  const ledger = clinicalCourses.map((c) => {
    const mine = shifts.filter((s) => s.course.id === c.id);
    const scheduled = mine.reduce((n, s) => n + s.session.lengthHours, 0);
    const logged = mine.reduce((n, s) => n + (s.status === "completed" ? s.hoursLogged ?? 0 : 0), 0);
    const missedShifts = mine.filter((s) => s.status === "absent" || s.status === "excused");
    const missedHours = missedShifts.reduce((n, s) => n + s.session.lengthHours, 0);
    const toCome = mine.filter((s) => s.status === "scheduled").reduce((n, s) => n + s.session.lengthHours, 0);
    const required = c.required.reduce((n, r) => n + r.hours, 0);
    const cases = c.required.reduce((n, r) => n + (r.cases ?? 0), 0);
    const short = Math.max(0, required - logged - toCome);
    // Hours by setting: what has been logged / is scheduled against each area the grid asks for.
    const bySetting = new Map<string, { logged: number; scheduled: number }>();
    for (const s of mine) { const k = s.settingCode ?? "?"; const cur = bySetting.get(k) ?? { logged: 0, scheduled: 0 }; if (s.status === "completed") cur.logged += s.hoursLogged ?? 0; else if (s.status === "scheduled") cur.scheduled += s.session.lengthHours; bySetting.set(k, cur); }
    const areas = c.required.filter((r) => r.hours > 0).map((r) => { let l = 0, sc = 0; for (const code of r.settingCodes) { const v = bySetting.get(code); if (v) { l += v.logged; sc += v.scheduled; } } return { ...r, logged: l, scheduled: sc }; });
    const unprecepted = mine.filter((s) => s.session.preceptorsNeeded > 0 && !s.preceptor).length;
    const site = mine.find((s) => s.site)?.site ?? null;
    const preceptors = [...new Set(mine.map((s) => s.preceptor?.name).filter((x): x is string => !!x))];
    return { c, mine, scheduled, logged, missedShifts: missedShifts.length, missedHours, toCome, required, cases, short, areas, unprecepted, site, preceptors };
  });
  const totals = ledger.reduce((a, l) => ({ required: a.required + l.required, scheduled: a.scheduled + l.scheduled, logged: a.logged + l.logged, toCome: a.toCome + l.toCome, short: a.short + l.short, missed: a.missed + l.missedShifts }), { required: 0, scheduled: 0, logged: 0, toCome: 0, short: 0, missed: 0 });
  const pastScheduled = shifts.filter((s) => s.status === "scheduled" && s.dateIso && s.dateIso <= today).length;

  return (
    <div className="space-y-5">
      {/* ── Sections & who staffs them ── */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Class, lab &amp; clinical sections — {cohort.name} · seat #{seat}</div>
        <p className="text-[11px] text-slate-400">Each course kind runs in as many sections as its capacity needs; choose which one this learner sits in. The people shown are the instructors (class / lab) and preceptors (clinical) assigned to that section's shifts.</p>
        <div className="mt-2 space-y-2">
          {[...byTerm.entries()].map(([term, cs]) => (
            <div key={term} className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{term}</div>
              <div className="divide-y divide-slate-100">
                {cs.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-1.5 text-xs">
                    <span className="w-64 shrink-0 font-medium text-slate-800">{c.code ? <span className="text-slate-400">{c.code} · </span> : null}{c.name}</span>
                    {c.kinds.map((k) => {
                      const people = staffOf(c.id, k.kind);
                      const sec = sectionOf(c.id, k.kind);
                      return (
                        <div key={k.kind} className="flex flex-col gap-0.5">
                          <form action={setStudentSection.bind(null, studentId)} className="flex items-center gap-1">
                            <input type="hidden" name="cohortId" value={cohort.id} /><input type="hidden" name="courseId" value={c.id} /><input type="hidden" name="kind" value={k.kind} />
                            <span className="text-slate-500">{KIND_LABEL[k.kind]}</span>
                            <select name="sectionIndex" defaultValue={sec} className={inp}>
                              <option value={0}>—</option>
                              {Array.from({ length: k.sections }, (_, i) => i + 1).map((s) => <option key={s} value={s}>section {s} of {k.sections}</option>)}
                            </select>
                            <button className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">set</button>
                          </form>
                          {sec > 0 && (
                            <span className="text-[10px] text-slate-500">
                              {people.length === 0
                                ? (k.kind === "CLINICAL" && !k.needsPreceptor ? <span className="text-slate-400">faculty-supervised — the sheet needs no preceptor</span> : <span className="text-amber-600">⚠ no {k.kind === "CLINICAL" ? "preceptor" : "instructor"} assigned to §{sec}</span>)
                                : people.slice(0, 3).map((p) => `${p.name} (${p.role}${p.shifts > 1 ? ` · ${p.shifts} shifts` : ""})`).join(", ") + (people.length > 3 ? ` +${people.length - 3}` : "")}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Clinical hours ledger ── */}
      {ledger.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Clinical hours ledger</div>
              <p className="text-[11px] text-slate-400">Required = the family's requirement grid (hours per service area per student). Scheduled = the shifts this learner is on. Logged = completed shifts. Short = required beyond what is logged plus still scheduled — the number that has to change.</p>
            </div>
            <div className="text-right text-xs">
              <div><span className="font-semibold tabular-nums text-slate-800">{h1(totals.logged)}</span> <span className="text-slate-500">of {h1(totals.required)} h logged</span> · <span className="tabular-nums text-sky-700">{h1(totals.toCome)} h to come</span>{totals.missed > 0 && <> · <span className="text-rose-600">{totals.missed} missed</span></>}</div>
              {totals.short > 0 ? <div className="font-semibold text-rose-600">⚠ {h1(totals.short)} h short of the requirement</div> : <div className="text-emerald-700">on track — scheduled shifts cover the requirement</div>}
            </div>
          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-1 text-left">Course</th><th className="px-2 py-1 text-left">Site · preceptors</th><th className="px-2 py-1 text-right">Required</th><th className="px-2 py-1 text-right">Scheduled</th><th className="px-2 py-1 text-right">Logged</th><th className="px-2 py-1 text-right">To come</th><th className="px-2 py-1 text-right">Missed</th><th className="px-2 py-1 text-right">Short</th><th className="px-2 py-1 text-left">By service area (logged / scheduled of required)</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((l) => (
                  <tr key={l.c.id} className={l.short > 0 ? "bg-rose-50/40" : ""}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{l.c.code ?? l.c.name}<span className="block text-[10px] font-normal text-slate-400">{l.c.term} · {l.mine.length} shifts{l.unprecepted > 0 && <span className="text-amber-600"> · ⚠ {l.unprecepted} without a preceptor</span>}</span></td>
                    <td className="px-2 py-1.5 text-slate-600">{l.site ?? <span className="text-amber-600">site TBD</span>}{l.preceptors.length > 0 && <span className="block text-[10px] text-slate-400">{l.preceptors.join(", ")}</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.required > 0 ? `${h1(l.required)} h` : l.cases > 0 ? `${l.cases} cases` : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{h1(l.scheduled)} h</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{h1(l.logged)} h</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-sky-700">{h1(l.toCome)} h</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${l.missedShifts ? "text-rose-600" : "text-slate-400"}`}>{l.missedShifts ? `${l.missedShifts} (${h1(l.missedHours)} h)` : "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${l.short > 0 ? "text-rose-600" : "text-emerald-700"}`}>{l.short > 0 ? `${h1(l.short)} h` : "✓"}</td>
                    <td className="px-2 py-1.5 text-[10px] text-slate-500">{l.areas.length ? l.areas.map((a) => <span key={a.code} className={`mr-1 inline-block rounded px-1 ${a.logged + a.scheduled >= a.hours ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`} title={a.name}>{a.code} {h1(a.logged)}/{h1(a.scheduled)} of {h1(a.hours)}</span>) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── The shift log ── */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Clinical shift log — {shifts.length} shifts · {shifts.filter((s) => s.status === "completed").length} completed · {shifts.filter((s) => s.status === "scheduled").length} scheduled</div>
          {pastScheduled > 0 && (
            <form action={logShiftsThrough.bind(null, cohort.id, studentId)} className="flex items-center gap-1 text-[11px]">
              <span className="text-amber-700">⚠ {pastScheduled} past shift{pastScheduled === 1 ? "" : "s"} not logged</span>
              <input type="hidden" name="through" value={today} />
              <button className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-white">log all through today as completed</button>
            </form>
          )}
        </div>
        <div className="mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Course · session</th><th className="px-2 py-1 text-left">Setting</th><th className="px-2 py-1 text-left">Site · asset</th><th className="px-2 py-1 text-left">Preceptor</th><th className="px-2 py-1 text-left">Status · hours</th><th className="px-2 py-1 text-left">Log</th><th className="px-2 py-1"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shifts.map((s) => {
                const past = !!s.dateIso && s.dateIso <= today;
                return (
                  <tr key={s.id} className={s.status === "scheduled" && past ? "bg-amber-50/40" : ""}>
                    <td className="px-3 py-1 tabular-nums text-slate-700">{fmtDate(s.dateIso)}{s.session.startTime ? ` ${s.session.startTime}` : ""} · {s.session.lengthHours} h</td>
                    <td className="px-2 py-1 text-slate-800">{s.course.code ?? s.course.name} #{s.session.number}{s.session.title ? <span className="text-slate-400"> · {s.session.title}</span> : null}<span className="block text-[10px] text-slate-400">section {s.sectionIndex}</span></td>
                    <td className="px-2 py-1 text-slate-600">{s.settingCode ?? "—"}<span className="block text-[10px] text-slate-400">{s.session.rotationType ?? ""}</span></td>
                    <td className="px-2 py-1 text-slate-600">{s.asset ?? s.site ?? <span className="text-amber-600">site TBD</span>}</td>
                    <td className="px-2 py-1 text-slate-600">{s.preceptor ? s.preceptor.name : s.session.preceptorsNeeded > 0 ? <span className="text-amber-600">⚠ none assigned</span> : <span className="text-slate-400">faculty-supervised</span>}</td>
                    <td className="px-2 py-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[s.status]}`}>{s.status}</span>{s.status === "completed" && <span className="ml-1 tabular-nums text-emerald-700">{h1(s.hoursLogged ?? 0)} h</span>}{s.loggedAt && s.status !== "scheduled" && <span className="block text-[10px] text-slate-400">logged {fmtDate(s.loggedAt)}</span>}</td>
                    <td className="px-2 py-1">
                      <form action={logStudentShift.bind(null, s.id, studentId)} className="flex items-center gap-1">
                        <select name="status" defaultValue={s.status} className={inp}>{["scheduled", "completed", "absent", "excused"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
                        <input name="hours" type="number" step="any" min="0" placeholder={String(s.session.lengthHours)} defaultValue={s.status === "completed" && s.hoursLogged != null && s.hoursLogged !== s.session.lengthHours ? s.hoursLogged : ""} className={inp + " w-16"} title="hours credited (blank = the session length)" />
                        <input type="hidden" name="date" value={s.dateIso ?? ""} />
                        <button className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">log</button>
                      </form>
                    </td>
                    <td className="px-2 py-1 text-right"><form action={removeStudentShift.bind(null, s.id, studentId)}><button className="text-slate-300 hover:text-rose-600" title="remove this learner from the shift">✕</button></form></td>
                  </tr>
                );
              })}
              {shifts.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-center text-slate-400">No clinical shifts yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {courses.some((c) => c.clinicalSessions.length) && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <form action={addStudentShiftsForCourse.bind(null, studentId)} className="flex flex-wrap items-end gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
              <input type="hidden" name="cohortId" value={cohort.id} />
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Every clinical shift of a course</span><select name="courseId" className={inp}>{courses.filter((c) => c.clinicalSessions.length).map((c) => <option key={c.id} value={c.id}>{c.code ?? c.name} · {c.clinicalSessions.length} shifts</option>)}</select></label>
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
