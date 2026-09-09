"use client";

// THE ASSET ROSTER — a site's rooms, units and machines for ONE program, as a table you can
// read and edit in place: one row per asset, days as seven toggles, the three shifts as
// on/off with a start and a length, learners and preceptors per shift. Above it, what the
// roster adds up to per setting — seats by weekday and shift — so the shift structure is
// visible at a glance. "Add rooms" creates N of a kind in one go from a schedule preset.
// Day-by-day exceptions (closures, holidays) live on the organization record.

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AssetLite } from "@/lib/assetmap";
import { saveClinicalAsset, createClinicalAssets, duplicateClinicalAsset, deleteClinicalAsset, type AssetInput } from "@/lib/actions";
import { dec } from "@/lib/format";

export interface RosterSetting { code: string; name: string; assetType?: string }
export interface RosterAsset extends AssetLite { notes?: string | null; exceptions?: number }
type Block = "Day" | "Evening" | "Night";
interface Draft { assetType: string; days: string[]; blocks: Record<Block, { on: boolean; start: string; hours: number }>; learnersPerShift: number; preceptorsPerShift: number; dataSource: string }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS: Block[] = ["Day", "Evening", "Night"];
const PRESETS: { key: string; label: string; days: string[]; blocks: Draft["blocks"] }[] = [
  { key: "wd", label: "Weekday day (Mon–Fri 07:00, 8 h)", days: DAYS.slice(0, 5), blocks: { Day: { on: true, start: "07:00", hours: 8 }, Evening: { on: false, start: "15:00", hours: 8 }, Night: { on: false, start: "23:00", hours: 8 } } },
  { key: "wde", label: "Weekday day + evening (07:00 and 15:00, 8 h each)", days: DAYS.slice(0, 5), blocks: { Day: { on: true, start: "07:00", hours: 8 }, Evening: { on: true, start: "15:00", hours: 8 }, Night: { on: false, start: "23:00", hours: 8 } } },
  { key: "247", label: "24 × 7 — three 8-hour shifts", days: DAYS, blocks: { Day: { on: true, start: "07:00", hours: 8 }, Evening: { on: true, start: "15:00", hours: 8 }, Night: { on: true, start: "23:00", hours: 8 } } },
  { key: "12s", label: "7-day, two 12-hour shifts (07:00 and 19:00)", days: DAYS, blocks: { Day: { on: true, start: "07:00", hours: 12 }, Evening: { on: false, start: "15:00", hours: 8 }, Night: { on: true, start: "19:00", hours: 12 } } },
  { key: "or", label: "OR day (Mon–Fri 07:00, 10 h)", days: DAYS.slice(0, 5), blocks: { Day: { on: true, start: "07:00", hours: 10 }, Evening: { on: false, start: "15:00", hours: 8 }, Night: { on: false, start: "23:00", hours: 8 } } },
];
const toDraft = (a: RosterAsset): Draft => { const on = a.shiftBlocks.split(",").map((s) => s.trim()); return { assetType: a.assetType, days: a.days.split(",").map((s) => s.trim()).filter(Boolean), blocks: { Day: { on: on.includes("Day"), start: a.dayStart ?? "07:00", hours: a.dayHours ?? a.hoursPerShift }, Evening: { on: on.includes("Evening"), start: a.eveningStart ?? "15:00", hours: a.eveningHours ?? a.hoursPerShift }, Night: { on: on.includes("Night"), start: a.nightStart ?? "23:00", hours: a.nightHours ?? a.hoursPerShift } }, learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource }; };
const toInput = (a: RosterAsset, d: Draft): AssetInput => ({ externalId: a.externalId, settingCode: a.settingCode, setting: a.setting, assetType: d.assetType, assetNumber: a.assetNumber, days: d.days, blocks: BLOCKS.filter((b) => d.blocks[b].on).map((b) => ({ block: b, start: d.blocks[b].start, hours: d.blocks[b].hours })), serves: a.serves, learnersPerShift: d.learnersPerShift, preceptorsPerShift: d.preceptorsPerShift, dataSource: d.dataSource, notes: a.notes ?? null, accreditorClass: a.accreditorClass ?? null });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const inp = "rounded border border-slate-300 px-1 py-0.5 text-[11px]";

