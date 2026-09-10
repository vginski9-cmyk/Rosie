"use client";

// CLINICAL SITE LOAD — the explorer. Filters on top (program · cohort · term · setting · agreement),
// then three views: the leaderboard (which sites carry the load, how full they run, who precepts),
// grouped (the same load by health system, county, ring, facility type, setting, program …), and
// over time (site × week or month, students on site). Every number is student-days unless labelled.

import { useMemo, useState } from "react";
import Link from "next/link";
import { sliceBy, siteStats, siteByPeriod, concentration, DIM_LABEL, type LoadRow, type SiteSeats, type LoadDim, type SiteStat } from "@/lib/siteload";
import { dec } from "@/lib/format";

const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const RING: Record<string, string> = { Core: "bg-emerald-50 text-emerald-800", "Ring 1": "bg-sky-50 text-sky-800", "Ring 2": "bg-amber-50 text-amber-800", "Ring 3": "bg-rose-50 text-rose-800" };
const fmtP = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? new Date(p + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : /^\d{4}-\d{2}-\d{2}$/.test(p) ? `${Number(p.slice(5, 7))}/${Number(p.slice(8, 10))}` : p);
const n1 = (v: number) => dec(v, 1);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const heat = (v: number, max: number) => (v <= 0 ? "" : v / max < 0.25 ? "bg-rose-100 text-rose-900" : v / max < 0.5 ? "bg-rose-200 text-rose-900" : v / max < 0.75 ? "bg-rose-300 text-rose-950" : "bg-rose-500 text-white");

function Sel({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: string[]; all: string }) {
  if (options.length <= 1) return null;
  return (
    <label className="block text-xs">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1"><option value="">{all}</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    </label>
  );
}

