"use client";

// CLINICAL SITE LOAD — the explorer. A query bar first: any combination of program, cohort, class,
// term, semester, year, month, day of week, a date window, site, health system, county, drive-time
// band, facility type, setting, asset, shift, seat, agreement, status, student, preceptor, instructor,
// supervision model and who supervised. Then three views of whatever the query leaves: the site
// leaderboard (who carries the load, how full each shift runs against the seats open that shift, asset
// by asset, who supervises — college instructors and site preceptors, and the hours each gave), a pivot
// of any rows × any columns for any measure, and the site × week / month grid. Everything exports to CSV.
// A supervisor's hours are attributed by share: their hours on a shift ÷ the learners on that shift.

import { useMemo, useState } from "react";
import Link from "next/link";
import { driveBandLabel, DRIVE_BAND_TONE } from "@/lib/geo";
import { applyFilter, optionsOf, pivot, siteStats, siteByPeriod, concentration, rowsToCsv, pivotToCsv, DIM_LABEL, MEASURE_LABEL, isTimeDim, NO_SEAT, type LoadRow, type SiteSeats, type LoadDim, type LoadMeasure, type LoadFilter, type SiteStat } from "@/lib/siteload";
import { dec, fmt } from "@/lib/format";

const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const fmtP = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? new Date(p + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : /^\d{4}-\d{2}-\d{2}$/.test(p) ? `${Number(p.slice(5, 7))}/${Number(p.slice(8, 10))}/${p.slice(2, 4)}` : p);
const n1 = (v: number) => dec(v, 1);
const pct = (v: number) => fmt.pct(v);
const heat = (v: number, max: number) => (v <= 0 ? "" : v / max < 0.25 ? "bg-rose-100 text-rose-900" : v / max < 0.5 ? "bg-rose-200 text-rose-900" : v / max < 0.75 ? "bg-rose-300 text-rose-950" : "bg-rose-500 text-white");
const fmtCell = (v: number, m: LoadMeasure) => (m === "hours" || m === "instructorHours" || m === "preceptorHours" ? fmt.hours(v) : fmt.num(v));
const download = (name: string, text: string) => { const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };

/** The query bar's dimensions, in the order they read: when · who · where · what. */
const QUERY_DIMS: (keyof LoadFilter & LoadDim)[] = ["year", "semester", "term", "dayOfWeek", "block", "seat", "program", "cohort", "course", "student", "site", "system", "county", "ring", "facilityType", "setting", "asset", "agreement", "status", "supervision", "supervised", "preceptor", "instructor"];
const ROW_DIMS: LoadDim[] = ["site", "asset", "block", "seat", "system", "county", "ring", "facilityType", "setting", "program", "cohort", "course", "student", "preceptor", "instructor", "supervision", "supervised", "ratio", "agreement", "status", "year", "semester", "term", "month", "week", "day", "dayOfWeek"];
const COL_DIMS: LoadDim[] = ["month", "week", "semester", "term", "year", "dayOfWeek", "block", "seat", "program", "cohort", "course", "setting", "supervision", "supervised", "ratio", "status", "agreement", "ring", "county", "system"];

