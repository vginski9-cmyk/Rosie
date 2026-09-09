import Link from "next/link";
import { assignCourseStaffBulk, removeCourseStaff } from "@/lib/actions";

// Staffing for ONE offering: who covers this run, how loaded each person is
// under their workload policy (annual · semester · weekly · daily contact
// hours), and the fast path — one person on every session of a course — with
// shift-by-shift refinement on the design page. Server component.

type Sess = { id: string; lengthHours: number; kind: string; maxStudents: number; facultyNeeded: number; preceptorsNeeded: number; supportStaffNeeded: number };
type Course = { id: string; code: string | null; name: string; sessions: Sess[] };
type Term = { id: string; name: string; courses: Course[] };
type Assn = { id: string; personId: string; personName: string; role: string; contactHours: number; sectionIndex: number; sessionId: string; dateIso: string | null; courseCode: string | null; kind: string };
type PersonLite = { id: string; name: string; role: string; employmentType: string | null; title: string | null; employer: { name: string } | null };
type Load = { personId: string; name: string; role: string; employmentType: string | null; employer: string | null; policyLabel: string; contactHoursPerWeek: number; credit: number; total: number; credited: number; terms: { key: string; contactHours: number; fte: number }[]; years: { key: string; contactHours: number; fte: number }[]; peakWeek: { key: string; contactHours: number } | null; peakDay: { key: string; contactHours: number } | null; peakWeekLoad: number; overloadedWeeks: string[]; shifts: number };

