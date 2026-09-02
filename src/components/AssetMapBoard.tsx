"use client";

// The 365-day clinical asset map, worked the way a clinical coordinator works
// it: the verdict per setting (physical ceiling vs secured vs booked), every
// date × shift × setting with demand against the assets open that day, booking
// learners onto specific assets, every site's assets with their 365-day strip
// (click a day to close it), the rotation-type → setting join, and the partner
// workbook in and out.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildInstances, type DatedInstance, type CohortCalendarInput } from "@/lib/capacitymodel";
import {
  assetTotals, assetSupply, assetDemand, assetMatch, settingVerdicts, assetsAvailable, blocksOn, overrideIndex, overrideKey, isoRange, parseAssetMapWorkbook, ASSET_BLOCKS,
  type AssetLite, type AssetDayOverride, type AssetBookingLite, type AssetMatchCell, type ParsedAssetMap,
} from "@/lib/assetmap";
import { weekdayOfIso, type ShiftBlock } from "@/lib/clinicalsupply";
import { bookAsset, unbookAsset, setAssetDay, importAssetMap, upsertRotationSetting } from "@/lib/actions";
import type { CapacityCohort } from "@/components/CapacityBoard";

const n0 = (v: number) => Math.round(v).toLocaleString();
const fmtD = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
type Tab = "verdict" | "dates" | "book" | "assets" | "rotations" | "io";

export interface RotationCodeRow { rotationType: string; settingCode: string | null; unitCategory: string }

