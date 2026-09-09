"use client";

// Room & campus utilization explorer — the master calendar's analytics. Pick a
// window, filter by program / course / cohort / type / weekday / building /
// room / on- vs off-campus, group by room · building · campus · site ·
// program · course · cohort · type · day · week · month · semester · year ·
// weekday · hour, and read booked hours, open hours, utilization, seat-hours
// and fill. Click a row to drill into its natural next level.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { utilizationAtoms, utilizationRollup, utilizationTotals, hourHeat, groupKey, UTIL_GROUPS, DRILL_INTO, fmtMDY, type UtilGroup, type UtilRow, type UtilRoom, type UtilMeeting, type SemesterWindow } from "@/lib/utilization";
import type { SemesterAnchors } from "@/lib/term";
import { dec } from "@/lib/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KINDS = [["CLASS", "Class"], ["LAB", "Lab"], ["CLINICAL", "Clinical"]] as const;
const PRESETS: { key: string; label: string }[] = [{ key: "all", label: "Every scheduled week" }, { key: "week", label: "This week" }, { key: "next-week", label: "Next week" }, { key: "month", label: "This month" }, { key: "quarter", label: "This quarter" }, { key: "semester", label: "This semester" }, { key: "year", label: "This year" }, { key: "next-year", label: "Next year" }, { key: "custom", label: "Custom" }];
const n = (x: number) => dec(x);
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const KIND_TONE: Record<string, string> = { CLASS: "text-sky-700", LAB: "text-violet-700", CLINICAL: "text-rose-700" };
const heatColor = (v: number, max: number) => (v <= 0 ? "transparent" : `rgba(225, 29, 72, ${0.12 + 0.75 * Math.min(1, v / max)})`);
const utilBar = (u: number | null) => (u == null ? "bg-slate-200" : u >= 0.85 ? "bg-rose-500" : u >= 0.5 ? "bg-amber-500" : "bg-emerald-500");