export function AssetRoster({ employerId, siteName, siteExternalId, assets, settings, programName, organizationHref }: { employerId: string; siteName: string; siteExternalId?: string | null; assets: RosterAsset[]; settings: RosterSetting[]; programName: string; organizationHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [add, setAdd] = useState({ settingCode: settings[0]?.code ?? "", assetType: settings[0]?.assetType ?? "", count: 1, preset: "wd", learners: 1, preceptors: 1, source: "ESTIMATE" });
  const refresh = () => router.refresh();
  const draftOf = (a: RosterAsset) => drafts[a.id] ?? toDraft(a);
  const setDraft = (a: RosterAsset, patch: Partial<Draft>) => setDrafts((m) => ({ ...m, [a.id]: { ...draftOf(a), ...patch } }));
  const live = assets.filter((a) => a.status !== "archived");
  const bySetting = useMemo(() => { const m = new Map<string, RosterAsset[]>(); for (const a of live) { const l = m.get(a.settingCode) ?? []; l.push(a); m.set(a.settingCode, l); } for (const l of m.values()) l.sort((x, y) => x.assetNumber - y.assetNumber); return m; }, [live]);
  const settingName = (code: string) => settings.find((s) => s.code === code)?.name ?? live.find((a) => a.settingCode === code)?.setting ?? code;
  // Seats by weekday × block per setting — the shift structure at a glance.
  const grid = (list: RosterAsset[]) => { const g: Record<string, Record<Block, number>> = {}; for (const d of DAYS) g[d] = { Day: 0, Evening: 0, Night: 0 }; for (const a of list) { const dr = draftOf(a); for (const d of dr.days) for (const b of BLOCKS) if (dr.blocks[b].on) g[d][b] += dr.learnersPerShift; } return g; };
  const weekly = (list: RosterAsset[]) => list.reduce((n, a) => { const d = draftOf(a); return n + d.days.length * BLOCKS.filter((b) => d.blocks[b].on).length * d.learnersPerShift; }, 0);

  return (
    <div className="space-y-4">
      {/* What it adds up to, per setting */}
      {bySetting.size > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...bySetting.entries()].map(([code, list]) => { const g = grid(list); const seats = list.reduce((n, a) => n + draftOf(a).learnersPerShift, 0); return (
            <div key={code} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between"><span className="font-semibold text-slate-800"><span className="mr-1 rounded bg-slate-800 px-1 font-mono text-[10px] text-white">{code}</span>{settingName(code)}</span><span className="tabular-nums text-slate-600">{list.length} asset{list.length === 1 ? "" : "s"} · {seats} seats/shift · {dec(weekly(list))} learner-shifts/wk</span></div>
              <table className="mt-1 w-full text-center text-[10px] tabular-nums"><thead><tr><th className="text-left font-normal text-slate-400">seats</th>{DAYS.map((d) => <th key={d} className="font-normal text-slate-400">{d[0]}</th>)}</tr></thead>
                <tbody>{BLOCKS.map((b) => <tr key={b}><td className="text-left text-slate-500">{b}</td>{DAYS.map((d) => <td key={d} className={g[d][b] ? "font-medium text-slate-800" : "text-slate-200"}>{g[d][b] || "·"}</td>)}</tr>)}</tbody></table>
            </div>
          ); })}
        </div>
      )}

      {/* Add rooms */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3 text-xs">
        <div className="basis-full text-sm font-semibold text-slate-800">Add rooms, units or machines {programName} students can be placed on</div>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Setting</span>
          <select value={add.settingCode} onChange={(e) => { const s = settings.find((x) => x.code === e.target.value); setAdd({ ...add, settingCode: e.target.value, assetType: s?.assetType ?? add.assetType }); }} className={inp + " py-1"}>{settings.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">What it is</span><input value={add.assetType} onChange={(e) => setAdd({ ...add, assetType: e.target.value })} placeholder="e.g. OR suite, R&F room" className={inp + " w-40 py-1"} /></label>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">How many</span><input type="number" min={1} max={60} value={add.count} onChange={(e) => setAdd({ ...add, count: Number(e.target.value) })} className={inp + " w-14 py-1 text-right"} /></label>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Schedule</span><select value={add.preset} onChange={(e) => setAdd({ ...add, preset: e.target.value })} className={inp + " py-1"}>{PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Learners / shift</span><input type="number" min={0} value={add.learners} onChange={(e) => setAdd({ ...add, learners: Number(e.target.value) })} className={inp + " w-14 py-1 text-right"} /></label>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Preceptors / shift</span><input type="number" min={0} value={add.preceptors} onChange={(e) => setAdd({ ...add, preceptors: Number(e.target.value) })} className={inp + " w-14 py-1 text-right"} /></label>
        <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Source</span><select value={add.source} onChange={(e) => setAdd({ ...add, source: e.target.value })} className={inp + " py-1"}><option value="VERIFIED">confirmed with site</option><option value="ESTIMATE">estimate</option></select></label>
        <button disabled={pending || !add.settingCode} onClick={() => { const p = PRESETS.find((x) => x.key === add.preset)!; const input: AssetInput = { settingCode: add.settingCode, setting: settingName(add.settingCode), assetType: add.assetType || settingName(add.settingCode), days: p.days, blocks: BLOCKS.filter((b) => p.blocks[b].on).map((b) => ({ block: b, start: p.blocks[b].start, hours: p.blocks[b].hours })), learnersPerShift: add.learners, preceptorsPerShift: add.preceptors, dataSource: add.source }; start(async () => { await createClinicalAssets(employerId, input, add.count, siteExternalId ?? null); refresh(); }); }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">+ Add {add.count > 1 ? `${add.count} ` : ""}{add.assetType || "asset"}{add.count > 1 ? "s" : ""}</button>
        <span className="basis-full text-[11px] text-slate-500">Each row can then be tuned — days, shifts, start times, lengths, learners. A shift is a block a student can be placed in; learners per shift is how many students the room takes at once.</span>
      </div>

      {/* The roster */}
      {live.length === 0 ? <p className="text-sm text-slate-400">No {programName} assets at {siteName} yet — add the first ones above.</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">What it is</th><th className="px-2 py-1.5 text-left">Days it runs</th>{BLOCKS.map((b) => <th key={b} className="px-2 py-1.5 text-left whitespace-nowrap">{b} · start · hrs</th>)}<th className="px-2 py-1.5 text-right">Learners</th><th className="px-2 py-1.5 text-right">Preceptors</th><th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Wk learner-shifts</th><th className="px-2 py-1.5"></th></tr></thead>
            <tbody>
              {[...bySetting.entries()].map(([code, list]) => (
                <Fragment key={code}>
                  <tr className="bg-slate-50/70"><td colSpan={11} className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600"><span className="mr-1 rounded bg-slate-800 px-1 font-mono text-white">{code}</span>{settingName(code)} <span className="font-normal normal-case text-slate-400">— {list.length}</span></td></tr>
                  {list.map((a) => { const d = draftOf(a); const dirty = !same(d, toDraft(a)); const wk = d.days.length * BLOCKS.filter((b) => d.blocks[b].on).length * d.learnersPerShift; return (
                    <tr key={a.id} className={`border-t border-slate-100 ${dirty ? "bg-amber-50/40" : ""}`}>
                      <td className="px-2 py-1 whitespace-nowrap text-slate-500">{a.assetNumber}{a.externalId ? <span className="block font-mono text-[9px] text-slate-400">{a.externalId}</span> : null}</td>
                      <td className="px-2 py-1"><input value={d.assetType} onChange={(e) => setDraft(a, { assetType: e.target.value })} className={inp + " w-36"} /></td>
                      <td className="px-2 py-1 whitespace-nowrap">{DAYS.map((day) => { const on = d.days.includes(day); return <button key={day} type="button" onClick={() => setDraft(a, { days: on ? d.days.filter((x) => x !== day) : DAYS.filter((x) => d.days.includes(x) || x === day) })} className={`mr-0.5 rounded px-1 py-0.5 text-[10px] ${on ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-400"}`}>{day[0]}</button>; })}</td>
                      {BLOCKS.map((b) => <td key={b} className="px-2 py-1 whitespace-nowrap"><label className="inline-flex items-center gap-1"><input type="checkbox" checked={d.blocks[b].on} onChange={(e) => setDraft(a, { blocks: { ...d.blocks, [b]: { ...d.blocks[b], on: e.target.checked } } })} /><input type="time" value={d.blocks[b].start} disabled={!d.blocks[b].on} onChange={(e) => setDraft(a, { blocks: { ...d.blocks, [b]: { ...d.blocks[b], start: e.target.value } } })} className={inp + " w-[5.6rem] disabled:opacity-40"} /><input type="number" step="any" min={1} max={24} value={d.blocks[b].hours} disabled={!d.blocks[b].on} onChange={(e) => setDraft(a, { blocks: { ...d.blocks, [b]: { ...d.blocks[b], hours: Number(e.target.value) } } })} className={inp + " w-12 text-right disabled:opacity-40"} /></label></td>)}
                      <td className="px-2 py-1 text-right"><input type="number" min={0} value={d.learnersPerShift} onChange={(e) => setDraft(a, { learnersPerShift: Number(e.target.value) })} className={inp + " w-12 text-right"} /></td>
                      <td className="px-2 py-1 text-right"><input type="number" min={0} value={d.preceptorsPerShift} onChange={(e) => setDraft(a, { preceptorsPerShift: Number(e.target.value) })} className={inp + " w-12 text-right"} /></td>
                      <td className="px-2 py-1"><select value={d.dataSource} onChange={(e) => setDraft(a, { dataSource: e.target.value })} className={inp}><option value="VERIFIED">confirmed</option><option value="ESTIMATE">estimate</option><option value="GAP">gap</option></select></td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">{dec(wk)}{a.exceptions ? <span className="block text-[9px] text-amber-600">{a.exceptions} exception{a.exceptions === 1 ? "" : "s"}</span> : null}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right">
                        {dirty ? <><button disabled={pending} onClick={() => start(async () => { await saveClinicalAsset(employerId, a.id, toInput(a, d)); setDrafts((m) => { const c = { ...m }; delete c[a.id]; return c; }); refresh(); })} className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-medium text-white">save</button><button onClick={() => setDrafts((m) => { const c = { ...m }; delete c[a.id]; return c; })} className="ml-1 text-[10px] text-slate-400 hover:text-slate-700">undo</button></> : <>
                          <button disabled={pending} onClick={() => { const n = Number(prompt("How many more like this?", "1")); if (n > 0) start(async () => { await duplicateClinicalAsset(a.id, n); refresh(); }); }} className="text-[10px] text-slate-500 hover:text-rose-700" title="add more like this">+ like this</button>
                          <button disabled={pending} onClick={() => { if (confirm(`Remove ${a.setting} #${a.assetNumber}?`)) start(async () => { await deleteClinicalAsset(a.id, employerId); refresh(); }); }} className="ml-2 text-slate-300 hover:text-rose-600" title="remove">✕</button>
                        </>}
                      </td>
                    </tr>
                  ); })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-400">Closures, holidays and other day-by-day exceptions for these assets are set on the <Link href={organizationHref} className="text-rose-600 hover:underline">organization record</Link>, where the calendar view lives; the year&apos;s shifts here follow the weekly structure unless an exception says otherwise.</p>
    </div>
  );
}
