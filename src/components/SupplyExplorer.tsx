"use client";

// Asset supply explorer — query the physical clinical supply any way you
// think about it. Pick a window (today · this week · next week · month ·
// quarter · coded semester · year · custom), filter by site, setting, asset,
// agreement, weekday and shift block, group by asset / site / setting / day /
// week / month / semester / year, and read shifts, hours, learner seats,
// booked and available per block and in total. Click a row to drill into it.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { shiftAtoms, explore, totals, weekdayGrid, type GroupBy, type ExplorerRow } from "@/lib/supplyexplorer";
import type { AssetLite, AssetDayOverride, AssetBookingLite } from "@/lib/assetmap";
import type { ShiftBlock, Weekday } from "@/lib/clinicalsupply";

const BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GROUPS: { key: GroupBy; label: string }[] = [{ key: "asset", label: "Asset" }, { key: "site", label: "Site" }, { key: "setting", label: "Setting" }, { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "semester", label: "Semester" }, { key: "year", label: "Year" }];
const PRESETS: { key: string; label: string }[] = [{ key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "next-week", label: "Next week" }, { key: "month", label: "This month" }, { key: "quarter", label: "This quarter" }, { key: "semester", label: "This semester" }, { key: "year", label: "This year" }, { key: "next-year", label: "Next year" }, { key: "custom", label: "Custom" }];
const n = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const BLOCK_TONE: Record<string, string> = { Day: "text-amber-700", Evening: "text-indigo-700", Night: "text-slate-700" };

