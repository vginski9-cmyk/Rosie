import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployer } from "@/lib/queries";
import { updateEmployer, updatePlacementStatus, deletePlacement } from "@/lib/actions";

export const dynamic = "force-dynamic";

const EMP_STATUSES = ["prospect", "active", "paused", "archived"];
const PLACEMENT_NEXT: Record<string, string[]> = {
  planned: ["active", "cancelled"], active: ["completed", "cancelled"], completed: [], cancelled: ["planned"],
};
const PSTATUS_BADGE: Record<string, string> = {
  planned: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700",
  completed: "bg-slate-200 text-slate-600", cancelled: "bg-slate-100 text-slate-400",
};
const dateFmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

export default async function EmployerPage({ params }: { params: { id: string } }) {
  const e = await getEmployer(params.id);
  if (!e) notFound();

  // WBL capacity is read from placement records, not a static slot count: "asked"
  // = every non-cancelled rotation directed here; "secured" = active + completed.
  const seasonOf = (d: Date) => { const m = d.getUTCMonth(); return m >= 7 ? "Fall" : m >= 5 ? "Summer" : "Spring"; };
  const live = e.placements.filter((p) => p.status !== "cancelled");
  const asked = live.length;
  const secured = e.placements.filter((p) => p.status === "active" || p.status === "completed").length;
  const fillRate = asked > 0 ? Math.round((secured / asked) * 100) : 0;
  const periodMap: Record<string, { year: number; season: string; asked: number; secured: number }> = {};
  for (const p of live) {
    if (!p.startDate) continue;
    const d = new Date(p.startDate);
    const key = `${d.getUTCFullYear()} ${seasonOf(d)}`;
    const b = periodMap[key] ?? { year: d.getUTCFullYear(), season: seasonOf(d), asked: 0, secured: 0 };
    b.asked += 1; if (p.status === "active" || p.status === "completed") b.secured += 1; periodMap[key] = b;
  }
  const periods = Object.values(periodMap).sort((a, b) => b.year - a.year || a.season.localeCompare(b.season));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link href="/employers" className="text-sm text-slate-500 hover:text-slate-700">← Employer partners</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
            <p className="text-sm text-slate-500">
              {[e.setting, e.city, e.institution.name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{e.status}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${fillRate >= 90 ? "bg-emerald-100 text-emerald-700" : fillRate >= 70 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
              {secured} of {asked} rotations secured ({fillRate}%)
            </span>
          </div>
        </div>
      </div>

      {/* WBL capacity — sourced from placement records, by year & semester */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">WBL rotations — asked vs secured</h2>
        <p className="mt-0.5 text-xs text-slate-400">Read live from placement records — what programs asked this partner to host vs what was actually secured. No static slot count, because real availability shifts week to week.</p>
        {periods.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No dated rotations yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {periods.map((p) => {
              const gap = p.asked > p.secured;
              return (
                <div key={`${p.year}-${p.season}`} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-[11px] font-medium text-slate-500">{p.season} {p.year}</div>
                  <div className="mt-0.5 text-sm tabular-nums">
                    <span className={gap ? "font-semibold text-amber-600" : "text-emerald-600"}>{p.secured}</span>
                    <span className="text-slate-400"> / {p.asked} secured</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Contact + details (editable) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Partner details</h2>
        <form action={updateEmployer.bind(null, e.id)} className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="name" label="Name" defaultValue={e.name} required />
          <Field name="setting" label="Setting" defaultValue={e.setting} />
          <Field name="city" label="City" defaultValue={e.city} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
            <select name="status" defaultValue={e.status} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {EMP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Field name="contactName" label="Contact name" defaultValue={e.contactName} />
          <Field name="contactEmail" label="Contact email" type="email" defaultValue={e.contactEmail} />
          <Field name="contactPhone" label="Contact phone" defaultValue={e.contactPhone} />
          <label className="block sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Notes</span>
            <textarea name="notes" defaultValue={e.notes ?? ""} rows={2} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <div className="lg:col-span-4">
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save details</button>
          </div>
        </form>
      </section>

      {/* Partner alignment intake */}
      <Link href={`/employers/${e.id}/alignment`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-rose-200 hover:bg-rose-50/40">
        <div>
          <div className="text-sm font-semibold text-slate-800">Partner alignment intake ↦</div>
          <div className="text-xs text-slate-500">what this partner actually wants from hosting · hosting constraints · real capacities → hostable WBL modes</div>
        </div>
        <span className="text-rose-600">→</span>
      </Link>

      {/* Placements hosted here */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Placements <span className="text-sm font-normal text-slate-400">— students hosted here</span></h2>
          <span className="text-xs text-slate-400">{e.placements.length} total · {secured} secured</span>
        </div>
        {e.placements.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No placements yet. Assign a student from their profile&apos;s WBL placement section.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left font-semibold">Student</th>
                  <th className="px-3 py-2 text-left font-semibold">Cohort / term</th>
                  <th className="px-3 py-2 text-left font-semibold">Window</th>
                  <th className="px-3 py-2 text-left font-semibold">Modality</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {e.placements.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link href={`/students/${p.student.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.student.name}</Link>
                      <span className="block text-[11px] text-slate-400">{p.student.program.name}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{[p.cohort?.name, p.term?.name].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{p.startDate || p.endDate ? `${dateFmt(p.startDate)} → ${dateFmt(p.endDate)}` : "—"}{p.hoursPerWeek ? ` · ${p.hoursPerWeek}h/wk` : ""}</td>
                    <td className="px-3 py-2 text-slate-500">{p.modality ?? "—"}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PSTATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"}`}>{p.status}</span></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {(PLACEMENT_NEXT[p.status] ?? []).map((s) => (
                          <form key={s} action={updatePlacementStatus.bind(null, p.id, s)}>
                            <button className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">→ {s}</button>
                          </form>
                        ))}
                        <form action={deletePlacement.bind(null, p.id)}>
                          <button className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-rose-600" title="remove placement">✕</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ name, label, defaultValue, type = "text", required }: { name: string; label: string; defaultValue?: string | null; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input name={name} type={type} required={required} defaultValue={defaultValue ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
    </label>
  );
}