/** One dimension of the query: chips when few values, a searchable checklist when many. */
function Pick({ dim, options, chips, value, onChange }: { dim: LoadDim; options: string[]; chips: boolean; value: Set<string>; onChange: (s: Set<string>) => void }) {
  const [q, setQ] = useState("");
  const toggle = (o: string) => { const n = new Set(value); n.has(o) ? n.delete(o) : n.add(o); onChange(n); };
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className={chips ? "" : "min-w-[10rem]"}>
      <div className="mb-1 flex items-baseline justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{DIM_LABEL[dim]}</span>{value.size > 0 && <button onClick={() => onChange(new Set())} className="text-[10px] text-slate-400 hover:text-rose-600">any</button>}</div>
      {options.length === 1 && value.size === 0 ? (
        // The rest of the query leaves only one value here — say which, rather than hide the dimension.
        <span className="inline-block rounded-full border border-dashed border-slate-200 px-2 py-0.5 text-[11px] text-slate-400" title={`every shift the query leaves is ${options[0]}`}>{options[0]}</span>
      ) : chips ? (
        <div className="flex flex-wrap gap-1">{options.map((o) => <button key={o} onClick={() => toggle(o)} className={`rounded-full border px-2 py-0.5 text-[11px] ${value.has(o) ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{o}</button>)}</div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search options" placeholder={`${value.size ? `${value.size} picked` : "any"} · search ${options.length}`} className="w-full rounded-t-lg border-b border-slate-100 px-2 py-1 text-[11px]" />
          <div className="max-h-28 overflow-y-auto px-1 py-0.5">{shown.slice(0, 200).map((o) => <label key={o} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={value.has(o)} onChange={() => toggle(o)} /><span className="truncate">{o}</span></label>)}{shown.length === 0 && <div className="px-1 py-1 text-[11px] text-slate-400">no match</div>}</div>
        </div>
      )}
    </div>
  );
}

export function SiteLoadExplorer({ rows, seats, familySettings, programIds }: { rows: LoadRow[]; seats: SiteSeats[]; familySettings: Record<string, string[]>; programIds: Record<string, string> }) {
  const [filter, setFilter] = useState<LoadFilter>({});
  const [view, setView] = useState<"sites" | "pivot" | "time">("sites");
  const [rowDim, setRowDim] = useState<LoadDim>("site");
  const [colDim, setColDim] = useState<LoadDim | null>("month");
  const [measure, setMeasure] = useState<LoadMeasure>("studentDays");
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [queryOpen, setQueryOpen] = useState(true);

  const set = (dim: keyof LoadFilter) => (s: Set<string>) => setFilter((f) => ({ ...f, [dim]: s }));
  const filtered = useMemo(() => applyFilter(rows, filter), [rows, filter]);
  // Options for each dimension come from the rows the OTHER filters leave, so choices stay honest.
  const optionsFor = (dim: keyof LoadFilter & LoadDim) => optionsOf(applyFilter(rows, { ...filter, [dim]: undefined }), dim);
  // Chips or a searchable list is decided on the whole data set, so the bar keeps its shape as the query narrows.
  const baseCount = useMemo(() => Object.fromEntries(QUERY_DIMS.map((d) => [d, optionsOf(rows, d).length])) as Record<string, number>, [rows]);
  const dims = useMemo(() => QUERY_DIMS.filter((d) => baseCount[d] >= 2).map((dim) => ({ dim, options: optionsFor(dim), chips: baseCount[dim] <= 8 })), [rows, filter, baseCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => siteStats(filtered, seats, familySettings), [filtered, seats, familySettings]);
  const pv = useMemo(() => pivot(filtered, rowDim, colDim, measure), [filtered, rowDim, colDim, measure]);
  const grid = useMemo(() => siteByPeriod(filtered, period), [filtered, period]);
  const conc = concentration(stats, 3);
  const total = filtered.length;
  const students = new Set(filtered.map((r) => r.studentId)).size;
  const dated = filtered.filter((r) => r.date).map((r) => r.date!).sort();
  const span = dated.length ? [dated[0], dated[dated.length - 1]] : null;
  const secured = stats.filter((s) => s.agreement === "secured");
  const unsecuredLoad = stats.filter((s) => s.agreement !== "secured").reduce((n, s) => n + s.studentDays, 0);
  // Over its seats on some shift — the scheduler never writes this; it can only come from a hand-made booking.
  const overfull = stats.filter((s) => s.peakShare != null && s.peakShare > 1);
  const seated = filtered.filter((r) => r.assetId).length;
  const unseated = total - seated;
  // A required supervisor with nobody named — either role, shift by shift (a role the template does not require is never a gap).
  const unsupervised = stats.reduce((n, s) => n + s.unsupervisedShifts, 0);
  const sitesUnsupervised = stats.filter((s) => s.unsupervisedShifts > 0);
  const instructorHours = filtered.reduce((n, r) => n + r.instructorShare, 0);
  const preceptorHours = filtered.reduce((n, r) => n + r.preceptorShare, 0);
  const instructorsNamed = new Set(filtered.filter((r) => r.instructorId).map((r) => r.instructorId)).size;
  const preceptorsNamed = new Set(filtered.filter((r) => r.preceptorId).map((r) => r.preceptorId)).size;
  const maxDays = Math.max(1, ...stats.map((s) => s.studentDays));
  const shown = showAll ? stats : stats.slice(0, 20);
  const active = (Object.keys(filter) as (keyof LoadFilter)[]).filter((k) => (k === "from" || k === "to" ? !!filter[k] : (filter[k] as Set<string> | undefined)?.size));
  const summary = active.map((k) => (k === "from" ? `from ${filter.from}` : k === "to" ? `to ${filter.to}` : `${DIM_LABEL[k as LoadDim]}: ${[...(filter[k] as Set<string>)].slice(0, 3).join(", ")}${(filter[k] as Set<string>).size > 3 ? ` +${(filter[k] as Set<string>).size - 3}` : ""}`)).join(" · ");
  const siteHref = (s: SiteStat) => { const pid = s.programs[0] ? programIds[s.programs[0].name] : null; return s.employerId ? (pid ? `/programs/${pid}/clinical/sites/${s.employerId}` : `/employers/${s.employerId}`) : null; };
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Query bar */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <button onClick={() => setQueryOpen((v) => !v)} className="text-sm font-semibold text-slate-800">{queryOpen ? "▾" : "▸"} Query <span className="font-normal text-slate-500">— {active.length ? summary : "everything: every cohort, class, site and date"}</span></button>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500"><strong className="text-slate-800">{fmt.num(total)}</strong> of {fmt.num(rows.length)} student-shifts</span>
            {active.length > 0 && <button onClick={() => setFilter({})} className="text-slate-400 hover:text-rose-600">clear all</button>}
            <button onClick={() => download(`clinical_site_load_${stamp}.csv`, rowsToCsv(filtered))} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Export these rows ↓</button>
          </div>
        </div>
        {queryOpen && (
          <div className="border-t border-slate-100 px-3 py-3">
            {/* Short lists read as chips in one wrapping row; long ones become searchable checklists in a grid below. */}
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3 text-xs">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Dates</div>
                <div className="flex items-center gap-1"><input type="date" value={filter.from ?? ""} aria-label="From date" onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || null }))} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px]" /><span className="text-slate-400">→</span><input type="date" value={filter.to ?? ""} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || null }))} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px]" /></div>
              </div>
              {dims.filter((d) => d.chips).map((d) => <Pick key={d.dim} dim={d.dim} options={d.options} chips value={(filter[d.dim] as Set<string> | undefined) ?? new Set()} onChange={set(d.dim)} />)}
            </div>
            {dims.some((d) => !d.chips) && (
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                {dims.filter((d) => !d.chips).map((d) => <Pick key={d.dim} dim={d.dim} options={d.options} chips={false} value={(filter[d.dim] as Set<string> | undefined) ?? new Set()} onChange={set(d.dim)} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* The headline of whatever the query leaves */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ["Student-shifts", fmt.num(total), span ? `${fmtP(span[0])} → ${fmtP(span[1])}` : "no dated shifts"],
          ["On a booked seat", total ? pct(seated / total) : "—", unseated ? `${fmt.num(unseated)} with no seat yet — the scheduler could not place them under the roster levers` : "every student-shift sits on an asset the scheduler booked"],
          ["Students placed", String(students), `${stats.length} site${stats.length === 1 ? "" : "s"} carrying them`],
          ["Top 3 sites carry", pct(conc.topShare), conc.top.map((t) => t.replace(/ — .*$/, "").slice(0, 22)).join(" · ")],
          ["Secured sites", `${secured.length} of ${stats.length}`, unsecuredLoad ? `${fmt.num(unsecuredLoad)} student-shifts at sites without a secured agreement` : "every student-shift is at a secured site"],
          ["Supervision", `${fmt.hours(instructorHours)} · ${fmt.hours(preceptorHours)}`, `instructor · preceptor hours the learners received — ${instructorsNamed} instructor${instructorsNamed === 1 ? "" : "s"}, ${preceptorsNamed} preceptor${preceptorsNamed === 1 ? "" : "s"} named`],
          ["Watch", String(overfull.length + unsupervised), `${overfull.length} over their seats on some shift · ${fmt.num(unsupervised)} shift${unsupervised === 1 ? "" : "s"} with the required supervisor not named${sitesUnsupervised.length ? ` at ${sitesUnsupervised.length} site${sitesUnsupervised.length === 1 ? "" : "s"}` : ""}`],
        ].map(([k, v, d]) => <div key={k} className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</div><div className="text-xl font-semibold tabular-nums text-slate-900">{v}</div><div className="text-[11px] text-slate-500">{d}</div></div>)}
      </div>
      <details className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-800">How to read supervision here</summary>
        <p className="mt-2">Every shift names two roles: the <strong>college instructor</strong> (on an instructor-led shift) and the <strong>site preceptor</strong> (on a precepted one); a combined model needs both. A role the template does not require reads <em>none required</em>, never a gap. The hours are attributed by share: a supervisor&apos;s hours on the shift ÷ the learners on that shift is each learner&apos;s share, credited only when someone is named in the role, so a site&apos;s or a person&apos;s total is the time they actually gave, not the shift length × learners. Fractional instructor oversight (Radiography&apos;s 0.04 of an instructor on a precepted rotation) is that fraction of the shift, with nobody named per shift.</p>
      </details>
      {unseated > 0 && <p className="text-xs text-slate-500">A shift with no seat is shown at its section&apos;s pattern site but is never counted against that site&apos;s seats. <Link href="/scheduler" className="text-rose-700 hover:underline">Open the clinical scheduler</Link> to see why it could not be placed and which lever would seat it.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs">
          {([["sites", "Sites"], ["pivot", "Pivot — any rows × any columns"], ["time", "Sites over time"]] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>)}
        </div>
      </div>

      {view === "sites" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Site</th><th className="min-w-[12rem] px-2 py-1.5 text-left">Share of the load</th><th className="px-2 py-1.5 text-right">Student-shifts</th><th className="px-2 py-1.5 text-right">Students</th><th className="px-2 py-1.5 text-left">Programs</th><th className="px-2 py-1.5 text-left">Settings</th><th className="px-2 py-1.5 text-right" title="Students on a shift (date × shift block): the average over the shifts the site hosts, and the fullest one">Students / shift</th><th className="px-2 py-1.5 text-right" title="Learner seats open on a Day shift in the programs' settings — the sum of the site's assets' learners per shift">Seats / shift</th><th className="px-2 py-1.5 text-right" title="How full the site runs on the shifts it hosts: students ÷ seats open that shift, summed over the shifts; below, the fullest single shift">Full</th><th className="px-2 py-1.5 text-right" title="Site preceptors named on the site's shifts / on the site's record, and college instructors named on them; amber when a required supervisor is missing on some shift">Supervision</th><th className="px-2 py-1.5 text-left">Agreement</th><th className="px-2 py-1.5 text-left">Drive</th></tr>
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
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">{fmt.num(s.studentDays)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.students}</td>
                      <td className="px-2 py-1.5">{s.programs.map((p) => <span key={p.name} className="mr-1 inline-block rounded bg-slate-100 px-1 text-[10px] text-slate-700">{p.name} {p.students}</span>)}</td>
                      <td className="px-2 py-1.5">{s.settings.slice(0, 4).map((x) => <span key={x.code} className="mr-1 font-mono text-[10px] text-slate-600">{x.code} {x.studentDays}</span>)}{s.settings.length > 4 ? <span className="text-[10px] text-slate-400">+{s.settings.length - 4}</span> : null}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{s.shiftsUsed ? n1(s.avgStudentsPerShift) : "—"}<span className="block text-[10px] text-slate-400">{s.shiftsUsed ? `fullest ${s.peakShiftStudents} · ${fmt.num(s.shiftsUsed)} shifts` : `${NO_SEAT}`}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{s.seatsPerShift ?? "—"}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${s.utilization == null ? "text-slate-300" : (s.peakShare ?? 0) > 1 ? "font-semibold text-rose-600" : s.utilization > 0.75 ? "text-amber-700" : "text-emerald-700"}`}>{s.utilization == null ? "—" : pct(s.utilization)}{s.peakShare != null && <span className="block text-[10px] font-normal text-slate-400">fullest shift {pct(s.peakShare)}</span>}{s.unplaced > 0 && <span className="block text-[10px] font-normal text-amber-600">{fmt.num(s.unplaced)} {NO_SEAT}</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{s.preceptorsUsed}<span className="text-slate-400"> / {s.preceptorsOnRecord ?? "—"} prec</span><span className="block text-[10px] text-slate-500">{s.instructorsUsed} instr</span>{s.unsupervisedShifts > 0 && <span className="block text-[10px] text-amber-600">{fmt.num(s.unsupervisedShifts)} unsupervised</span>}</td>
                      <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${AGREEMENT[s.agreement] ?? ""}`}>{s.agreement}</span></td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{s.ring && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${DRIVE_BAND_TONE[s.ring] ?? "bg-slate-100"}`}>{driveBandLabel(s.ring)}</span>}{s.driveMinutes != null && <span className="ml-1 text-[10px] tabular-nums text-slate-500">{fmt.minutes(s.driveMinutes)}</span>}</td>
                    </tr>
                    {open === key && (
                      <tr key={key + "-d"} className="bg-rose-50/30">
                        <td colSpan={13} className="px-4 py-2">
                          {s.assets.length > 0 && (
                            <div className="mb-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Seat by seat — each asset the roster booked here</div>
                              <table className="mt-1 text-[11px]">
                                <thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="pr-3 text-left font-normal">Asset</th><th className="pr-3 text-left font-normal">Setting</th><th className="pr-3 text-right font-normal">Seats / shift</th><th className="pr-3 text-right font-normal">Student-shifts</th><th className="pr-3 text-right font-normal">Shifts used</th><th className="pr-3 text-right font-normal">Fullest</th><th className="pr-3 text-right font-normal">Fill</th></tr></thead>
                                <tbody>{s.assets.map((a) => <tr key={a.assetId} className="border-t border-slate-100"><td className="pr-3 py-0.5 font-medium text-slate-700">{a.name}</td><td className="pr-3 font-mono text-slate-500">{a.settingCode}</td><td className="pr-3 text-right tabular-nums">{a.seatsPerShift}</td><td className="pr-3 text-right tabular-nums">{fmt.num(a.studentShifts)}</td><td className="pr-3 text-right tabular-nums">{fmt.num(a.shiftsUsed)}</td><td className={`pr-3 text-right tabular-nums ${a.peakStudents > a.seatsPerShift ? "font-semibold text-rose-600" : ""}`}>{a.peakStudents} of {a.seatsPerShift}</td><td className="pr-3 text-right tabular-nums">{pct(a.fill)}</td></tr>)}</tbody>
                              </table>
                            </div>
                          )}
                          <div className="grid gap-3 text-[11px] md:grid-cols-4">
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">By program</div>{s.programs.map((p) => <div key={p.name} className="tabular-nums">{p.name}: <strong>{p.studentDays}</strong> student-shifts · {p.students} students</div>)}</div>
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">By setting</div>{s.settings.map((x) => <div key={x.code} className="tabular-nums"><span className="font-mono">{x.code}</span>: {x.studentDays}</div>)}</div>
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">When</div><div>{s.firstDate ? `${fmtP(s.firstDate)} → ${fmtP(s.lastDate!)}` : "undated"} · {s.weeksActive} active weeks · {n1(s.avgStudentsPerActiveDay)} students a day (peak {s.peakDayStudents})</div><div>{fmt.num(s.hours)} student-hours · {s.completedDays} shifts logged{s.absentDays ? ` · ${s.absentDays} absences` : ""}</div><div>cohorts: {s.cohorts.join(", ")}</div></div>
                            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Supervision</div><div>{s.preceptorsUsed} preceptor{s.preceptorsUsed === 1 ? "" : "s"} named on shifts{s.preceptorsOnRecord != null ? ` · ${s.preceptorsOnRecord} on record` : ""}{s.studentDaysPerPreceptor != null ? ` · ${n1(s.studentDaysPerPreceptor)} student-shifts each` : ""} · {fmt.hours(s.preceptorHours)} preceptor hours received</div><div>{s.instructorsUsed} instructor{s.instructorsUsed === 1 ? "" : "s"} named on shifts{s.studentDaysPerInstructor != null ? ` · ${n1(s.studentDaysPerInstructor)} student-shifts each` : ""} · {fmt.hours(s.instructorHours)} instructor hours received</div>{s.unsupervisedShifts > 0 && <div className="text-amber-700">{fmt.num(s.unsupervisedShifts)} shift{s.unsupervisedShifts === 1 ? "" : "s"} with the required supervisor not named</div>}<div className="mt-1 flex flex-wrap gap-2">{href && <Link href={href} className="text-rose-600 hover:underline">open the site&apos;s setup →</Link>}{s.employerId && <Link href={`/employers/${s.employerId}`} className="text-rose-600 hover:underline">organization record →</Link>}<button onClick={() => { setFilter((f) => ({ ...f, site: new Set([s.site]) })); setView("pivot"); setRowDim("student"); setColDim("month"); }} className="text-rose-600 hover:underline">who is here, month by month →</button></div></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {stats.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">No clinical shifts match this query.</td></tr>}
              {!showAll && stats.length > 20 && <tr><td colSpan={13} className="px-3 py-2 text-center"><button onClick={() => setShowAll(true)} className="text-rose-600 hover:underline">Show all {stats.length} sites</button></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === "pivot" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
            <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rows</span><select value={rowDim} onChange={(e) => setRowDim(e.target.value as LoadDim)} className="rounded-lg border border-slate-300 px-2 py-1">{ROW_DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}</select></label>
            <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Columns</span><select value={colDim ?? ""} onChange={(e) => setColDim((e.target.value || null) as LoadDim | null)} className="rounded-lg border border-slate-300 px-2 py-1"><option value="">— none (totals only) —</option>{COL_DIMS.filter((d) => d !== rowDim).map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}</select></label>
            <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Measure</span><select value={measure} onChange={(e) => setMeasure(e.target.value as LoadMeasure)} className="rounded-lg border border-slate-300 px-2 py-1">{(Object.keys(MEASURE_LABEL) as LoadMeasure[]).map((m) => <option key={m} value={m}>{MEASURE_LABEL[m]}</option>)}</select></label>
            <span className="text-slate-500">{pv.rows.length} row{pv.rows.length === 1 ? "" : "s"}{colDim ? ` × ${pv.cols.length} column${pv.cols.length === 1 ? "" : "s"}` : ""} · total <strong className="text-slate-800">{fmtCell(pv.grand, measure)}</strong>{measure === "students" || measure === "sites" || measure === "preceptors" || measure === "instructors" ? <span className="text-slate-400"> (distinct — cells do not sum to the total)</span> : measure === "instructorHours" || measure === "preceptorHours" ? <span className="text-slate-400"> (each learner&apos;s share of the supervisor&apos;s hours on the shift — adds up to the supervisor&apos;s time)</span> : null}</span>
            <button onClick={() => download(`clinical_site_load_${DIM_LABEL[rowDim]}${colDim ? `_by_${DIM_LABEL[colDim]}` : ""}_${stamp}.csv`, pivotToCsv(pv, DIM_LABEL[rowDim]))} className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Export this table ↓</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="text-[11px]">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="sticky left-0 bg-slate-50 px-3 py-1.5 text-left">{DIM_LABEL[rowDim]}</th>{pv.cols.map((c) => <th key={c.key} className="px-1.5 py-1.5 text-center font-normal">{isTimeDim(colDim!) ? fmtP(c.label) : c.label}</th>)}<th className="px-2 py-1.5 text-right">Total</th><th className="px-2 py-1.5 text-right">Share</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pv.rows.map((r) => { const max = Math.max(1, ...Object.values(r.cells)); return (
                  <tr key={r.key}>
                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1 font-medium text-slate-800">{isTimeDim(rowDim) ? fmtP(r.label) : r.label.replace(/ — .*$/, "").slice(0, 40)}</td>
                    {pv.cols.map((c) => { const v = r.cells[c.key] ?? 0; return <td key={c.key} className={`px-1.5 py-1 text-center tabular-nums ${heat(v, max)}`}>{v ? fmtCell(v, measure) : ""}</td>; })}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtCell(r.total, measure)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">{pv.grand ? pct(r.total / pv.grand) : "—"}</td>
                  </tr>
                ); })}
                {pv.rows.length > 0 && <tr className="bg-slate-50 font-semibold"><td className="sticky left-0 bg-slate-50 px-3 py-1">Total</td>{pv.cols.map((c) => <td key={c.key} className="px-1.5 py-1 text-center tabular-nums">{fmtCell(pv.colTotals[c.key] ?? 0, measure)}</td>)}<td className="px-2 py-1 text-right tabular-nums">{fmtCell(pv.grand, measure)}</td><td /></tr>}
                {pv.rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400">No clinical shifts match this query.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "time" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs"><span className="text-slate-500">Students on site per</span><div className="inline-flex overflow-hidden rounded-lg border border-slate-300">{(["week", "month"] as const).map((p) => <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 ${period === p ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{p}</button>)}</div><span className="text-slate-400">· top {grid.sites.length} sites by student-shifts</span></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="text-[11px]">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="sticky left-0 bg-slate-50 px-3 py-1.5 text-left">Site</th>{grid.periods.map((p) => <th key={p} className="px-1.5 py-1.5 text-center font-normal">{fmtP(p)}</th>)}<th className="px-2 py-1.5 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {grid.sites.map((s) => { const max = Math.max(1, ...Object.values(s.cells)); return (
                  <tr key={s.employerId ?? s.site}>
                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1 font-medium text-slate-800">{s.site.replace(/ — .*$/, "").slice(0, 34)}</td>
                    {grid.periods.map((p) => { const v = s.cells[p] ?? 0; return <td key={p} className={`px-1.5 py-1 text-center tabular-nums ${heat(v, max)}`}>{v || ""}</td>; })}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmt.num(s.total)}</td>
                  </tr>
                ); })}
                {grid.sites.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400">No dated clinical shifts match this query.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