const ROLES = ["instructor", "preceptor", "support", "supervisor", "coordinator"];
const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptor", support: "Support", supervisor: "Supervisor", coordinator: "Coordinator" };
const ROLE_BADGE: Record<string, string> = { instructor: "bg-rose-100 text-rose-700", preceptor: "bg-orange-100 text-orange-700", support: "bg-sky-100 text-sky-700", supervisor: "bg-violet-100 text-violet-700", coordinator: "bg-emerald-100 text-emerald-700" };
const h = (n: number, dp = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(dp));
const fte = (n: number) => n.toFixed(2);
const day = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function OfferingStaffing({ cohortId, programId, terms, assignments, people, loads, enrolled }: {
  cohortId: string; programId: string; terms: Term[]; assignments: Assn[]; people: PersonLite[]; loads: Load[]; enrolled: number;
}) {
  const sessionCourse = new Map<string, string>();
  for (const t of terms) for (const c of t.courses) for (const s of c.sessions) sessionCourse.set(s.id, c.id);
  const byCourse = new Map<string, Map<string, { name: string; role: string; hours: number; shifts: number }>>();
  for (const a of assignments) {
    const cid = sessionCourse.get(a.sessionId); if (!cid) continue;
    const m = byCourse.get(cid) ?? new Map(); byCourse.set(cid, m);
    const cur = m.get(a.personId) ?? { name: a.personName, role: a.role, hours: 0, shifts: 0 };
    cur.hours += a.contactHours; cur.shifts++; m.set(a.personId, cur);
  }
  // Coverage per course: required contact hours (every shift) vs assigned.
  const required = (c: Course) => c.sessions.reduce((n, s) => { const shifts = Math.max(1, Math.ceil(enrolled / Math.max(1, s.maxStudents))); return n + shifts * s.lengthHours * (s.facultyNeeded + s.preceptorsNeeded + s.supportStaffNeeded); }, 0);
  const assigned = (c: Course) => [...(byCourse.get(c.id)?.values() ?? [])].reduce((n, x) => n + x.hours, 0);
  const allCourses = terms.flatMap((t) => t.courses);
  const staffedCourses = allCourses.filter((c) => assigned(c) + 1e-6 >= required(c) && required(c) > 0).length;
  const totalReq = allCourses.reduce((n, c) => n + required(c), 0);
  const totalAsg = allCourses.reduce((n, c) => n + assigned(c), 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span><strong className="text-slate-700">{staffedCourses}/{allCourses.length}</strong> courses fully staffed · <strong className="text-slate-700">{h(totalAsg, 0)}</strong> of {h(totalReq, 0)} required contact hours assigned across {assignments.length} shift shares · {loads.length} people</span>
        <Link href={`/programs/${programId}/offerings/${cohortId}/design`} className="text-rose-600 hover:underline">refine any single shift on Design &amp; sequence →</Link>
      </div>

      {/* Load by person — under each person's workload policy */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-1.5 text-left">Person</th><th className="px-2 py-1.5 text-left">Policy</th><th className="px-2 py-1.5 text-right">This run<br /><span className="font-normal normal-case">contact h · credited work h</span></th><th className="px-2 py-1.5 text-left">By semester<br /><span className="font-normal normal-case">contact h · FTE of policy</span></th><th className="px-2 py-1.5 text-left">By year</th><th className="px-2 py-1.5 text-right">Peak week</th><th className="px-2 py-1.5 text-right">Peak day</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loads.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">Nobody assigned to this run yet — assign a person per course below, or shift by shift on the design page.</td></tr>}
            {loads.map((l) => (
              <tr key={l.personId} className="align-top">
                <td className="px-3 py-1.5"><div className="font-medium text-slate-800">{l.name}</div><div className="text-[10px] text-slate-400">{[ROLE_LABEL[l.role] ?? l.role, l.employmentType, l.employer].filter(Boolean).join(" · ")} · {l.shifts} shift{l.shifts === 1 ? "" : "s"}</div></td>
                <td className="px-2 py-1.5 text-slate-600">{l.policyLabel}<div className="text-[10px] text-slate-400">{h(l.contactHoursPerWeek)} contact h/wk full · ×{h(l.credit, 2)} credit</div></td>
                <td className="px-2 py-1.5 text-right tabular-nums"><strong>{h(l.total)}</strong> h · {h(l.credited)} h</td>
                <td className="px-2 py-1.5 tabular-nums text-slate-600">{l.terms.map((t) => `${t.key}: ${h(t.contactHours)} h (${fte(t.fte)})`).join(" · ")}</td>
                <td className="px-2 py-1.5 tabular-nums text-slate-600">{l.years.map((y) => `${y.key}: ${h(y.contactHours)} h (${fte(y.fte)})`).join(" · ")}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${l.overloadedWeeks.length ? "font-semibold text-amber-700" : ""}`}>{l.peakWeek ? `${h(l.peakWeek.contactHours)} h · wk of ${day(l.peakWeek.key)} · ${Math.round(l.peakWeekLoad * 100)}%` : "—"}{l.overloadedWeeks.length ? <div className="text-[10px]">⚠ {l.overloadedWeeks.length} week{l.overloadedWeeks.length === 1 ? "" : "s"} over policy</div> : null}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.peakDay ? `${h(l.peakDay.contactHours)} h · ${day(l.peakDay.key)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-course fast path */}
      <div className="space-y-3">
        {terms.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-700">{t.name}</div>
            <div className="space-y-2">
              {t.courses.map((c) => {
                const rows = [...(byCourse.get(c.id)?.entries() ?? [])];
                const req = required(c), asg = assigned(c);
                const maxSections = Math.max(1, ...c.sessions.map((s) => Math.ceil(enrolled / Math.max(1, s.maxStudents))));
                const kinds = [...new Set(c.sessions.map((s) => s.kind))];
                return (
                  <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">{c.code ? <span className="text-slate-400">{c.code} · </span> : null}{c.name}</div>
                      <span className={`text-[11px] ${asg + 1e-6 >= req && req > 0 ? "text-emerald-700" : asg > 0 ? "text-amber-700" : "text-slate-400"}`}>{h(asg, 0)} / {h(req, 0)} contact h · {c.sessions.length} sessions · up to {maxSections} shift{maxSections === 1 ? "" : "s"} each</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {rows.length === 0 && <span className="text-[12px] text-slate-300">unstaffed</span>}
                      {rows.map(([pid, info]) => (
                        <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ROLE_BADGE[info.role] ?? "bg-slate-200 text-slate-600"}`}>{ROLE_LABEL[info.role] ?? info.role}</span>
                          <span className="text-slate-700">{info.name}</span>
                          <span className="tabular-nums text-slate-400">{h(info.hours)} h · {info.shifts} shifts</span>
                          <form action={removeCourseStaff.bind(null, cohortId, c.id, pid, programId)}><button className="text-slate-300 hover:text-rose-600" title="remove from every session of this course">✕</button></form>
                        </span>
                      ))}
                    </div>
                    {people.length > 0 && (
                      <form action={assignCourseStaffBulk.bind(null, cohortId, c.id, programId)} className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                        <select name="personId" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          <option value="">assign a person…</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({ROLE_LABEL[p.role] ?? p.role}{p.employmentType ? `, ${p.employmentType}` : ""}{p.employer ? ` @ ${p.employer.name}` : ""})</option>)}
                        </select>
                        <select name="role" defaultValue={kinds.includes("CLINICAL") && kinds.length === 1 ? "preceptor" : "instructor"} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                        <select name="kind" defaultValue="" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          <option value="">every session</option>
                          {kinds.map((k) => <option key={k} value={k}>{k.toLowerCase()} sessions only</option>)}
                        </select>
                        <select name="sectionIndex" defaultValue="1" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          <option value="all">every shift</option>
                          {Array.from({ length: maxSections }, (_, i) => i + 1).map((n) => <option key={n} value={n}>shift {n}</option>)}
                        </select>
                        <button className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900">+ Assign for the whole course</button>
                        <span className="text-[10px] text-slate-400">full session length each; split or co-teach any shift on the design page</span>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
