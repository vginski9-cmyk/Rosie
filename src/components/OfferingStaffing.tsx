import { assignCourseStaff, removeCourseStaff } from "@/lib/actions";

// Per-instantiation staffing: who covers each course for THIS cohort, with coverage
// and time-bound (per-term, per-person) contact-hour rollups. Server component —
// assign/remove via server actions, no client state needed.

type Sess = { id: string; lengthHours: number; kind: string };
type Course = { id: string; code: string | null; name: string; sessions: Sess[] };
type Term = { id: string; name: string; courses: Course[] };
type StaffRow = { id: string; role: string; contactHours: number; person: { id: string; name: string; role: string }; session: { id: string; courseId: string } };
type PersonLite = { id: string; name: string; role: string };

const ROLES = ["instructor", "preceptor", "support", "supervisor", "coordinator"];
const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptor", support: "Support", supervisor: "Supervisor", coordinator: "Coordinator" };
const ROLE_BADGE: Record<string, string> = {
  instructor: "bg-rose-100 text-rose-700", preceptor: "bg-orange-100 text-orange-700", support: "bg-sky-100 text-sky-700",
  supervisor: "bg-violet-100 text-violet-700", coordinator: "bg-emerald-100 text-emerald-700",
};

export function OfferingStaffing({ cohortId, programId, terms, staff, people }: {
  cohortId: string; programId: string; terms: Term[]; staff: StaffRow[]; people: PersonLite[];
}) {
  // Per-course assigned people (distinct, with summed hours for this cohort).
  const byCourse = new Map<string, Map<string, { name: string; role: string; hours: number }>>();
  for (const s of staff) {
    const cid = s.session.courseId;
    if (!byCourse.has(cid)) byCourse.set(cid, new Map());
    const m = byCourse.get(cid)!;
    const cur = m.get(s.person.id) ?? { name: s.person.name, role: s.role, hours: 0 };
    cur.hours += s.contactHours;
    m.set(s.person.id, cur);
  }

  // Analytics: coverage + per-term + per-person hours.
  const allCourses = terms.flatMap((t) => t.courses);
  const covered = allCourses.filter((c) => (byCourse.get(c.id)?.size ?? 0) > 0).length;
  const courseTerm = new Map<string, string>();
  for (const t of terms) for (const c of t.courses) courseTerm.set(c.id, t.name);
  const byTerm = new Map<string, number>();
  const byPerson = new Map<string, { name: string; hours: number }>();
  for (const s of staff) {
    const term = courseTerm.get(s.session.courseId) ?? "—";
    byTerm.set(term, (byTerm.get(term) ?? 0) + s.contactHours);
    const cur = byPerson.get(s.person.id) ?? { name: s.person.name, hours: 0 };
    cur.hours += s.contactHours;
    byPerson.set(s.person.id, cur);
  }
  const totalHours = staff.reduce((n, s) => n + s.contactHours, 0);
  const topPeople = [...byPerson.values()].sort((a, b) => b.hours - a.hours);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Staffing <span className="text-sm font-normal text-slate-400">— who covers this run</span></h2>
        <span className="text-xs text-slate-400">{covered}/{allCourses.length} courses staffed · {Math.round(totalHours)} contact hrs assigned</span>
      </div>

      {/* Time-bound analytics */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Assigned hours by term</div>
          {byTerm.size === 0 ? <p className="mt-1 text-xs text-slate-400">No staff assigned yet.</p> : (
            <div className="mt-2 space-y-1.5">
              {terms.filter((t) => byTerm.has(t.name)).map((t) => {
                const h = byTerm.get(t.name)!; const max = Math.max(1, ...[...byTerm.values()]);
                return (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-slate-500">{t.name}</span>
                    <span className="h-2 rounded-full bg-rose-300" style={{ width: `${(h / max) * 120}px` }} />
                    <span className="tabular-nums text-slate-600">{Math.round(h)}h</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Load by person</div>
          {topPeople.length === 0 ? <p className="mt-1 text-xs text-slate-400">No staff assigned yet.</p> : (
            <div className="mt-2 space-y-1">
              {topPeople.slice(0, 6).map((p) => (
                <div key={p.name} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{p.name}</span>
                  <span className="tabular-nums text-slate-500">{Math.round(p.hours)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-course assignment */}
      <div className="space-y-3">
        {terms.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">{t.name}</div>
            <div className="space-y-2">
              {t.courses.map((c) => {
                const assigned = [...(byCourse.get(c.id)?.entries() ?? [])];
                const hrs = c.sessions.reduce((n, s) => n + s.lengthHours, 0);
                return (
                  <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">{c.code ? <span className="text-slate-400">{c.code} · </span> : null}{c.name}</div>
                      <span className="text-[11px] text-slate-400">{c.sessions.length} sessions · {Math.round(hrs)}h each</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {assigned.length === 0 && <span className="text-[12px] text-slate-300">unstaffed</span>}
                      {assigned.map(([pid, info]) => (
                        <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ROLE_BADGE[info.role] ?? "bg-slate-200 text-slate-600"}`}>{ROLE_LABEL[info.role] ?? info.role}</span>
                          <span className="text-slate-700">{info.name}</span>
                          <span className="text-slate-400">{Math.round(info.hours)}h</span>
                          <form action={removeCourseStaff.bind(null, cohortId, c.id, pid, programId)}><button className="text-slate-300 hover:text-rose-600" title="remove">✕</button></form>
                        </span>
                      ))}
                    </div>
                    {people.length > 0 && (
                      <form action={assignCourseStaff.bind(null, cohortId, c.id, programId)} className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                        <select name="personId" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          <option value="">assign person…</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({ROLE_LABEL[p.role] ?? p.role})</option>)}
                        </select>
                        <select name="role" defaultValue="instructor" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                        <button className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900">+ Assign to course</button>
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