export function SiteLoadExplorer({ rows, seats, programs, cohorts, terms, settings, programIds }: { rows: LoadRow[]; seats: SiteSeats[]; programs: string[]; cohorts: string[]; terms: string[]; settings: string[]; programIds: Record<string, string> }) {
  const [program, setProgram] = useState(""); const [cohort, setCohort] = useState(""); const [term, setTerm] = useState(""); const [setting, setSetting] = useState(""); const [agreement, setAgreement] = useState("");
  const [view, setView] = useState<"sites" | "group" | "time">("sites");
  const [dim, setDim] = useState<LoadDim>("system");
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => rows.filter((r) => (!program || r.program === program) && (!cohort || r.cohort === cohort) && (!term || r.term === term) && (!setting || (r.setting ?? "(no setting)") === setting) && (!agreement || r.agreement === agreement)), [rows, program, cohort, term, setting, agreement]);
  const stats = useMemo(() => siteStats(filtered, seats), [filtered, seats]);
  const groups = useMemo(() => sliceBy(filtered, dim), [filtered, dim]);
  const grid = useMemo(() => siteByPeriod(filtered, period), [filtered, period]);
  const conc = concentration(stats, 3);
  const total = filtered.length;
  const students = new Set(filtered.map((r) => r.studentId)).size;
  const dated = filtered.filter((r) => r.date);
  const span = dated.length ? [dated.map((r) => r.date!).sort()[0], dated.map((r) => r.date!).sort().at(-1)!] : null;
  const secured = stats.filter((s) => s.agreement === "secured");
  const unsecuredLoad = stats.filter((s) => s.agreement !== "secured").reduce((n, s) => n + s.studentDays, 0);
  const overfull = stats.filter((s) => s.utilization != null && s.utilization > 1);
  const noPreceptor = stats.filter((s) => s.preceptorsUsed === 0 && s.studentDays > 0);
  const maxDays = Math.max(1, ...stats.map((s) => s.studentDays));
  const shown = showAll ? stats : stats.slice(0, 20);
  const anyFilter = program || cohort || term || setting || agreement;
  const siteHref = (s: SiteStat) => { const pid = s.programs[0] ? programIds[s.programs[0].name] : null; return s.employerId ? (pid ? `/programs/${pid}/clinical/sites/${s.employerId}` : `/employers/${s.employerId}`) : null; };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Sel label="Program" value={program} onChange={setProgram} options={programs} all="every program" />
        <Sel label="Cohort" value={cohort} onChange={setCohort} options={cohorts} all="every cohort" />
        <Sel label="Term" value={term} onChange={setTerm} options={terms} all="every term" />
        <Sel label="Setting" value={setting} onChange={setSetting} options={settings} all="every setting" />
        <Sel label="Agreement" value={agreement} onChange={setAgreement} options={["secured", "asked", "prospect", "none"]} all="any" />
        {anyFilter && <button onClick={() => { setProgram(""); setCohort(""); setTerm(""); setSetting(""); setAgreement(""); }} className="pb-1 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs">
          {([["sites", "Sites"], ["group", "Grouped"], ["time", "Over time"]] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>)}
        </div>
      </div>

      {/* The headline */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Student-days", total.toLocaleString("en-US"), span ? `${fmtP(span[0])} → ${fmtP(span[1])}` : "no dated shifts"],
          ["Students placed", String(students), `${stats.length} site${stats.length === 1 ? "" : "s"} carrying them`],
          ["Top 3 sites carry", pct(conc.topShare), conc.top.map((t) => t.replace(/ — .*$/, "").slice(0, 22)).join(" · ")],
          ["Secured sites", `${secured.length} of ${stats.length}`, unsecuredLoad ? `${unsecuredLoad.toLocaleString("en-US")} student-days at sites without a secured agreement` : "every student-day is at a secured site"],
          ["Watch", String(overfull.length + noPreceptor.length), `${overfull.length} over their seats · ${noPreceptor.length} with no preceptor named`],
        ].map(([k, v, d]) => <div key={k} className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</div><div className="text-xl font-semibold tabular-nums text-slate-900">{v}</div><div className="text-[11px] text-slate-500">{d}</div></div>)}
      </div>

      {view === "sites" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Site</th><th className="min-w-[12rem] px-2 py-1.5 text-left">Share of the load</th><th className="px-2 py-1.5 text-right">Student-days</th><th className="px-2 py-1.5 text-right">Students</th><th className="px-2 py-1.5 text-left">Programs</th><th className="px-2 py-1.5 text-left">Settings</th><th className="px-2 py-1.5 text-right">Students / day</th><th className="px-2 py-1.5 text-right">Seats</th><th className="px-2 py-1.5 text-right">Full</th><th className="px-2 py-1.5 text-right">Preceptors</th><th className="px-2 py-1.5 text-left">Agreement</th><th className="px-2 py-1.5 text-left">Drive</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s, i) => {
                const key = s.employerId ?? s.site; const href = siteHref(s);
                return (
                  <>
                    <tr key={key} className={`hover:bg-slate-50/60 ${open === key ? "bg-rose-50/40" : ""}`}>
                      <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1.5"><button onClick={() => setOpen(open === key ? null : key)} className="text-left font-medium text-slate-800 hover:text-rose-700">{open === key ? "▾" : "▸"} {s.site}</button><span className="block text-[10px] text-slate-400">{[s.system, s.facilityType, s.county ? `${s.county} County` : null].filter(Boolean).join(" · ")}</span></td>
                      <td className="px-2 py-1.5"><div className="flex items-center gap-2"><div className="h-2.5 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full bg-rose-500" style={{ width: `${Math.round((s.studentDays / maxDays) * 100)}%` }} /></div><span className="w-10 text-right tabular-nums text-slate-700">{pct(s.share)}</span></div></td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">{s.studentDays.toLocaleString("en-US")}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.students}</td>
                      <td className="px-2 py-1.5">{s.programs.map((p) => <span key={p.name} className="mr-1 inline-block rounded bg-slate-100 px-1 text-[10px] text-slate-700">{p.name} {p.students}</span>)}</td>
                      <td className="px-2 py-1.5">{s.settings.slice(0, 4).map((x) => <span key={x.code} className="mr-1 font-mono text-[10px] text-slate-600">{x.code} {x.studentDays}</span>)}{s.settings.length > 4 ? <span className="text-[10px] text-slate-400">+{s.settings.length - 4}</span> : null}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{n1(s.avgStudentsPerActiveDay)}<span className="block text-[10px] text-slate-400">peak {s.peakDayStudents}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{s.seatsPerDay ?? "—"}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${s.utilization == null ? "text-slate-300" : s.utilization > 1 ? "font-semibold text-rose-600" : s.utilization > 0.75 ? "text-amber-700" : "text-emerald-700"}`}>{s.utilization == null ? "—" : pct(s.utilization)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.preceptorsUsed}<span className="text-slate-400"> / {s.preceptorsOnRecord ?? "—"}</span>{s.preceptorsUsed === 0 && <span className="block text-[10px] text-amber-600">none named</span>}</td>
                      <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${AGREEMENT[s.agreement] ?? ""}`}>{s.agreement}</span></td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{s.ring && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${RING[s.ring] ?? "bg-slate-100"}`}>{s.ring}</span>}{s.driveMinutes != null && <span className="ml-1 text-[10px] tabular-nums text-slate-500">{Math.round(s.driveMinutes)} min</span>}</td>
                    </tr>
                    {open === key && (
                      <tr key={key + "-d"} className="bg-rose-50/30">
                        <td colSpan={13} className="px-4 py-2">
                          <div className="grid gap-3 text-[11px] md:grid-cols-4">
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">By program</div>{s.programs.map((p) => <div key={p.name} className="tabular-nums">{p.name}: <strong>{p.studentDays}</strong> student-days · {p.students} students</div>)}</div>
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">By setting</div>{s.settings.map((x) => <div key={x.code} className="tabular-nums"><span className="font-mono">{x.code}</span>: {x.studentDays}</div>)}</div>
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">When</div><div>{s.firstDate ? `${fmtP(s.firstDate)} → ${fmtP(s.lastDate!)}` : "undated"} · {s.weeksActive} active weeks</div><div>{s.hours.toLocaleString("en-US")} student-hours · {s.completedDays} days logged{s.absentDays ? ` · ${s.absentDays} absences` : ""}</div><div>cohorts: {s.cohorts.join(", ")}</div></div>
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Preceptors</div><div>{s.preceptorsUsed} named on shifts{s.preceptorsOnRecord != null ? ` · ${s.preceptorsOnRecord} on record` : ""}{s.studentDaysPerPreceptor != null ? ` · ${n1(s.studentDaysPerPreceptor)} student-days each` : ""}</div>{href && <Link href={href} className="mt-1 inline-block text-rose-600 hover:underline">open the site&apos;s setup →</Link>}{s.employerId && <Link href={`/employers/${s.employerId}`} className="ml-2 text-rose-600 hover:underline">organization record →</Link>}</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {stats.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">No clinical shifts in this slice.</td></tr>}
              {!showAll && stats.length > 20 && <tr><td colSpan={13} className="px-3 py-2 text-center"><button onClick={() => setShowAll(true)} className="text-rose-600 hover:underline">Show all {stats.length} sites</button></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === "group" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Group by</span>
            {(Object.keys(DIM_LABEL) as LoadDim[]).filter((d) => d !== "site" && d !== "week").map((d) => <button key={d} onClick={() => setDim(d)} className={`rounded-full px-2.5 py-1 font-medium ${dim === d ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{DIM_LABEL[d]}</button>)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">{DIM_LABEL[dim]}</th><th className="min-w-[14rem] px-2 py-1.5 text-left">Share</th><th className="px-2 py-1.5 text-right">Student-days</th><th className="px-2 py-1.5 text-right">Students</th><th className="px-2 py-1.5 text-right">Student-hours</th><th className="px-2 py-1.5 text-right">Sites</th><th className="px-2 py-1.5 text-left">Programs</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((g) => { const max = Math.max(1, ...groups.map((x) => x.studentDays)); return (
                  <tr key={g.key}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{dim === "month" || dim === "week" ? fmtP(g.label) : g.label}</td>
                    <td className="px-2 py-1.5"><div className="flex items-center gap-2"><div className="h-2.5 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full bg-rose-500" style={{ width: `${Math.round((g.studentDays / max) * 100)}%` }} /></div><span className="w-10 text-right tabular-nums">{pct(g.share)}</span></div></td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{g.studentDays.toLocaleString("en-US")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{g.students}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{Math.round(g.hours).toLocaleString("en-US")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{g.sites}</td>
                    <td className="px-2 py-1.5 text-slate-500">{g.programs.join(", ")}</td>
                  </tr>
                ); })}
                {groups.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No clinical shifts in this slice.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "time" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs"><span className="text-slate-500">Students on site per</span><div className="inline-flex overflow-hidden rounded-lg border border-slate-300">{(["week", "month"] as const).map((p) => <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 ${period === p ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{p}</button>)}</div><span className="text-slate-400">· top {grid.sites.length} sites by student-days</span></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="text-[11px]">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="sticky left-0 bg-slate-50 px-3 py-1.5 text-left">Site</th>{grid.periods.map((p) => <th key={p} className="px-1.5 py-1.5 text-center font-normal">{fmtP(p)}</th>)}<th className="px-2 py-1.5 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {grid.sites.map((s) => { const max = Math.max(1, ...Object.values(s.cells)); return (
                  <tr key={s.employerId ?? s.site}>
                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1 font-medium text-slate-800">{s.site.replace(/ — .*$/, "").slice(0, 34)}</td>
                    {grid.periods.map((p) => { const v = s.cells[p] ?? 0; return <td key={p} className={`px-1.5 py-1 text-center tabular-nums ${heat(v, max)}`}>{v || ""}</td>; })}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{s.total.toLocaleString("en-US")}</td>
                  </tr>
                ); })}
                {grid.sites.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400">No dated clinical shifts in this slice.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
