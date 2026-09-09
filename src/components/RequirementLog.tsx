import { Fragment } from "react";
import Link from "next/link";
import { logRequirement, deleteRequirementLog, verifyRequirementLog } from "@/lib/actions";
import type { getStudentRequirementProgress } from "@/lib/queries";
import { dec } from "@/lib/format";

// ONE STUDENT'S STANDING against the credentialing body's list, and the log that feeds
// it: every rule with a bar, every item with its state, the entry form, the entries, and
// — for what is still missing — the secured sites that provide it. Server component.

type Data = NonNullable<Awaited<ReturnType<typeof getStudentRequirementProgress>>>;
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
const lbl = "block text-[9px] font-semibold uppercase tracking-wide text-slate-500";
const fmtDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" }) : "—");

export function RequirementLog({ data }: { data: Data }) {
  if (!data.sets.length) return <p className="text-xs text-slate-400">No requirement set is loaded for {data.family.name}.</p>;
  return (
    <div className="space-y-6">
      {data.sets.map((set) => {
        const pr = set.progress;
        const cases = set.kind === "cases";
        const cats: string[] = []; for (const it of pr.items) if (!cats.includes(it.item.category)) cats.push(it.item.category);
        const counted = pr.rules.filter((r) => r.min != null || r.max != null);
        return (
          <div key={set.id} className="space-y-4">
            {/* Rules — the bars that say whether this student can graduate */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{set.name} <span className="font-normal text-slate-500">— {set.authority}</span></div>
                <div className="text-[11px] text-slate-500">{set.edition}{!set.verified && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">starter content — verify the list</span>}</div>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${pr.complete ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{pr.complete ? "✓ requirements complete" : `${Math.round(pr.pct * 100)}% of the way`}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {counted.map((r) => {
                const target = r.min ?? r.max ?? 0;
                const pct = r.max != null && r.min == null ? Math.min(1, r.have / Math.max(1, r.max)) : Math.min(1, r.have / Math.max(1, target));
                const tone = r.ok ? (r.min != null && r.have >= r.min ? "bg-emerald-500" : "bg-sky-400") : "bg-rose-500";
                return (
                  <div key={r.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-baseline justify-between text-xs"><span className="font-medium text-slate-800">{r.label}</span><span className="tabular-nums text-slate-600">{r.have}{r.min != null ? ` / ${r.min}` : r.max != null ? ` (max ${r.max})` : ""}{r.of != null && r.of !== r.min ? <span className="text-slate-400"> of {r.of}</span> : null}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${tone}`} style={{ width: `${Math.round(pct * 100)}%` }} /></div>
                    {(r.note || !r.ok) && <div className={`mt-0.5 text-[10px] ${r.ok ? "text-slate-400" : "text-rose-600"}`}>{r.ok ? r.note : r.note ?? `${r.min! - r.have} more needed`}</div>}
                  </div>
                );
              })}
            </div>

            {/* Where to get what is missing — the allocation question, answered per student */}
            {(pr.missingRequired.length > 0 || pr.missingElective.length > 0) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
                <div className="font-semibold text-slate-800">Still missing: {pr.missingRequired.length} required{cases ? " category" : ""}{pr.missingRequired.length === 1 ? "" : cases ? " categories" : ""} · {pr.missingElective.length} elective{pr.missingElective.length === 1 ? "" : "s"} <span className="font-normal text-slate-500">— and which secured sites provide them</span></div>
                {set.whereNext.length ? (
                  <ul className="mt-1 space-y-1">
                    {set.whereNext.slice(0, 6).map((w) => (
                      <li key={w.employerId} className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={`/families/${data.family.id}/clinical/sites/${w.employerId}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{w.name}</Link>
                        <span className="text-slate-500">{w.driveMinutes != null ? `≈ ${Math.round(w.driveMinutes)} min · ` : ""}{w.required.length ? <span className="text-rose-700">{w.required.length} required: {w.required.slice(0, 5).join(", ")}{w.required.length > 5 ? ` +${w.required.length - 5}` : ""}</span> : null}{w.required.length && w.elective.length ? " · " : ""}{w.elective.length ? <span>{w.elective.length} elective{w.elective.length === 1 ? "" : "s"}</span> : null}</span>
                        <span className={`text-[10px] ${w.coming ? "text-emerald-700" : "text-amber-700"}`}>{w.coming ? `${w.coming} coming shift${w.coming === 1 ? "" : "s"} here` : "no shift booked here yet"}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-slate-500">No secured site in the program&apos;s network is recorded as providing what is missing.</p>}
                {set.nobody.length > 0 && <p className="mt-1 text-rose-600">⚠ No site in the network provides: {set.nobody.join(", ")} — an agreement or a site confirmation is needed before this student can finish.</p>}
              </div>
            )}

            {/* The list, item by item */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Experience</th><th className="px-2 py-1.5 text-left">Status</th>{cases && <><th className="px-2 py-1.5 text-right">First scrub</th><th className="px-2 py-1.5 text-right">Second scrub</th><th className="px-2 py-1.5 text-right">Observed</th></>}<th className="px-2 py-1.5 text-left">Last · where</th></tr></thead>
                <tbody>
                  {cats.map((cat) => {
                    const rows = pr.items.filter((i) => i.item.category === cat);
                    const met = rows.filter((r) => r.met).length;
                    return (
                      <Fragment key={cat}>
                        <tr className="bg-slate-50/70"><td colSpan={cases ? 6 : 3} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{cat} <span className="font-normal normal-case text-slate-400">— {met} of {rows.length}</span></td></tr>
                        {rows.map((r) => (
                          <tr key={r.item.id} className={`border-t border-slate-100 ${r.met ? "" : r.item.mandatory ? "bg-rose-50/30" : ""}`}>
                            <td className="px-3 py-1"><span className={r.item.mandatory ? "font-medium text-slate-800" : "text-slate-600"}>{r.item.name}</span><span className="ml-1 text-[10px] text-slate-400">{r.item.mandatory ? "required" : `elective${r.item.electiveGroup ? ` · ${r.item.electiveGroup}` : ""}`}</span></td>
                            <td className="px-2 py-1 whitespace-nowrap">{r.met ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">✓ {cases ? "logged" : "competent"}{r.simulated ? " · simulated" : ""}</span> : r.attempts ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span> : <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">not yet</span>}</td>
                            {cases && <><td className="px-2 py-1 text-right tabular-nums">{r.cases.fs || "—"}</td><td className="px-2 py-1 text-right tabular-nums">{r.cases.ss || "—"}</td><td className="px-2 py-1 text-right tabular-nums text-slate-400">{r.cases.obs || "—"}</td></>}
                            <td className="px-2 py-1 text-slate-500">{r.lastDate ? <>{fmtDate(r.lastDate)}{r.sites.length ? ` · ${r.sites.map((id) => data.sites.find((s) => s.id === id)?.name ?? "").filter(Boolean).join(", ")}` : ""}</> : "—"}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Log an experience */}
            <form action={logRequirement.bind(null, data.student.id)} className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50/30 p-3 text-xs sm:grid-cols-2 lg:grid-cols-6">
              <div className="sm:col-span-2 lg:col-span-6 text-sm font-semibold text-slate-800">Log {cases ? "a case" : "a competency"} <span className="text-xs font-normal text-slate-500">— pick the shift it happened on and the site, date and preceptor fill themselves; override any of them</span></div>
              <label className="block sm:col-span-2 lg:col-span-2"><span className={lbl}>Experience</span>
                <select name="itemId" required className={inp + " w-full"}>{cats.map((cat) => <optgroup key={cat} label={cat}>{pr.items.filter((i) => i.item.category === cat).map((r) => <option key={r.item.id} value={r.item.id}>{r.met ? "✓ " : ""}{r.item.name}{r.item.mandatory ? "" : " (elective)"}</option>)}</optgroup>)}</select></label>
              <label className="block lg:col-span-2"><span className={lbl}>Shift</span>
                <select name="shiftId" className={inp + " w-full"}><option value="">— none / not on a scheduled shift —</option>{data.shifts.filter((s) => s.date! <= data.today).slice(-40).reverse().map((s) => <option key={s.id} value={s.id}>{fmtDate(s.date)} · {s.course}{s.site ? ` · ${s.site}` : ""}{s.settingCode ? ` · ${s.settingCode}` : ""}</option>)}</select></label>
              <label className="block"><span className={lbl}>Date</span><input name="date" type="date" max={data.today} className={inp + " w-full"} /></label>
              {cases ? (
                <label className="block"><span className={lbl}>Role</span><select name="role" required className={inp + " w-full"}><option value="first scrub">first scrub</option><option value="second scrub">second scrub</option><option value="observation">observation (not counted)</option></select></label>
              ) : (
                <label className="block"><span className={lbl}>Outcome</span><select name="outcome" className={inp + " w-full"}><option value="competent">competent</option><option value="attempted">attempted — not yet competent</option></select></label>
              )}
              <label className="block lg:col-span-2"><span className={lbl}>Site</span><select name="employerId" className={inp + " w-full"}><option value="">— from the shift —</option>{data.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="block lg:col-span-2"><span className={lbl}>Preceptor</span><select name="preceptorId" className={inp + " w-full"}><option value="">— from the shift —</option>{data.sites.map((s) => <optgroup key={s.id} label={s.name}>{s.preceptors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select></label>
              {cases ? <label className="block"><span className={lbl}>Cases</span><input name="count" type="number" min="1" step="1" defaultValue={1} className={inp + " w-full"} /></label> : <label className="flex items-end gap-1 pb-1"><input name="simulated" type="checkbox" /> simulated</label>}
              <label className="block"><span className={lbl}>Patient</span><span className="flex flex-wrap gap-2 pt-1">{["pediatric", "geriatric", "trauma"].map((f) => <label key={f} className="flex items-center gap-0.5"><input name={`flag_${f}`} type="checkbox" />{f}</label>)}</span></label>
              <label className="block sm:col-span-2 lg:col-span-3"><span className={lbl}>{cases ? "Procedure (e.g. lap chole, ORIF ankle)" : "Projections / notes (e.g. PA & lateral, wheelchair)"}</span><input name="procedure" className={inp + " w-full"} /></label>
              <label className="block sm:col-span-2 lg:col-span-2"><span className={lbl}>Notes</span><input name="notes" className={inp + " w-full"} /></label>
              <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Log it</button></div>
            </form>

            {/* Entries */}
            {set.logs.length > 0 && (
              <details className="rounded-lg border border-slate-200 bg-white p-2 text-xs" open={set.logs.length <= 12}>
                <summary className="cursor-pointer font-medium text-slate-700">{set.logs.length} entr{set.logs.length === 1 ? "y" : "ies"} · {set.logs.filter((l) => l.verifiedAt).length} verified by a preceptor</summary>
                <table className="mt-1 w-full"><thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-1 text-left">Date</th><th className="py-1 text-left">Experience</th><th className="py-1 text-left">{cases ? "Role · cases" : "Outcome"}</th><th className="py-1 text-left">Site · preceptor</th><th className="py-1 text-left">Verified</th><th></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{set.logs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1 tabular-nums">{fmtDate(l.date)}</td>
                      <td className="py-1">{l.item.name}{l.procedure ? <span className="text-slate-400"> · {l.procedure}</span> : null}{l.flags ? <span className="ml-1 text-[10px] text-slate-400">{l.flags}</span> : null}</td>
                      <td className="py-1">{cases ? `${l.role ?? "—"} · ${dec(l.count)}` : l.outcome}{l.simulated ? " · simulated" : ""}</td>
                      <td className="py-1 text-slate-600">{l.site ?? "—"}{l.preceptor ? ` · ${l.preceptor}` : ""}</td>
                      <td className="py-1">{l.verifiedAt ? <span className="text-emerald-700">✓ {l.verifier ?? ""} {fmtDate(l.verifiedAt)}</span> : (
                        <form action={verifyRequirementLog.bind(null, l.id, data.student.id)} className="flex items-center gap-1"><select name="verifiedById" className={inp}><option value="">— preceptor —</option>{data.sites.flatMap((s) => s.preceptors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>))}</select><button className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">verify</button></form>
                      )}</td>
                      <td className="py-1 text-right"><form action={deleteRequirementLog.bind(null, l.id, data.student.id)}><button className="text-slate-300 hover:text-rose-600" title="remove entry">✕</button></form></td>
                    </tr>
                  ))}</tbody></table>
              </details>
            )}
            {Object.keys(set.definitions).length > 0 && <p className="text-[10px] text-slate-400">{Object.entries(set.definitions).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
          </div>
        );
      })}
    </div>
  );
}
