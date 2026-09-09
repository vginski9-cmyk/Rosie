import Link from "next/link";
import { logShiftsThrough } from "@/lib/actions";
import type { getOfferingLedger } from "@/lib/queries";

// The offering's learner ledger: one row per student — sections they are missing,
// sections with no instructor, who teaches them this term, and their clinical
// hours (required · scheduled · logged · missed · short) with unprecepted
// shifts flagged — so the coordinator sees who is short or uncovered at a glance.

type Ledger = NonNullable<Awaited<ReturnType<typeof getOfferingLedger>>>;
const h1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function OfferingLedger({ ledger, programId }: { ledger: Ledger; programId: string }) {
  const active = ledger.students.filter((s) => s.status !== "withdrawn");
  const withdrawn = ledger.students.length - active.length;
  const short = active.filter((s) => s.shortHours > 0);
  const unprecepted = active.filter((s) => s.unprecepted > 0);
  const missingSec = active.filter((s) => s.missingSections.length > 0);
  const unstaffed = active.filter((s) => s.unstaffedSections.length > 0);
  const logged = active.reduce((n, s) => n + s.loggedHours, 0);
  const required = active.reduce((n, s) => n + s.requiredHours, 0);
  const pill = (n: number, label: string, tone: string) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${n > 0 ? tone : "bg-emerald-100 text-emerald-700"}`}>{n > 0 ? `⚠ ${n} ${label}` : `✓ no one ${label}`}</span>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span><span className="font-semibold text-slate-800">{active.length}</span> enrolled{withdrawn > 0 && <span className="text-slate-400"> · {withdrawn} withdrawn</span>}</span>
        <span className="text-slate-300">·</span>
        <span><span className="font-semibold tabular-nums text-emerald-700">{h1(logged)}</span> of {h1(required)} clinical hours logged across the offering{ledger.currentTerm ? ` · now in ${ledger.currentTerm.name}` : ""}</span>
        {pill(short.length, "short of clinical hours", "bg-rose-100 text-rose-700")}
        {pill(unprecepted.length, "with unprecepted shifts", "bg-amber-100 text-amber-700")}
        {pill(missingSec.length, "missing a section", "bg-amber-100 text-amber-700")}
        {pill(unstaffed.length, "in a section with no instructor", "bg-amber-100 text-amber-700")}
        <form action={logShiftsThrough.bind(null, ledger.cohortId, null)} className="ml-auto flex items-center gap-1">
          <label className="text-[10px] uppercase tracking-wide text-slate-400">Log every scheduled shift through</label>
          <input name="through" type="date" defaultValue={ledger.today} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
          <button className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-white">log as completed</button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left">Student</th>
              <th className="px-2 py-1.5 text-left">Instructors this term</th>
              <th className="px-2 py-1.5 text-right">Attendance</th>
              {ledger.clinicalCourses.map((c) => <th key={c.id} className="px-2 py-1.5 text-right" title={`${c.name} · ${c.term} · ${c.requiredHours > 0 ? `${h1(c.requiredHours)} h required` : c.requiredCases > 0 ? `${c.requiredCases} cases required` : "no coded requirement"}`}>{c.code ?? c.name}<span className="block font-normal normal-case text-slate-400">{c.requiredHours > 0 ? `${h1(c.requiredHours)} h req.` : c.requiredCases > 0 ? `${c.requiredCases} cases` : "—"}</span></th>)}
              <th className="px-2 py-1.5 text-right">Logged / required</th>
              <th className="px-2 py-1.5 text-right">Short</th>
              <th className="px-2 py-1.5 text-left">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ledger.students.map((s) => {
              const gone = s.status === "withdrawn";
              return (
                <tr key={s.id} className={gone ? "text-slate-400" : s.shortHours > 0 ? "bg-rose-50/40" : ""}>
                  <td className="px-3 py-1.5"><Link href={`/students/${s.id}`} className={`font-medium hover:text-rose-700 hover:underline ${gone ? "" : "text-slate-800"}`}>{s.name}</Link><span className="block text-[10px] text-slate-400">seat #{s.seat}{gone ? " · withdrawn" : ""}</span></td>
                  <td className="px-2 py-1.5 text-slate-600">{gone ? "—" : s.instructors.length ? s.instructors.slice(0, 3).join(", ") + (s.instructors.length > 3 ? ` +${s.instructors.length - 3}` : "") : <span className="text-amber-600">none</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{gone ? "—" : <>{s.attended}<span className="text-slate-400"> / {s.attended + s.missed}</span>{s.missed > 0 && <span className="block text-[10px] text-rose-600">{s.missed} missed</span>}</>}</td>
                  {s.clinical.map((c) => (
                    <td key={c.courseId} className="px-2 py-1.5 text-right tabular-nums" title={`${c.site ?? "site TBD"}${c.preceptors.length ? ` · ${c.preceptors.join(", ")}` : ""} · ${c.shifts} shifts · ${c.done} done`}>
                      {gone ? "—" : c.shifts === 0 ? <span className="text-amber-600">no shifts</span> : <>
                        <span className={c.logged > 0 ? "font-semibold text-emerald-700" : "text-slate-500"}>{h1(c.logged)}</span><span className="text-slate-400"> / {h1(c.scheduled)}</span>
                        <span className="block text-[10px] text-slate-400">{c.site ? c.site.split(" — ")[0].slice(0, 22) : <span className="text-amber-600">site TBD</span>}{c.missed > 0 && <span className="text-rose-600"> · {c.missed} missed</span>}{c.unprecepted > 0 && <span className="text-amber-600"> · {c.unprecepted} no preceptor</span>}</span>
                      </>}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right tabular-nums">{gone ? "—" : <><span className="font-semibold text-emerald-700">{h1(s.loggedHours)}</span><span className="text-slate-400"> / {h1(s.requiredHours)} h</span></>}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${gone ? "" : s.shortHours > 0 ? "text-rose-600" : "text-emerald-700"}`}>{gone ? "—" : s.shortHours > 0 ? `${h1(s.shortHours)} h` : "✓"}</td>
                  <td className="px-2 py-1.5 text-[10px]">
                    {!gone && s.missingSections.length > 0 && <span className="mr-1 rounded bg-amber-50 px-1 text-amber-700" title={s.missingSections.join(", ")}>no section: {s.missingSections.slice(0, 2).join(", ")}{s.missingSections.length > 2 ? ` +${s.missingSections.length - 2}` : ""}</span>}
                    {!gone && s.unstaffedSections.length > 0 && <span className="mr-1 rounded bg-amber-50 px-1 text-amber-700" title={s.unstaffedSections.join(", ")}>no instructor: {s.unstaffedSections.slice(0, 2).join(", ")}{s.unstaffedSections.length > 2 ? ` +${s.unstaffedSections.length - 2}` : ""}</span>}
                    {!gone && s.missingSections.length === 0 && s.unstaffedSections.length === 0 && s.unprecepted === 0 && s.shortHours === 0 && <span className="text-emerald-700">✓ covered</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">Each clinical column reads logged / scheduled hours for that course, with the site the section is booked at. Open a student for the shift-by-shift log and the requirement by service area. <Link href={`/programs/${programId}/students`} className="text-rose-600 hover:underline">Program roster →</Link></p>
    </div>
  );
}