export function UtilizationExplorer({ institution, institutions, rooms, meetings, semesters, anchors, programs, from, to, preset, windowLabel }: {
  institution: { id: string; name: string }; institutions: { id: string; name: string }[];
  rooms: UtilRoom[]; meetings: UtilMeeting[]; semesters: SemesterWindow[]; anchors: SemesterAnchors;
  programs: { id: string; name: string }[];
  from: string; to: string; preset: string; windowLabel: string;
}) {
  const router = useRouter();
  const [groupBy, setGroupBy] = useState<UtilGroup>("room");
  const [programIds, setProgramIds] = useState<string[]>([]); const [courseIds, setCourseIds] = useState<string[]>([]); const [cohortIds, setCohortIds] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]); const [weekdays, setWeekdays] = useState<string[]>([]);
  const [buildingIds, setBuildingIds] = useState<string[]>([]); const [roomIds, setRoomIds] = useState<string[]>([]);
  const [where, setWhere] = useState<"campus" | "clinical" | undefined>(undefined);
  const [drill, setDrill] = useState<UtilRow | null>(null);
  const [customFrom, setCustomFrom] = useState(from); const [customTo, setCustomTo] = useState(to);

  const buildings = useMemo(() => [...new Map(rooms.filter((r) => r.buildingId).map((r) => [r.buildingId!, r.building!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rooms]);
  const courseOptions = useMemo(() => [...new Map(meetings.filter((m) => !programIds.length || programIds.includes(m.programId)).map((m) => [m.courseId, `${m.courseCode ?? m.courseName} · ${m.program}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [meetings, programIds]);
  const cohortOptions = useMemo(() => [...new Map(meetings.filter((m) => !programIds.length || programIds.includes(m.programId)).map((m) => [m.cohortId, `${m.cohort} · ${m.program}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [meetings, programIds]);
  const roomOptions = useMemo(() => rooms.filter((r) => !buildingIds.length || (r.buildingId && buildingIds.includes(r.buildingId))).sort((a, b) => a.name.localeCompare(b.name)), [rooms, buildingIds]);
  /** The room scope: the rooms the filters allow — their open hours are the denominator. */
  const scopeRooms = useMemo(() => rooms.filter((r) => (!buildingIds.length || (r.buildingId && buildingIds.includes(r.buildingId))) && (!roomIds.length || roomIds.includes(r.id))), [rooms, buildingIds, roomIds]);

  const filters = useMemo(() => ({ from, to, programIds, courseIds, cohortIds, kinds, weekdays, buildingIds, roomIds, where }), [from, to, programIds, courseIds, cohortIds, kinds, weekdays, buildingIds, roomIds, where]);
  const atoms = useMemo(() => utilizationAtoms(meetings, rooms, filters, semesters, anchors), [meetings, rooms, filters, semesters, anchors]);
  const rows = useMemo(() => utilizationRollup(atoms, scopeRooms, groupBy, from, to, semesters, anchors), [atoms, scopeRooms, groupBy, from, to, semesters, anchors]);
  const t = useMemo(() => utilizationTotals(atoms, scopeRooms, from, to), [atoms, scopeRooms, from, to]);
  const heat = useMemo(() => hourHeat(atoms), [atoms]);
  const heatMax = Math.max(0.001, ...Object.values(heat.grid).flat());
  const drillGroup = drill ? DRILL_INTO[groupBy] : null;
  const drillAtoms = useMemo(() => (drill ? atoms.filter((x) => groupKey(groupBy, x).key === drill.key) : []), [drill, atoms, groupBy]);
  const drillRooms = useMemo(() => (drill && drill.roomIds.length ? scopeRooms.filter((r) => drill.roomIds.includes(r.id)) : scopeRooms), [drill, scopeRooms]);
  const drillRows = useMemo(() => (drill && drillGroup ? utilizationRollup(drillAtoms, drillRooms, drillGroup, drill.dates[0] ?? from, drill.dates[drill.dates.length - 1] ?? to, semesters, anchors) : []), [drill, drillGroup, drillAtoms, drillRooms, from, to, semesters, anchors]);

  const go = (p: string, f = customFrom, tt = customTo) => router.push(`/utilization?inst=${institution.id}&preset=${p}${p === "custom" ? `&from=${f}&to=${tt}` : ""}`);
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const Chip = ({ on, label, onClick, title }: { on: boolean; label: string; onClick: () => void; title?: string }) => <button onClick={onClick} title={title} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>;
  const anyFilter = programIds.length || courseIds.length || cohortIds.length || kinds.length || weekdays.length || buildingIds.length || roomIds.length || where;
  const groupLabel = (g: UtilGroup) => UTIL_GROUPS.find((x) => x.key === g)?.label ?? g;

  const Row = ({ r, onClick, active }: { r: UtilRow; onClick?: () => void; active?: boolean }) => (
    <tr onClick={onClick} className={`${onClick ? "cursor-pointer hover:bg-rose-50/40" : ""} ${active ? "bg-rose-50/60" : ""}`}>
      <td className="px-3 py-1.5"><div className="font-medium text-slate-800">{r.label}</div>{r.sub && <div className="text-[10px] text-slate-400">{r.sub}</div>}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(r.bookings)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(r.days)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r.rooms || <span className="text-slate-300">—</span>}</td>
      <td className="px-2 py-1.5 text-right tabular-nums"><span className="font-medium text-slate-800">{n(r.hours)} h</span> <span className="text-[10px] text-slate-400">{KINDS.filter(([k]) => r.byKind[k]).map(([k, l]) => <span key={k} className={`ml-1 ${KIND_TONE[k]}`}>{l[0]} {n(r.byKind[k])}</span>)}</span></td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r.openHours == null ? <span className="text-slate-300">—</span> : `${n(r.openHours)} h`}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r.utilization == null ? <span className="text-slate-300">—</span> : <span className="inline-flex items-center justify-end gap-1"><span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${utilBar(r.utilization)}`} style={{ width: `${Math.min(100, r.utilization * 100)}%` }} /></span><span className="w-9 text-right">{pct(r.utilization)}</span></span>}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(r.seatHours)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.fill)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r.outsideHours ? <span className="rounded bg-amber-100 px-1 text-amber-800">{r.outsideHours}</span> : <span className="text-slate-300">·</span>}</td>
    </tr>
  );
  const Head = ({ first }: { first: string }) => (
    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">{first}</th><th className="px-2 py-1.5 text-right">Bookings</th><th className="px-2 py-1.5 text-right">Days</th><th className="px-2 py-1.5 text-right">Rooms</th><th className="px-2 py-1.5 text-right">Booked<br /><span className="font-normal normal-case">hours · by type</span></th><th className="px-2 py-1.5 text-right">Open<br /><span className="font-normal normal-case">room-hours</span></th><th className="px-2 py-1.5 text-right">Utilization</th><th className="px-2 py-1.5 text-right">Seat-hours</th><th className="px-2 py-1.5 text-right">Fill</th><th className="px-2 py-1.5 text-right" title="bookings outside the room's coded hours">Outside hrs</th></tr></thead>
  );

  return (
    <div className="space-y-4">
      {/* Window & filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={institution.id} onChange={(e) => router.push(`/utilization?inst=${e.target.value}&preset=${preset}`)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <span className="text-xs text-slate-400">window:</span>
          {PRESETS.map((p) => <Chip key={p.key} on={preset === p.key} label={p.label} onClick={() => go(p.key)} />)}
          {preset === "custom" && <span className="flex items-center gap-1 text-xs"><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded border border-slate-300 px-1.5 py-0.5" /> → <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded border border-slate-300 px-1.5 py-0.5" /><button onClick={() => go("custom")} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">go</button></span>}
          <span className="ml-auto text-sm font-semibold text-slate-800">{windowLabel} <span className="font-normal text-slate-400">· {from} → {to} · {t.days} days</span></span>
        </div>
        <div className="mt-2 grid gap-2 text-xs lg:grid-cols-2">
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">where</span><Chip on={!where} label="Everything" onClick={() => setWhere(undefined)} /><Chip on={where === "campus"} label="On campus (rooms)" onClick={() => setWhere("campus")} /><Chip on={where === "clinical"} label="Clinical sites" onClick={() => setWhere("clinical")} /><span className="ml-2 w-10 text-slate-400">type</span>{KINDS.map(([k, l]) => <Chip key={k} on={kinds.includes(k)} label={l} onClick={() => toggle(kinds, setKinds, k)} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">weekdays</span>{WEEKDAYS.map((d) => <Chip key={d} on={weekdays.includes(d)} label={d} onClick={() => toggle(weekdays, setWeekdays, d)} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">programs</span>{programs.map((p) => <Chip key={p.id} on={programIds.includes(p.id)} label={p.name} onClick={() => { toggle(programIds, setProgramIds, p.id); setCourseIds([]); setCohortIds([]); }} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">buildings</span>{buildings.map(([id, name]) => <Chip key={id} on={buildingIds.includes(id)} label={name} onClick={() => { toggle(buildingIds, setBuildingIds, id); setRoomIds([]); }} />)}</div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">courses</span>
            <select multiple value={courseIds} onChange={(e) => setCourseIds([...e.target.selectedOptions].map((o) => o.value))} className="h-16 min-w-[16rem] rounded border border-slate-300 px-1 text-xs">{courseOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <span className="w-14 text-slate-400">cohorts</span>
            <select multiple value={cohortIds} onChange={(e) => setCohortIds([...e.target.selectedOptions].map((o) => o.value))} className="h-16 min-w-[14rem] rounded border border-slate-300 px-1 text-xs">{cohortOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          </div>
          <div className="flex flex-wrap items-center gap-1"><span className="w-16 text-slate-400">rooms</span>
            <select multiple value={roomIds} onChange={(e) => setRoomIds([...e.target.selectedOptions].map((o) => o.value))} className="h-16 min-w-[18rem] rounded border border-slate-300 px-1 text-xs">{roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.building ? ` · ${r.building}` : ""}</option>)}</select>
            {anyFilter ? <button onClick={() => { setProgramIds([]); setCourseIds([]); setCohortIds([]); setKinds([]); setWeekdays([]); setBuildingIds([]); setRoomIds([]); setWhere(undefined); }} className="text-rose-600 hover:underline">clear filters</button> : null}
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Total utilization</div><div className="text-xl font-bold tabular-nums text-slate-900">{pct(t.utilization)}</div><div className="text-[11px] text-slate-500">{n(t.campusHours)} booked of {n(t.openHours)} open room-hours</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Bookings</div><div className="text-xl font-bold tabular-nums text-slate-900">{n(t.bookings)}</div><div className="text-[11px] text-slate-500">{n(t.hours)} h · {KINDS.filter(([k]) => t.byKind[k]).map(([k, l]) => `${l} ${n(t.byKind[k])}`).join(" · ")}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Rooms used</div><div className="text-xl font-bold tabular-nums text-slate-900">{t.roomsUsed} <span className="text-sm font-normal text-slate-400">/ {t.roomsInScope}</span></div><div className="text-[11px] text-slate-500">{t.roomsWithHours} with coded hours{t.roomsWithHours < t.roomsInScope ? ` · ${t.roomsInScope - t.roomsWithHours} without (not in the denominator)` : ""}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Seat-hours</div><div className="text-xl font-bold tabular-nums text-slate-900">{n(t.seatHours)}</div><div className="text-[11px] text-slate-500">rooms run {pct(t.fill)} full when booked</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Days with bookings</div><div className="text-xl font-bold tabular-nums text-slate-900">{t.daysWithBookings} <span className="text-sm font-normal text-slate-400">/ {t.days}</span></div><div className="text-[11px] text-slate-500">{t.busiestDay ? `busiest ${fmtMDY(t.busiestDay.iso)} · ${n(t.busiestDay.hours)} h` : "—"}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Outside room hours</div><div className={`text-xl font-bold tabular-nums ${t.outsideHours ? "text-amber-700" : "text-slate-900"}`}>{n(t.outsideHours)}</div><div className="text-[11px] text-slate-500">bookings before open / after close</div></div>
      </div>

      {/* Weekday × hour heat */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Weekday × hour</th>{heat.hours.map((h) => <th key={h} className="px-1 py-1.5 text-center font-normal">{h % 12 || 12}{h >= 12 ? "p" : "a"}</th>)}<th className="px-2 py-1.5 text-right">Hours</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {WEEKDAYS.map((d) => { const row = heat.grid[d]; const sum = row.reduce((a, b) => a + b, 0); return <tr key={d}><td className="px-3 py-1 font-medium text-slate-700">{d}</td>{row.map((v, i) => <td key={i} className="px-0.5 py-1 text-center tabular-nums" style={{ background: heatColor(v, heatMax) }} title={`${d} ${heat.hours[i]}:00 — ${n(v)} room-hours booked`}>{v > 0 ? n(v) : ""}</td>)}<td className="px-2 py-1 text-right tabular-nums font-medium">{sum > 0 ? n(sum) : <span className="text-slate-300">—</span>}</td></tr>; })}
          </tbody>
        </table>
      </div>

      {/* Grouped results */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs"><span className="text-slate-400">group by</span>{UTIL_GROUPS.map((g) => <Chip key={g.key} on={groupBy === g.key} label={g.label} onClick={() => { setGroupBy(g.key); setDrill(null); }} />)}<span className="ml-auto text-slate-500">{rows.length} rows · click one to drill into its {groupLabel(DRILL_INTO[groupBy]).toLowerCase()}s</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <Head first={groupLabel(groupBy)} />
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => <Row key={r.key} r={r} onClick={() => setDrill(drill?.key === r.key ? null : r)} active={drill?.key === r.key} />)}
              {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">No bookings in this window with these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-[11px] text-slate-400">Utilization = booked on-campus hours ÷ the open room-hours of the rooms in scope (a room with no coded hours is not counted; set hours under Rooms, buildings &amp; equipment). Fill = seat-hours ÷ booked hours × room capacity. Clinical bookings count in hours and seat-hours, never against room hours.</p>
      </div>

      {/* Drill-in */}
      {drill && drillGroup && (
        <div className="rounded-xl border border-rose-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50/40 px-3 py-2 text-sm"><span className="font-semibold text-slate-800">{drill.label} <span className="font-normal text-slate-500">— by {groupLabel(drillGroup).toLowerCase()} · {n(drill.bookings)} bookings · {n(drill.hours)} h{drill.utilization != null ? ` · ${pct(drill.utilization)} utilized` : ""}</span></span><button onClick={() => setDrill(null)} className="text-xs text-slate-500 hover:text-rose-700">close</button></div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-xs">
              <Head first={groupLabel(drillGroup)} />
              <tbody className="divide-y divide-slate-100">{drillRows.map((r) => <Row key={r.key} r={r} />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