export function AssetMapBoard({ institutionId, assets, overrides, bookings, rotations, cohorts, from, to, year }: {
  institutionId: string; assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: AssetBookingLite[]; rotations: RotationCodeRow[];
  cohorts: CapacityCohort[]; from: string; to: string; year: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("verdict");
  const [sel, setSel] = useState<{ iso: string; block: ShiftBlock; settingCode: string } | null>(null);

  const rows: DatedInstance[] = useMemo(() => cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])), holidays: c.holidays, courses: c.courses,
  } as CohortCalendarInput, c.assumptions).filter((i) => i.mondayIso != null)), [cohorts]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const supply = useMemo(() => assetSupply(assets, overrides, from, to), [assets, overrides, from, to]);
  const demand = useMemo(() => assetDemand(rows, rotations), [rows, rotations]);
  const cells = useMemo(() => assetMatch(demand, supply, bookings, assetById), [demand, supply, bookings, assetById]);
  const verdicts = useMemo(() => settingVerdicts(cells, assets), [cells, assets]);
  const totalsWindow = useMemo(() => assetTotals(assets, overrides, from, to), [assets, overrides, from, to]);
  const totalsYear = useMemo(() => assetTotals(assets, overrides, `${year}-01-01`, `${year}-12-31`), [assets, overrides, year]);
  const unmapped = useMemo(() => [...new Set(demand.filter((d) => !d.settingCode).map((d) => d.rotationType))], [demand]);
  const settingCodes = useMemo(() => [...new Set(assets.map((a) => a.settingCode))].sort(), [assets]);
  const settingName = (code: string) => assets.find((a) => a.settingCode === code)?.setting ?? code;
  const sites = useMemo(() => { const m = new Map<string, AssetLite[]>(); for (const a of assets) { const l = m.get(a.employerId) ?? []; l.push(a); m.set(a.employerId, l); } return [...m.values()].sort((x, y) => x[0].facilityName.localeCompare(y[0].facilityName)); }, [assets]);
  const securedAssets = assets.filter((a) => a.agreementStatus === "secured").length;
  const shortCells = cells.filter((c) => c.shortSecured > 0);
  const demandTotal = cells.reduce((n, c) => n + c.demand, 0);
  const bookedTotal = cells.reduce((n, c) => n + Math.min(c.demand, c.booked), 0);
  const refresh = () => router.refresh();

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">365-day clinical asset map — supply vs demand, asset by asset</h2>
          <p className="max-w-3xl text-sm text-slate-500">
            Supply is every physical asset a partner reports — each radiographic room, ED room, portable, C-arm and fluoro room — with its operating rule on every calendar day (the physical ceiling), times the learners each asset can take per shift.
            Demand is every dated clinical shift, mapped from rotation type to setting. Book learners onto specific assets, date by date.
          </p>
        </div>
        <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300 text-sm">
          {([["verdict", "Verdict by setting"], ["dates", "Every date & shift"], ["book", "Book onto assets"], ["assets", "Assets by site · 365 days"], ["rotations", "Rotation → setting"], ["io", "Partner workbook in / out"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "verdict" && (
        <div className="space-y-4">
          <p className="text-base text-slate-800">
            <strong>{n0(assets.length)} physical assets</strong> across {sites.length} sites, <strong className="text-emerald-700">{n0(securedAssets)} at secured sites</strong>.
            From {fmtD(from)} to {fmtD(to)} the offerings need <strong>{n0(demandTotal)} learner-shifts</strong>
            {demandTotal > 0 && <> — the physical ceiling can host <strong>{n0(verdicts.reduce((n, v) => n + v.hostedPhysical, 0))}</strong>, secured sites <strong className="text-emerald-700">{n0(verdicts.reduce((n, v) => n + v.hostedSecured, 0))}</strong>, and <strong>{n0(bookedTotal)}</strong> are booked onto a specific asset</>}.
            {shortCells.length > 0 ? <> <strong className="text-rose-700">{n0(shortCells.length)} date-shifts</strong> exceed what secured sites can host.</> : demandTotal > 0 ? <> <span className="text-emerald-700">Every date-shift fits within secured sites.</span></> : null}
            {unmapped.length > 0 && <> <span className="text-amber-700">Rotation types with no setting yet: {unmapped.join(", ")} — map them under Rotation → setting.</span></>}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2 font-semibold">Setting</th><th className="px-2 py-2 text-right font-semibold">Assets (secured)</th><th className="px-2 py-2 text-right font-semibold">Asset-shifts in window D / E / N</th><th className="px-2 py-2 text-right font-semibold">Demand (learner-shifts)</th><th className="px-2 py-2 text-right font-semibold">Physical hosts</th><th className="px-2 py-2 text-right font-semibold">Secured hosts</th><th className="px-2 py-2 text-right font-semibold">Booked</th><th className="px-2 py-2 text-right font-semibold">Short date-shifts</th><th className="px-2 py-2 font-semibold">Peak</th><th className="px-2 py-2 font-semibold">Rotations served</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settingCodes.map((code) => {
                  const v = verdicts.find((x) => x.settingCode === code);
                  const t = totalsWindow.settings.find((s) => s.settingCode === code);
                  const as = assets.filter((a) => a.settingCode === code);
                  return (
                    <tr key={code} className={v && v.shortDays > 0 ? "bg-rose-50/40" : ""}>
                      <td className="px-3 py-2"><span className="font-mono text-[10px] text-slate-400">{code}</span> <span className="font-medium text-slate-800">{settingName(code)}</span></td>
                      <td className="px-2 py-2 text-right tabular-nums">{as.length} <span className="text-emerald-700">({as.filter((a) => a.agreementStatus === "secured").length})</span></td>
                      <td className="px-2 py-2 text-right tabular-nums">{t ? `${n0(t.day)} / ${n0(t.evening)} / ${n0(t.night)}` : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v ? n0(v.demandShifts) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v ? n0(v.hostedPhysical) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{v ? n0(v.hostedSecured) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v ? n0(v.booked) : "—"}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${v && v.shortDays > 0 ? "font-semibold text-rose-700" : ""}`}>{v ? n0(v.shortDays) : "—"}</td>
                      <td className="px-2 py-2 text-slate-600">{v?.peak ? `${fmtD(v.peak.iso)} ${v.peak.block}: ${n0(v.peak.demand)} learners vs ${n0(v.peak.securedLearners)} secured seats (${n0(v.peak.learners)} physical)` : "—"}</td>
                      <td className="px-2 py-2 text-slate-600">{v?.rotationTypes.join(" · ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">The partner workbook&apos;s totals, reproduced for {year}</div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
              <span>Physical assets <strong>{n0(totalsYear.grand.assets)}</strong></span><span>Available asset-shifts <strong>{n0(totalsYear.grand.total)}</strong></span>
              <span>Day <strong>{n0(totalsYear.grand.day)}</strong></span><span>Evening <strong>{n0(totalsYear.grand.evening)}</strong></span><span>Night <strong>{n0(totalsYear.grand.night)}</strong></span>
              <span>Asset hours <strong>{n0(totalsYear.grand.hours)}</strong></span><span>Calendar days <strong>{totalsYear.days}</strong></span>
            </div>
          </div>
        </div>
      )}

      {tab === "dates" && <DatesTab cells={cells} settingName={settingName} onPick={(c) => { setSel({ iso: c.iso, block: c.block, settingCode: c.settingCode }); setTab("book"); }} />}

      {tab === "book" && (
        <BookTab sel={sel} setSel={setSel} settingCodes={settingCodes} settingName={settingName} assets={assets} overrides={overrides} bookings={bookings} demand={demand} cells={cells}
          pending={pending} onBook={(input) => startTransition(async () => { const r = await bookAsset(input); if (!r.ok) alert(r.reason); refresh(); })} onUnbook={(id) => startTransition(async () => { await unbookAsset(id); refresh(); })} />
      )}

      {tab === "assets" && <AssetsTab sites={sites} overrides={overrides} bookings={bookings} year={year} pending={pending} onToggleDay={(assetId, iso, current) => startTransition(async () => { await setAssetDay(assetId, iso, current); refresh(); })} />}

      {tab === "rotations" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Which physical setting serves each clinical rotation type — the join between what the template asks for and what partners report.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rotations.map((r) => (
              <form key={r.rotationType} action={async (fd) => { await upsertRotationSetting(institutionId, fd); refresh(); }} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <input type="hidden" name="rotationType" value={r.rotationType} /><input type="hidden" name="unitCategory" value={r.unitCategory} />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{r.rotationType}</span>
                <select name="settingCode" defaultValue={r.settingCode ?? ""} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
                  <option value="">— no asset setting —</option>{settingCodes.map((c) => <option key={c} value={c}>{c} · {settingName(c)}</option>)}
                </select>
                <button className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white">Save</button>
              </form>
            ))}
          </div>
          {unmapped.length > 0 && <p className="text-xs text-amber-700">Rotation types in your templates with no row yet: {unmapped.join(", ")}. Add them with the form below.</p>}
          <form action={async (fd) => { await upsertRotationSetting(institutionId, fd); refresh(); }} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Rotation type</span><input name="rotationType" required className="rounded border border-slate-300 px-2 py-1" /></label>
            <input type="hidden" name="unitCategory" value="Imaging" />
            <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Setting</span><select name="settingCode" className="rounded border border-slate-300 px-2 py-1">{settingCodes.map((c) => <option key={c} value={c}>{c} · {settingName(c)}</option>)}</select></label>
            <button className="rounded bg-rose-600 px-3 py-1.5 font-medium text-white">+ Add</button>
          </form>
        </div>
      )}

      {tab === "io" && <IoTab institutionId={institutionId} year={year} sites={sites} pending={pending} onImport={(p) => startTransition(async () => { const r = await importAssetMap(institutionId, p); alert(`Imported ${r.assets} assets across ${r.sites} sites (${r.newSites} new), ${r.exceptions} date exceptions.`); refresh(); })} />}
    </section>
  );
}

// ── Every date & shift ────────────────────────────────────────────────────────
function DatesTab({ cells, settingName, onPick }: { cells: AssetMatchCell[]; settingName: (c: string) => string; onPick: (c: AssetMatchCell) => void }) {
  const [setting, setSetting] = useState("all"); const [block, setBlock] = useState("all"); const [onlyShort, setOnlyShort] = useState(false); const [month, setMonth] = useState("all");
  const months = [...new Set(cells.map((c) => c.iso.slice(0, 7)))];
  const settings = [...new Set(cells.map((c) => c.settingCode))].sort();
  const list = cells.filter((c) => (setting === "all" || c.settingCode === setting) && (block === "all" || c.block === block) && (!onlyShort || c.shortSecured > 0 || c.unbooked > 0) && (month === "all" || c.iso.startsWith(month)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-slate-300 px-2 py-1"><option value="all">every month</option>{months.map((m) => <option key={m} value={m}>{new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}</select>
        <select value={setting} onChange={(e) => setSetting(e.target.value)} className="rounded border border-slate-300 px-2 py-1"><option value="all">every setting</option>{settings.map((s) => <option key={s} value={s}>{s} · {settingName(s)}</option>)}</select>
        <select value={block} onChange={(e) => setBlock(e.target.value)} className="rounded border border-slate-300 px-2 py-1"><option value="all">every shift</option>{ASSET_BLOCKS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} /> only short or unbooked</label>
        <span className="text-slate-400">{n0(list.length)} date-shifts · click one to book</span>
      </div>
      <div className="max-h-[36rem] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Shift</th><th className="px-2 py-2 font-semibold">Setting</th><th className="px-2 py-2 text-right font-semibold">Assets open</th><th className="px-2 py-2 text-right font-semibold">Seats</th><th className="px-2 py-2 text-right font-semibold">Secured seats</th><th className="px-2 py-2 text-right font-semibold">Demand</th><th className="px-2 py-2 text-right font-semibold">Booked</th><th className="px-2 py-2 text-right font-semibold">Unbooked</th><th className="px-2 py-2 text-right font-semibold">Short (secured)</th><th className="px-2 py-2 font-semibold">Who</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.slice(0, 600).map((c) => (
              <tr key={`${c.iso}|${c.block}|${c.settingCode}`} onClick={() => onPick(c)} className={`cursor-pointer hover:bg-rose-50/60 ${c.shortSecured > 0 ? "bg-rose-50/40" : c.unbooked > 0 ? "bg-amber-50/40" : ""}`}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtD(c.iso)}</td><td className="px-2 py-1.5">{c.block}</td><td className="px-2 py-1.5">{c.settingCode}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.assets}</td><td className="px-2 py-1.5 text-right tabular-nums">{c.learners}</td><td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{c.securedLearners}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{c.demand}</td><td className="px-2 py-1.5 text-right tabular-nums">{c.booked}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${c.unbooked > 0 ? "font-semibold text-amber-700" : ""}`}>{c.unbooked}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${c.shortSecured > 0 ? "font-semibold text-rose-700" : ""}`}>{c.shortSecured}</td>
                <td className="px-2 py-1.5 text-slate-500">{c.cohorts.join(" · ")} · {c.rotationTypes.join(" · ")}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={11} className="px-3 py-3 text-slate-400">No dated clinical demand in this slice.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Book learners onto assets ─────────────────────────────────────────────────
function BookTab({ sel, setSel, settingCodes, settingName, assets, overrides, bookings, demand, cells, pending, onBook, onUnbook }: {
  sel: { iso: string; block: ShiftBlock; settingCode: string } | null; setSel: (s: { iso: string; block: ShiftBlock; settingCode: string }) => void;
  settingCodes: string[]; settingName: (c: string) => string; assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: AssetBookingLite[];
  demand: ReturnType<typeof assetDemand>; cells: AssetMatchCell[]; pending: boolean;
  onBook: (i: Parameters<typeof bookAsset>[0]) => void; onUnbook: (id: string) => void;
}) {
  const first = cells[0];
  const cur = sel ?? (first ? { iso: first.iso, block: first.block, settingCode: first.settingCode } : { iso: new Date().toISOString().slice(0, 10), block: "Day" as ShiftBlock, settingCode: settingCodes[0] ?? "GEN" });
  const points = demand.filter((d) => d.iso === cur.iso && d.block === cur.block && d.settingCode === cur.settingCode);
  const [pointKey, setPointKey] = useState<string>("");
  const [students, setStudents] = useState(1);
  const point = points.find((p) => `${p.cohortId}|${p.sessionId}` === pointKey) ?? points[0] ?? null;
  const avail = assetsAvailable(assets, overrides, bookings, cur.iso, cur.block, cur.settingCode);
  const cell = cells.find((c) => c.iso === cur.iso && c.block === cur.block && c.settingCode === cur.settingCode);
  const cellBookings = bookings.filter((b) => b.date === cur.iso && b.block === cur.block && assets.find((a) => a.id === b.assetId)?.settingCode === cur.settingCode);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Date</span><input type="date" value={cur.iso} onChange={(e) => e.target.value && setSel({ ...cur, iso: e.target.value })} className="rounded border border-slate-300 px-2 py-1" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Shift</span><select value={cur.block} onChange={(e) => setSel({ ...cur, block: e.target.value as ShiftBlock })} className="rounded border border-slate-300 px-2 py-1">{ASSET_BLOCKS.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Setting</span><select value={cur.settingCode} onChange={(e) => setSel({ ...cur, settingCode: e.target.value })} className="rounded border border-slate-300 px-2 py-1">{settingCodes.map((c) => <option key={c} value={c}>{c} · {settingName(c)}</option>)}</select></label>
        {cell && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{fmtD(cur.iso)} {cur.block}: demand <strong>{cell.demand}</strong> · seats <strong>{cell.learners}</strong> (secured {cell.securedLearners}) · booked <strong>{cell.booked}</strong></span>}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Who needs a seat that shift</div>
          {points.length === 0 ? <p className="mt-1 text-xs text-slate-400">No clinical demand mapped to {cur.settingCode} on this date and shift.</p> : (
            <ul className="mt-1 space-y-1 text-xs">
              {points.map((p) => { const k = `${p.cohortId}|${p.sessionId}`; const on = point && `${point.cohortId}|${point.sessionId}` === k; return (
                <li key={k}><button onClick={() => setPointKey(k)} className={`w-full rounded px-2 py-1 text-left ${on ? "bg-rose-50 ring-1 ring-rose-300" : "hover:bg-slate-50"}`}><span className="font-medium text-slate-800">{p.program} · {p.cohort}</span> <span className="text-slate-500">{p.courseCode ?? ""} · {p.rotationType} · {p.students} learners in {p.sections} section{p.sections === 1 ? "" : "s"}{p.startTime ? ` · ${p.startTime}` : ""}</span></button></li>
              ); })}
            </ul>
          )}
          <label className="mt-2 block text-xs"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Learners per booking</span><input type="number" min={1} value={students} onChange={(e) => setStudents(Math.max(1, Number(e.target.value) || 1))} className="w-20 rounded border border-slate-300 px-2 py-1" /></label>
          {cellBookings.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Booked this shift</div>
              <ul className="mt-1 space-y-1 text-xs">
                {cellBookings.map((b) => { const a = assets.find((x) => x.id === b.assetId); return (
                  <li key={b.id} className="flex items-center gap-2"><span className="flex-1">{b.students} learner{b.students === 1 ? "" : "s"} · {b.program ?? ""} {b.cohort ?? ""} → <strong>{a?.externalId ?? a?.assetType}</strong> @ {a?.facilityName}</span><button onClick={() => onUnbook(b.id)} disabled={pending} className="text-slate-400 hover:text-rose-700">unbook</button></li>
                ); })}
              </ul>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Assets open {fmtD(cur.iso)} · {cur.block} · {settingName(cur.settingCode)} — secured first</div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 font-semibold">Asset</th><th className="px-2 py-1.5 font-semibold">Site</th><th className="px-2 py-1.5 font-semibold">Agreement</th><th className="px-2 py-1.5 text-right font-semibold">Seats</th><th className="px-2 py-1.5 text-right font-semibold">Free</th><th className="px-2 py-1.5" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {avail.map(({ asset: a, free, booked }) => (
                  <tr key={a.id}>
                    <td className="px-3 py-1.5"><span className="font-mono text-slate-700">{a.externalId ?? a.id.slice(-6)}</span> <span className="text-slate-500">{a.assetType} #{a.assetNumber}</span></td>
                    <td className="px-2 py-1.5 text-slate-700">{a.facilityName}</td>
                    <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${AGREEMENT[a.agreementStatus ?? "none"]}`}>{a.agreementStatus ?? "none"}</span></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.learnersPerShift}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${free === 0 ? "text-slate-400" : "font-semibold text-emerald-700"}`}>{free}{booked ? ` (${booked} booked)` : ""}</td>
                    <td className="px-2 py-1.5 text-right"><button disabled={pending || !point || free < students} onClick={() => point && onBook({ assetId: a.id, cohortId: point.cohortId, sessionId: point.sessionId, sectionIndex: 1, date: cur.iso, block: cur.block, students })} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">Book</button></td>
                  </tr>
                ))}
                {avail.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-slate-400">No asset of this setting operates on this date and shift.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Assets by site with the 365-day strip ─────────────────────────────────────
function AssetsTab({ sites, overrides, bookings, year, pending, onToggleDay }: { sites: AssetLite[][]; overrides: AssetDayOverride[]; bookings: AssetBookingLite[]; year: number; pending: boolean; onToggleDay: (assetId: string, iso: string, blocks: string | null) => void }) {
  const [open, setOpen] = useState<string | null>(sites[0]?.[0]?.employerId ?? null);
  const [yr, setYr] = useState(year);
  const ov = useMemo(() => overrideIndex(overrides), [overrides]);
  const days = useMemo(() => [...isoRange(`${yr}-01-01`, `${yr}-12-31`)], [yr]);
  const bookedOn = useMemo(() => { const m = new Map<string, number>(); for (const b of bookings) m.set(`${b.assetId}|${b.date}`, (m.get(`${b.assetId}|${b.date}`) ?? 0) + b.students); return m; }, [bookings]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label>Year <select value={yr} onChange={(e) => setYr(Number(e.target.value))} className="ml-1 rounded border border-slate-300 px-2 py-1">{[year - 1, year, year + 1, year + 2].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-slate-200" /> closed</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-300" /> 1 shift</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-500" /> 2</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-800" /> 3</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-amber-400" /> learners booked</span>
        <span className="text-slate-400">Click a day to close it (or re-open it) for that asset — an exception to its operating rule.</span>
      </div>
      {sites.map((list) => {
        const s = list[0]; const isOpen = open === s.employerId;
        return (
          <div key={s.employerId} className="rounded-xl border border-slate-200">
            <button onClick={() => setOpen(isOpen ? null : s.employerId)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
              <span><span className="font-semibold text-slate-800">{s.facilityName}</span> <span className="text-xs text-slate-500">{s.facilityExternalId ? `· ${s.facilityExternalId}` : ""} · {s.county ?? ""} · {s.ring ?? ""}</span> <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${AGREEMENT[s.agreementStatus ?? "none"]}`}>{s.agreementStatus ?? "none"}</span></span>
              <span className="text-xs text-slate-600">{list.length} assets · {[...new Set(list.map((a) => a.settingCode))].join(" · ")}</span>
            </button>
            {isOpen && (
              <div className="overflow-x-auto border-t border-slate-100 px-3 py-2">
                <table className="text-[11px]">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="pr-2 font-semibold">Asset</th><th className="pr-2 font-semibold">Setting</th><th className="pr-2 font-semibold">Rule</th><th className="pr-2 text-right font-semibold">Learners/shift</th><th className="font-semibold">{yr} — every day</th></tr></thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} className="align-middle">
                        <td className="whitespace-nowrap pr-2 font-mono text-slate-700">{a.externalId ?? a.id.slice(-6)}</td>
                        <td className="whitespace-nowrap pr-2 text-slate-600">{a.settingCode} · {a.assetType}</td>
                        <td className="whitespace-nowrap pr-2 text-slate-600">{a.operatingRule} · {a.shiftBlocks.split(",").map((b) => b[0]).join("")} · {a.days.split(",").length}d · {a.hoursPerShift}h</td>
                        <td className="pr-2 text-right tabular-nums">{a.learnersPerShift}</td>
                        <td>
                          <div className="flex flex-wrap gap-px" style={{ width: 365 * 3 + 12 * 4 }}>
                            {days.map((iso) => {
                              const o = ov.get(overrideKey(a.id, iso)); const n = blocksOn(a, iso, o).length; const bk = bookedOn.get(`${a.id}|${iso}`) ?? 0;
                              const color = bk ? "bg-amber-400" : n === 0 ? "bg-slate-200" : n === 1 ? "bg-sky-300" : n === 2 ? "bg-sky-500" : "bg-sky-800";
                              return <button key={iso} disabled={pending} onClick={() => onToggleDay(a.id, iso, o ? null : "")} title={`${fmtD(iso)} · ${n ? blocksOn(a, iso, o).join(", ") : "closed"}${o ? " (exception)" : ""}${bk ? ` · ${bk} learner(s) booked` : ""}`} className={`h-3 w-[3px] ${color} ${iso.endsWith("-01") ? "ml-1" : ""} ${o ? "ring-1 ring-rose-500" : ""}`} />;
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Partner workbook in / out ─────────────────────────────────────────────────
function IoTab({ institutionId, year, sites, pending, onImport }: { institutionId: string; year: number; sites: AssetLite[][]; pending: boolean; onImport: (p: ParsedAssetMap) => void }) {
  const [parsed, setParsed] = useState<ParsedAssetMap | null>(null);
  const [name, setName] = useState<string | null>(null);
  const load = async (f: File) => {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
    const sheets: Record<string, unknown[][]> = {};
    for (const sn of wb.SheetNames) sheets[sn] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    setParsed(parseAssetMapWorkbook(sheets)); setName(f.name);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-4" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }}>
        <div className="text-sm font-semibold text-slate-800">Import a partner&apos;s asset map</div>
        <p className="mt-1 text-xs text-slate-500">Drop the workbook a partner returns — an <strong>ASSET_MAP</strong> sheet (asset_id, facility_id, facility_name, setting_code, setting, asset_type, asset_number, operating_rule, serves, day/evening/night shifts) and, if they filled it in, the <strong>365_SHIFT_MAP</strong> (asset × date × shift). Dates that differ from the asset&apos;s rule become exceptions. The file&apos;s assets replace those sites&apos; assets; learner rules stay yours to set.</p>
        <input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} className="mt-2 text-xs" />
        {parsed && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="font-semibold text-slate-800">{name}</div>
            <div className="mt-1 text-slate-700">{parsed.assets.length} assets · {new Set(parsed.assets.map((a) => a.facilityExternalId || a.facilityName)).size} sites · {parsed.exceptions.length} date exceptions{parsed.mapDates ? ` · map covers ${parsed.mapDates.from} → ${parsed.mapDates.to}` : " · no 365 map sheet (rules only)"}</div>
            {parsed.issues.length > 0 && <ul className="mt-1 text-amber-700">{parsed.issues.slice(0, 6).map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
            <div className="mt-2 max-h-40 overflow-auto"><table className="w-full"><tbody>{parsed.assets.slice(0, 40).map((a) => <tr key={a.externalId}><td className="pr-2 font-mono">{a.externalId}</td><td className="pr-2">{a.facilityName}</td><td className="pr-2">{a.settingCode}</td><td className="pr-2">{a.assetType}</td><td>{a.operatingRule}</td></tr>)}</tbody></table>{parsed.assets.length > 40 && <div className="text-slate-400">… {parsed.assets.length - 40} more</div>}</div>
            <button disabled={pending || !parsed.assets.length} onClick={() => onImport(parsed)} className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Importing…" : "Import into the asset map"}</button>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="text-sm font-semibold text-slate-800">Send partners the workbook to fill in</div>
        <p className="mt-1 text-xs text-slate-500">The same four sheets the partner map uses — TOTALS, ASSET_MAP, 365_SHIFT_MAP, FACILITY_TOTALS — generated from what is coded now, so a site can correct it and send it back.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {[year - 1, year, year + 1].map((y) => <a key={y} href={`/api/asset-map?institutionId=${institutionId}&year=${y}`} className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-700">Whole map · {y}</a>)}
        </div>
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Per site · {year}</div>
        <ul className="mt-1 grid gap-1 text-xs sm:grid-cols-2">{sites.map((l) => <li key={l[0].employerId}><a href={`/api/asset-map?institutionId=${institutionId}&year=${year}&employerId=${l[0].employerId}`} className="text-rose-700 hover:underline">{l[0].facilityName}</a> <span className="text-slate-400">({l.length})</span></li>)}</ul>
      </div>
    </div>
  );
}