export function SupplyExplorer({ institution, institutions, assets, overrides, bookings, from, to, preset, windowLabel }: {
  institution: { id: string; name: string }; institutions: { id: string; name: string }[];
  assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: AssetBookingLite[];
  from: string; to: string; preset: string; windowLabel: string;
}) {
  const router = useRouter();
  const [groupBy, setGroupBy] = useState<GroupBy>("setting");
  const [sites, setSites] = useState<string[]>([]); const [settings, setSettings] = useState<string[]>([]); const [assetIds, setAssetIds] = useState<string[]>([]);
  const [agreement, setAgreement] = useState<string[]>([]); const [weekdays, setWeekdays] = useState<Weekday[]>([]); const [blocks, setBlocks] = useState<ShiftBlock[]>([]);
  const [drill, setDrill] = useState<ExplorerRow | null>(null);
  const [customFrom, setCustomFrom] = useState(from); const [customTo, setCustomTo] = useState(to);

  const siteOptions = useMemo(() => [...new Map(assets.map((a) => [a.employerId, a.facilityName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [assets]);
  const settingOptions = useMemo(() => [...new Map(assets.map((a) => [a.settingCode, a.setting])).entries()].sort(), [assets]);
  const assetOptions = useMemo(() => assets.filter((a) => (!sites.length || sites.includes(a.employerId)) && (!settings.length || settings.includes(a.settingCode))).map((a) => ({ id: a.id, label: `${a.facilityName} · ${a.setting} #${a.assetNumber}` })), [assets, sites, settings]);

  const atoms = useMemo(() => shiftAtoms(assets, overrides, bookings, { from, to, employerIds: sites, settingCodes: settings, assetIds, weekdays, blocks, agreement }), [assets, overrides, bookings, from, to, sites, settings, assetIds, weekdays, blocks, agreement]);
  const rows = useMemo(() => explore(atoms, groupBy), [atoms, groupBy]);
  const t = useMemo(() => totals(atoms), [atoms]);
  const grid = useMemo(() => weekdayGrid(atoms), [atoms]);
  const drillAtoms = useMemo(() => (drill ? atoms.filter((x) => explore([x], groupBy)[0]?.key === drill.key) : []), [drill, atoms, groupBy]);
  const drillRows = useMemo(() => (drill ? explore(drillAtoms, groupBy === "asset" ? "day" : groupBy === "day" ? "asset" : "asset") : []), [drill, drillAtoms, groupBy]);

  const go = (p: string, f = customFrom, tt = customTo) => router.push(`/supply?inst=${institution.id}&preset=${p}${p === "custom" ? `&from=${f}&to=${tt}` : ""}`);
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const Chip = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => <button onClick={onClick} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>;
  const Stat = ({ s }: { s: { shifts: number; hours: number; seats: number; booked: number; available: number } }) => <>{n(s.shifts)} shifts · {n(s.hours)} h · {n(s.seats)} seats · {n(s.booked)} booked · <strong>{n(s.available)}</strong> open</>;

  return (
    <div className="space-y-4">
      {/* Window & filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={institution.id} onChange={(e) => router.push(`/supply?inst=${e.target.value}&preset=${preset}`)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <span className="text-xs text-slate-400">window:</span>
          {PRESETS.map((p) => <Chip key={p.key} on={preset === p.key} label={p.label} onClick={() => (p.key === "custom" ? go("custom") : go(p.key))} />)}
          {preset === "custom" && <span className="flex items-center gap-1 text-xs"><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded border border-slate-300 px-1.5 py-0.5" /> → <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded border border-slate-300 px-1.5 py-0.5" /><button onClick={() => go("custom")} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">go</button></span>}
          <span className="ml-auto text-sm font-semibold text-slate-800">{windowLabel} <span className="font-normal text-slate-400">· {from} → {to} · {t.days} days</span></span>
        </div>
        <div className="mt-2 grid gap-2 text-xs lg:grid-cols-2">
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">weekdays</span>{WEEKDAYS.map((d) => <Chip key={d} on={weekdays.includes(d)} label={d} onClick={() => toggle(weekdays, setWeekdays, d)} />)}<span className="ml-2 w-12 text-slate-400">shifts</span>{BLOCKS.map((b) => <Chip key={b} on={blocks.includes(b)} label={b} onClick={() => toggle(blocks, setBlocks, b)} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">agreement</span>{["secured", "asked", "prospect", "none"].map((a) => <Chip key={a} on={agreement.includes(a)} label={a} onClick={() => toggle(agreement, setAgreement, a)} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">settings</span>{settingOptions.map(([code, name]) => <Chip key={code} on={settings.includes(code)} label={`${code} · ${name}`} onClick={() => toggle(settings, setSettings, code)} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">sites</span>
            <select multiple value={sites} onChange={(e) => setSites([...e.target.selectedOptions].map((o) => o.value))} className="h-16 min-w-[16rem] rounded border border-slate-300 px-1 text-xs">{siteOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <span className="w-14 text-slate-400">assets</span>
            <select multiple value={assetIds} onChange={(e) => setAssetIds([...e.target.selectedOptions].map((o) => o.value))} className="h-16 min-w-[18rem] rounded border border-slate-300 px-1 text-xs">{assetOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            {(sites.length || settings.length || assetIds.length || weekdays.length || blocks.length || agreement.length) ? <button onClick={() => { setSites([]); setSettings([]); setAssetIds([]); setWeekdays([]); setBlocks([]); setAgreement([]); }} className="text-rose-600 hover:underline">clear filters</button> : null}
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">All shifts</div><div className="text-xl font-bold tabular-nums text-slate-900">{n(t.total.shifts)}</div><div className="text-[11px] text-slate-500">{n(t.total.hours)} hours · {t.assets} assets at {t.sites} sites</div></div>
        {BLOCKS.map((b) => <div key={b} className="rounded-xl border border-slate-200 bg-white p-3"><div className={`text-[10px] uppercase tracking-wide ${BLOCK_TONE[b]}`}>{b} shifts</div><div className="text-xl font-bold tabular-nums text-slate-900">{n(t[b].shifts)}</div><div className="text-[11px] text-slate-500">{n(t[b].hours)} h · {n(t[b].seats)} seats · {n(t[b].booked)} booked · {n(t[b].available)} open</div></div>)}
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Learner seats</div><div className="text-xl font-bold tabular-nums text-slate-900">{n(t.total.seats)}</div><div className="text-[11px] text-slate-500">{n(t.total.booked)} booked · <strong>{n(t.total.available)}</strong> open · {pct(t.utilization)} used</div></div>
      </div>

      {/* Weekday × block */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Weekday × shift</th>{WEEKDAYS.map((d) => <th key={d} className="px-2 py-1.5 text-right">{d}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {BLOCKS.map((b) => <tr key={b}><td className={`px-3 py-1.5 font-medium ${BLOCK_TONE[b]}`}>{b}</td>{WEEKDAYS.map((d) => { const c = grid[d]?.[b]; return <td key={d} className="px-2 py-1.5 text-right tabular-nums">{c ? <><span className="font-medium text-slate-800">{n(c.shifts)}</span> <span className="text-slate-400">· {n(c.hours)} h · {n(c.available)}/{n(c.seats)} open</span></> : <span className="text-slate-300">—</span>}</td>; })}</tr>)}
          </tbody>
        </table>
      </div>

      {/* Grouped results */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs"><span className="text-slate-400">group by</span>{GROUPS.map((g) => <Chip key={g.key} on={groupBy === g.key} label={g.label} onClick={() => { setGroupBy(g.key); setDrill(null); }} />)}<span className="ml-auto text-slate-500">{rows.length} rows · click one to drill in</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">{GROUPS.find((g) => g.key === groupBy)?.label}</th><th className="px-2 py-1.5 text-right">Assets</th><th className="px-2 py-1.5 text-right">Days</th>{BLOCKS.map((b) => <th key={b} className={`px-2 py-1.5 text-right ${BLOCK_TONE[b]}`}>{b}<br /><span className="font-normal normal-case">shifts · h · open/seats</span></th>)}<th className="px-2 py-1.5 text-right">Total<br /><span className="font-normal normal-case">shifts · h</span></th><th className="px-2 py-1.5 text-right">Seats</th><th className="px-2 py-1.5 text-right">Booked</th><th className="px-2 py-1.5 text-right">Open</th><th className="px-2 py-1.5 text-right">Used</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} onClick={() => setDrill(drill?.key === r.key ? null : r)} className={`cursor-pointer hover:bg-rose-50/40 ${drill?.key === r.key ? "bg-rose-50/60" : ""}`}>
                  <td className="px-3 py-1.5"><div className="font-medium text-slate-800">{r.label}</div>{r.sub && <div className="text-[10px] text-slate-400">{r.sub}</div>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.assets}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.days}</td>
                  {BLOCKS.map((b) => <td key={b} className="px-2 py-1.5 text-right tabular-nums">{r[b].shifts ? <>{n(r[b].shifts)} · {n(r[b].hours)} h · {n(r[b].available)}/{n(r[b].seats)}</> : <span className="text-slate-300">—</span>}</td>)}
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{n(r.total.shifts)} · {n(r.total.hours)} h</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(r.total.seats)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n(r.total.booked)}</td><td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{n(r.total.available)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.utilization)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">No asset-shifts in this window with these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-in */}
      {drill && (
        <div className="rounded-xl border border-rose-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50/40 px-3 py-2 text-sm"><span className="font-semibold text-slate-800">{drill.label} <span className="font-normal text-slate-500">— {groupBy === "asset" ? "day by day" : "asset by asset"} · <Stat s={drill.total} /></span></span><button onClick={() => setDrill(null)} className="text-xs text-slate-500 hover:text-rose-700">close</button></div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">{groupBy === "asset" ? "Date" : "Asset"}</th>{BLOCKS.map((b) => <th key={b} className={`px-2 py-1.5 text-right ${BLOCK_TONE[b]}`}>{b}</th>)}<th className="px-2 py-1.5 text-right">Shifts · h</th><th className="px-2 py-1.5 text-right">Open / seats</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {drillRows.map((r) => <tr key={r.key}><td className="px-3 py-1"><span className="font-medium text-slate-800">{r.label}</span>{r.sub && <span className="ml-1 text-slate-400">{r.sub}</span>}</td>{BLOCKS.map((b) => <td key={b} className="px-2 py-1 text-right tabular-nums">{r[b].shifts ? `${n(r[b].shifts)} · ${n(r[b].hours)} h · ${n(r[b].available)}/${n(r[b].seats)}` : "—"}</td>)}<td className="px-2 py-1 text-right tabular-nums">{n(r.total.shifts)} · {n(r.total.hours)} h</td><td className="px-2 py-1 text-right tabular-nums">{n(r.total.available)} / {n(r.total.seats)}</td></tr>)}
              </tbody>
            </table>
          </div>
          {groupBy !== "asset" && groupBy !== "day" && <p className="px-3 py-2 text-[11px] text-slate-500">Each shift shown once per asset; to see one asset day by day, group by asset and click it.</p>}
        </div>
      )}
    </div>
  );
}
