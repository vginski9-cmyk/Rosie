"use client";

// Rooms, buildings & campuses, and equipment — the campus supply, structured:
// Campus → Building → Room, each room with coded open hours (per weekday) and
// dated closures, and equipment as its own records (fixed in a room, mobile
// between rooms, or portable) that can be assigned to rooms for periods.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRoom, updateRoom, deleteFacility, setRoomClosure, deleteRoomClosure, saveCampus, deleteCampus, saveBuilding, deleteBuilding, saveEquipment, deleteEquipment, assignEquipment, removeEquipmentAssignment } from "@/lib/actions";
import { HOURS_PRESETS, WEEKDAYS, EQUIPMENT_CATEGORIES, MOBILITY, type HoursSpan } from "@/lib/rooms";

export interface WsRoom { id: string; institutionId: string; institution: string; name: string; kind: string; roomNumber: string | null; floor: string | null; buildingId: string | null; building: string | null; buildingCode: string | null; campus: string | null; campusId: string | null; capacity: number | null; areaSqft: number | null; availability: string | null; notes: string | null; status: string; hours: HoursSpan[]; hoursLabel: string; closures: { id: string; date: string; openTime: string | null; closeTime: string | null; note: string | null }[]; weeklyOpen: number; weeklyBooked: number; utilization: number; outsideHours: number; bookings: number; equipment: { id: string; name: string; category: string; mobility: string; quantity: number; status: string; via: "home" | "assigned" }[] }
export interface WsCampus { id: string; institutionId: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null; notes: string | null; buildings: number }
export interface WsBuilding { id: string; institutionId: string; campusId: string | null; campus: string | null; name: string; code: string | null; address: string | null; floors: number | null; notes: string | null; rooms: number; equipment: number }
export interface WsEquipment { id: string; institutionId: string; name: string; category: string; mobility: string; quantity: number; make: string | null; model: string | null; serial: string | null; homeFacilityId: string | null; homeFacility: string | null; buildingId: string | null; building: string | null; status: string; acquiredDate: string | null; notes: string | null; assignments: { id: string; facilityId: string; facility: string; quantity: number; from: string | null; to: string | null; note: string | null }[] }
interface InstLite { id: string; name: string }

const KINDS = ["CLASSROOM", "LAB", "CLINICAL", "SIM", "OFFICE", "OTHER"];
const KIND_LABEL: Record<string, string> = { CLASSROOM: "Classroom", LAB: "Lab", CLINICAL: "Clinical", SIM: "Simulation", OFFICE: "Office", OTHER: "Other" };
const KIND_BADGE: Record<string, string> = { CLASSROOM: "bg-sky-100 text-sky-700", LAB: "bg-violet-100 text-violet-700", CLINICAL: "bg-rose-100 text-rose-700", SIM: "bg-amber-100 text-amber-700", OFFICE: "bg-slate-100 text-slate-600", OTHER: "bg-slate-100 text-slate-600" };
const MOB_BADGE: Record<string, string> = { fixed: "bg-slate-200 text-slate-700", mobile: "bg-sky-100 text-sky-800", portable: "bg-emerald-100 text-emerald-800" };
const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const h1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function RoomsWorkspace({ rooms, campuses, buildings, equipment, institutions, defaultInstitutionId }: { rooms: WsRoom[]; campuses: WsCampus[]; buildings: WsBuilding[]; equipment: WsEquipment[]; institutions: InstLite[]; defaultInstitutionId?: string }) {
  const [tab, setTab] = useState<"rooms" | "buildings" | "equipment">("rooms");
  const [fInst, setFInst] = useState(defaultInstitutionId ?? "");
  const instBuildings = buildings.filter((b) => !fInst || b.institutionId === fInst);
  const instCampuses = campuses.filter((c) => !fInst || c.institutionId === fInst);
  const instRooms = rooms.filter((r) => !fInst || r.institutionId === fInst);
  const instEquipment = equipment.filter((e) => !fInst || e.institutionId === fInst);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {([["rooms", `Rooms (${instRooms.length})`], ["buildings", `Campuses & buildings (${instCampuses.length} · ${instBuildings.length})`], ["equipment", `Equipment (${instEquipment.reduce((n, e) => n + e.quantity, 0)})`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 font-medium ${tab === k ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>
          ))}
        </div>
        <select value={fInst} onChange={(e) => setFInst(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          <option value="">Every institution</option>
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      {tab === "rooms" && <RoomsTab rooms={instRooms} buildings={instBuildings} campuses={instCampuses} institutions={institutions} defaultInstitutionId={fInst || defaultInstitutionId} />}
      {tab === "buildings" && <BuildingsTab campuses={instCampuses} buildings={instBuildings} institutions={institutions} defaultInstitutionId={fInst || defaultInstitutionId} />}
      {tab === "equipment" && <EquipmentTab equipment={instEquipment} rooms={instRooms} buildings={instBuildings} institutions={institutions} defaultInstitutionId={fInst || defaultInstitutionId} />}
    </div>
  );
}

// ── Rooms ────────────────────────────────────────────────────────────────────
function RoomsTab({ rooms, buildings, campuses, institutions, defaultInstitutionId }: { rooms: WsRoom[]; buildings: WsBuilding[]; campuses: WsCampus[]; institutions: InstLite[]; defaultInstitutionId?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(""); const [fCampus, setFCampus] = useState(""); const [fBuilding, setFBuilding] = useState(""); const [fKind, setFKind] = useState("");
  const [showAdd, setShowAdd] = useState(false); const [editing, setEditing] = useState<string | null>(null); const [open, setOpen] = useState<string | null>(null);
  const filtered = useMemo(() => rooms.filter((r) => (!fCampus || r.campusId === fCampus) && (!fBuilding || r.buildingId === fBuilding) && (!fKind || r.kind === fKind) && (!q || `${r.name} ${r.building ?? ""} ${r.roomNumber ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rooms, q, fCampus, fBuilding, fKind]);
  const seats = filtered.reduce((n, r) => n + (r.capacity ?? 0), 0);
  const openHrs = filtered.reduce((n, r) => n + r.weeklyOpen, 0), booked = filtered.reduce((n, r) => n + r.weeklyBooked, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="block"><span className={lbl}>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="room, number, building…" className="w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" /></label>
        <label className="block"><span className={lbl}>Campus</span><select value={fCampus} onChange={(e) => { setFCampus(e.target.value); setFBuilding(""); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block"><span className={lbl}>Building</span><select value={fBuilding} onChange={(e) => setFBuilding(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{buildings.filter((b) => !fCampus || b.campusId === fCampus).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="block"><span className={lbl}>Type</span><select value={fKind} onChange={(e) => setFKind(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add room"}</button>
      </div>
      {showAdd && <RoomForm institutions={institutions} buildings={buildings} defaultInstitutionId={defaultInstitutionId} onDone={() => { setShowAdd(false); router.refresh(); }} />}
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{filtered.length}</span> rooms · {seats} seats / stations · <span className="font-medium text-slate-700">{h1(openHrs)}</span> open hours a week · <span className="font-medium text-slate-700">{h1(booked)}</span> booked · utilization <span className="font-medium text-slate-700">{pct(openHrs ? booked / openHrs : 0)}</span>
        {filtered.some((r) => r.outsideHours > 0) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">⚠ {filtered.reduce((n, r) => n + r.outsideHours, 0)} bookings outside open hours</span>}
        {filtered.some((r) => r.hours.length === 0) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-amber-200">{filtered.filter((r) => r.hours.length === 0).length} rooms with no hours set</span>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left">Room</th><th className="px-3 py-2 text-left">Where</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Capacity</th><th className="px-3 py-2 text-left">Open hours</th><th className="px-3 py-2 text-right">Open / wk</th><th className="px-3 py-2 text-right">Booked / wk</th><th className="px-3 py-2 text-right">Utilization</th><th className="px-3 py-2 text-right">Equipment</th><th className="px-3 py-2"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => editing === r.id ? (
              <tr key={r.id} className="bg-rose-50/30"><td colSpan={10} className="px-3 py-3"><RoomForm institutions={institutions} buildings={buildings} room={r} onDone={() => { setEditing(null); router.refresh(); }} /></td></tr>
            ) : (
              <>
                <tr key={r.id} className={`align-top hover:bg-slate-50/60 ${r.status === "inactive" ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2"><button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-left"><span className="font-medium text-slate-800">{open === r.id ? "▾" : "▸"} {r.name}</span>{r.roomNumber && <span className="ml-1 text-xs text-slate-400">#{r.roomNumber}</span>}</button>{r.notes && <div className="text-[11px] text-slate-400">{r.notes}</div>}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.building ?? <span className="text-amber-700">no building</span>}{r.floor ? ` · floor ${r.floor}` : ""}{r.campus ? <div className="text-slate-400">{r.campus}</div> : null}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_BADGE[r.kind] ?? KIND_BADGE.OTHER}`}>{KIND_LABEL[r.kind] ?? r.kind}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.capacity ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.hours.length ? r.hoursLabel : <span className="text-amber-700">not set</span>}{r.closures.length ? <div className="text-[10px] text-slate-400">{r.closures.length} dated exception{r.closures.length === 1 ? "" : "s"}</div> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h1(r.weeklyOpen)} h</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h1(r.weeklyBooked)} h{r.outsideHours > 0 && <div className="text-[10px] text-amber-700">⚠ {r.outsideHours} outside hours</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums"><span className={r.utilization > 0.85 ? "font-semibold text-rose-700" : r.utilization > 0.6 ? "text-amber-700" : "text-slate-700"}>{r.weeklyOpen ? pct(r.utilization) : "—"}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.equipment.reduce((n, e) => n + e.quantity, 0) || "—"}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => setEditing(r.id)} className="text-xs text-rose-600 hover:underline">edit</button></td>
                </tr>
                {open === r.id && (
                  <tr key={r.id + "-x"} className="bg-slate-50/60"><td colSpan={10} className="px-4 py-3">
                    <div className="grid gap-4 md:grid-cols-3 text-xs">
                      <div>
                        <div className={lbl}>Open hours by day</div>
                        {WEEKDAYS.map((d) => { const s = r.hours.filter((x) => x.dayOfWeek === d); return <div key={d} className="flex gap-2"><span className="w-8 text-slate-500">{d}</span><span className={s.length ? "text-slate-800" : "text-slate-300"}>{s.length ? s.map((x) => `${x.openTime}–${x.closeTime}`).join(" & ") : "closed"}</span></div>; })}
                      </div>
                      <div>
                        <div className={lbl}>Equipment in this room</div>
                        {r.equipment.length === 0 && <div className="text-slate-400">none recorded</div>}
                        {r.equipment.map((e) => <div key={e.id + e.via} className="flex items-center gap-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${MOB_BADGE[e.mobility]}`}>{e.mobility}</span><span className="text-slate-800">{e.quantity > 1 ? `${e.quantity} × ` : ""}{e.name}</span><span className="text-slate-400">{e.category}{e.via === "assigned" ? " · assigned here" : ""}</span></div>)}
                      </div>
                      <div>
                        <div className={lbl}>Dated exceptions</div>
                        {r.closures.map((c) => <div key={c.id} className="flex items-center gap-2"><span className="tabular-nums text-slate-700">{c.date}</span><span className="text-slate-600">{c.openTime && c.closeTime ? `${c.openTime}–${c.closeTime}` : "closed"}</span>{c.note && <span className="text-slate-400">{c.note}</span>}<form action={async () => { await deleteRoomClosure(c.id); router.refresh(); }}><button className="text-slate-300 hover:text-rose-600">✕</button></form></div>)}
                        <form action={async (fd) => { await setRoomClosure(r.id, fd); router.refresh(); }} className="mt-1 flex flex-wrap items-end gap-1">
                          <input name="date" type="date" required className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
                          <input name="openTime" type="time" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" title="leave both times blank for closed all day" />
                          <input name="closeTime" type="time" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
                          <input name="note" placeholder="why" className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
                          <button className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">add</button>
                        </form>
                      </div>
                    </div>
                  </td></tr>
                )}
              </>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No rooms match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoomForm({ institutions, buildings, room, defaultInstitutionId, onDone }: { institutions: InstLite[]; buildings: WsBuilding[]; room?: WsRoom; defaultInstitutionId?: string; onDone: () => void }) {
  const [instId, setInstId] = useState(room?.institutionId ?? defaultInstitutionId ?? institutions[0]?.id ?? "");
  const [preset, setPreset] = useState(room ? "keep" : "weekday-extended");
  const [hours, setHours] = useState<Record<string, { o: string; c: string; o2: string; c2: string }>>(() => Object.fromEntries(WEEKDAYS.map((d) => { const s = (room?.hours ?? []).filter((x) => x.dayOfWeek === d).sort((a, b) => a.openTime.localeCompare(b.openTime)); return [d, { o: s[0]?.openTime ?? "", c: s[0]?.closeTime ?? "", o2: s[1]?.openTime ?? "", c2: s[1]?.closeTime ?? "" }]; })));
  const applyPreset = (k: string) => { setPreset(k); const p = HOURS_PRESETS.find((x) => x.key === k); if (p) setHours(Object.fromEntries(WEEKDAYS.map((d) => { const s = p.spans.find((x) => x.dayOfWeek === d); return [d, { o: s?.openTime ?? "", c: s?.closeTime ?? "", o2: "", c2: "" }]; }))); };
  return (
    <form action={async (fd) => { room ? await updateRoom(room.id, fd) : await createRoom(fd); onDone(); }} className="grid gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {!room && <label className="block"><span className={lbl}>Institution</span><select name="institutionId" value={instId} onChange={(e) => setInstId(e.target.value)} className={inp}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
      <label className="block"><span className={lbl}>Room name</span><input name="name" required defaultValue={room?.name} className={inp} /></label>
      <label className="block"><span className={lbl}>Building</span><select name="buildingId" defaultValue={room?.buildingId ?? ""} className={inp}><option value="">— none (add buildings on the next tab) —</option>{buildings.filter((b) => b.institutionId === instId).map((b) => <option key={b.id} value={b.id}>{b.name}{b.campus ? ` · ${b.campus}` : ""}</option>)}</select></label>
      <label className="block"><span className={lbl}>Room number</span><input name="roomNumber" defaultValue={room?.roomNumber ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Floor</span><input name="floor" defaultValue={room?.floor ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Type</span><select name="kind" defaultValue={room?.kind ?? "CLASSROOM"} className={inp}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
      <label className="block"><span className={lbl}>Capacity (seats / stations)</span><input name="capacity" type="number" step="1" defaultValue={room?.capacity ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Area (ft²)</span><input name="areaSqft" type="number" step="1" defaultValue={room?.areaSqft ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Status</span><select name="status" defaultValue={room?.status ?? "active"} className={inp}><option value="active">active</option><option value="inactive">inactive</option></select></label>
      <label className="block sm:col-span-2"><span className={lbl}>Availability notes</span><input name="availability" defaultValue={room?.availability ?? ""} placeholder="e.g. shared with continuing ed on Fridays" className={inp} /></label>
      <label className="block sm:col-span-2"><span className={lbl}>Notes</span><input name="notes" defaultValue={room?.notes ?? ""} className={inp} /></label>
      <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={lbl + " mb-0"}>Open hours</span>
          <select name="hoursPreset" value={preset} onChange={(e) => applyPreset(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            {room && <option value="keep">keep as set</option>}
            <option value="">custom (by day, below)</option>
            {HOURS_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <span className="text-[11px] text-slate-400">Coded per weekday — this is what availability and utilization are computed from. Leave a day blank for closed; use the second pair for a split day.</span>
        </div>
        <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {WEEKDAYS.map((d) => (
            <div key={d} className="flex items-center gap-1 text-xs">
              <span className="w-8 font-medium text-slate-600">{d}</span>
              <input name={`open_${d}`} type="time" value={hours[d].o} onChange={(e) => { setPreset(""); setHours((h) => ({ ...h, [d]: { ...h[d], o: e.target.value } })); }} className="rounded border border-slate-300 px-1 py-0.5" />
              <span>–</span>
              <input name={`close_${d}`} type="time" value={hours[d].c} onChange={(e) => { setPreset(""); setHours((h) => ({ ...h, [d]: { ...h[d], c: e.target.value } })); }} className="rounded border border-slate-300 px-1 py-0.5" />
              <input name={`open2_${d}`} type="time" value={hours[d].o2} onChange={(e) => { setPreset(""); setHours((h) => ({ ...h, [d]: { ...h[d], o2: e.target.value } })); }} className="w-20 rounded border border-slate-200 px-1 py-0.5 text-slate-500" title="second span (split day)" />
              <input name={`close2_${d}`} type="time" value={hours[d].c2} onChange={(e) => { setPreset(""); setHours((h) => ({ ...h, [d]: { ...h[d], c2: e.target.value } })); }} className="w-20 rounded border border-slate-200 px-1 py-0.5 text-slate-500" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-2 lg:col-span-4">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">{room ? "Save room" : "Add room"}</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
        {room && <button formAction={async () => { if (confirm("Delete this room?")) { await deleteFacility(room.id); onDone(); } }} className="rounded-lg px-2 py-2 text-xs text-slate-300 hover:text-rose-600">✕ delete</button>}
      </div>
    </form>
  );
}

// ── Campuses & buildings ─────────────────────────────────────────────────────
function BuildingsTab({ campuses, buildings, institutions, defaultInstitutionId }: { campuses: WsCampus[]; buildings: WsBuilding[]; institutions: InstLite[]; defaultInstitutionId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editC, setEditC] = useState<string | null>(null); const [editB, setEditB] = useState<string | null>(null);
  const instId0 = defaultInstitutionId ?? institutions[0]?.id ?? "";
  const done = () => { setEditC(null); setEditB(null); router.refresh(); };
  const CampusForm = ({ c }: { c?: WsCampus }) => (
    <form action={async (fd) => { await saveCampus(fd); done(); }} className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3 sm:grid-cols-3 lg:grid-cols-6">
      {c && <input type="hidden" name="id" value={c.id} />}
      <label className="block"><span className={lbl}>Institution</span><select name="institutionId" defaultValue={c?.institutionId ?? instId0} className={inp}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="block"><span className={lbl}>Campus name</span><input name="name" required defaultValue={c?.name} className={inp} /></label>
      <label className="block"><span className={lbl}>Address</span><input name="address" defaultValue={c?.address ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>City</span><input name="city" defaultValue={c?.city ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>State / ZIP</span><span className="flex gap-1"><input name="state" defaultValue={c?.state ?? "NC"} className={inp + " w-14"} /><input name="zip" defaultValue={c?.zip ?? ""} className={inp} /></span></label>
      <div className="flex items-end gap-2"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white">{c ? "Save" : "Add campus"}</button>{c && <button type="button" onClick={done} className="text-xs text-slate-500">cancel</button>}</div>
    </form>
  );
  const BuildingForm = ({ b }: { b?: WsBuilding }) => (
    <form action={async (fd) => { await saveBuilding(fd); done(); }} className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3 sm:grid-cols-3 lg:grid-cols-6">
      {b && <input type="hidden" name="id" value={b.id} />}
      <label className="block"><span className={lbl}>Institution</span><select name="institutionId" defaultValue={b?.institutionId ?? instId0} className={inp}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="block"><span className={lbl}>Campus</span><select name="campusId" defaultValue={b?.campusId ?? ""} className={inp}><option value="">—</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="block"><span className={lbl}>Building name</span><input name="name" required defaultValue={b?.name} className={inp} /></label>
      <label className="block"><span className={lbl}>Code</span><input name="code" defaultValue={b?.code ?? ""} placeholder="KENN" className={inp} /></label>
      <label className="block"><span className={lbl}>Floors</span><input name="floors" type="number" step="1" defaultValue={b?.floors ?? ""} className={inp} /></label>
      <div className="flex items-end gap-2"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white">{b ? "Save" : "Add building"}</button>{b && <button type="button" onClick={done} className="text-xs text-slate-500">cancel</button>}</div>
    </form>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Campuses</h3>
        <CampusForm />
        {campuses.map((c) => editC === c.id ? <CampusForm key={c.id} c={c} /> : (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><div><span className="font-medium text-slate-800">{c.name}</span><span className="ml-2 text-xs text-slate-500">{[c.address, c.city, c.state].filter(Boolean).join(", ")} · {c.buildings} building{c.buildings === 1 ? "" : "s"}</span></div><span className="flex gap-2 text-xs"><button onClick={() => setEditC(c.id)} className="text-rose-600 hover:underline">edit</button><button disabled={pending} onClick={() => { if (confirm("Delete this campus? Its buildings stay, unattached.")) startTransition(async () => { await deleteCampus(c.id); router.refresh(); }); }} className="text-slate-300 hover:text-rose-600">✕</button></span></div>
        ))}
        {campuses.length === 0 && <p className="text-xs text-slate-400">No campuses yet.</p>}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Buildings</h3>
        <BuildingForm />
        {buildings.map((b) => editB === b.id ? <BuildingForm key={b.id} b={b} /> : (
          <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><div><span className="font-medium text-slate-800">{b.name}</span>{b.code && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-mono text-slate-600">{b.code}</span>}<span className="ml-2 text-xs text-slate-500">{b.campus ?? "no campus"} · {b.rooms} room{b.rooms === 1 ? "" : "s"} · {b.equipment} equipment</span></div><span className="flex gap-2 text-xs"><button onClick={() => setEditB(b.id)} className="text-rose-600 hover:underline">edit</button><button disabled={pending} onClick={() => { if (confirm("Delete this building? Its rooms stay, unattached.")) startTransition(async () => { await deleteBuilding(b.id); router.refresh(); }); }} className="text-slate-300 hover:text-rose-600">✕</button></span></div>
        ))}
        {buildings.length === 0 && <p className="text-xs text-slate-400">No buildings yet.</p>}
      </div>
    </div>
  );
}

// ── Equipment ────────────────────────────────────────────────────────────────
function EquipmentTab({ equipment, rooms, buildings, institutions, defaultInstitutionId }: { equipment: WsEquipment[]; rooms: WsRoom[]; buildings: WsBuilding[]; institutions: InstLite[]; defaultInstitutionId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(""); const [fCat, setFCat] = useState(""); const [fMob, setFMob] = useState(""); const [fBuilding, setFBuilding] = useState("");
  const [showAdd, setShowAdd] = useState(false); const [editing, setEditing] = useState<string | null>(null); const [assigning, setAssigning] = useState<string | null>(null);
  const filtered = useMemo(() => equipment.filter((e) => (!fCat || e.category === fCat) && (!fMob || e.mobility === fMob) && (!fBuilding || e.buildingId === fBuilding) && (!q || `${e.name} ${e.make ?? ""} ${e.model ?? ""} ${e.homeFacility ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [equipment, q, fCat, fMob, fBuilding]);
  const byCat = new Map<string, number>(); for (const e of filtered) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.quantity);
  const done = () => { setShowAdd(false); setEditing(null); setAssigning(null); router.refresh(); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="block"><span className={lbl}>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, make, model, room…" className="w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" /></label>
        <label className="block"><span className={lbl}>Category</span><select value={fCat} onChange={(e) => setFCat(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="block"><span className={lbl}>Mobility</span><select value={fMob} onChange={(e) => setFMob(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{MOBILITY.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}</select></label>
        <label className="block"><span className={lbl}>Building</span><select value={fBuilding} onChange={(e) => setFBuilding(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add equipment"}</button>
      </div>
      {showAdd && <EquipmentForm institutions={institutions} rooms={rooms} buildings={buildings} defaultInstitutionId={defaultInstitutionId} onDone={done} />}
      <div className="flex flex-wrap gap-2 text-xs text-slate-500"><span className="font-medium text-slate-700">{filtered.reduce((n, e) => n + e.quantity, 0)}</span> pieces in {filtered.length} records · {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5">{c} {n}</span>)}</div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left">Equipment</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Mobility</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-left">Home room · building</th><th className="px-3 py-2 text-left">Assigned to rooms</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((e) => editing === e.id ? (
              <tr key={e.id} className="bg-rose-50/30"><td colSpan={8} className="px-3 py-3"><EquipmentForm institutions={institutions} rooms={rooms} buildings={buildings} item={e} onDone={done} /></td></tr>
            ) : (
              <tr key={e.id} className={`align-top hover:bg-slate-50/60 ${e.status === "retired" ? "opacity-50" : ""}`}>
                <td className="px-3 py-2"><div className="font-medium text-slate-800">{e.name}</div><div className="text-[11px] text-slate-400">{[e.make, e.model, e.serial ? `SN ${e.serial}` : null].filter(Boolean).join(" · ")}{e.notes ? ` — ${e.notes}` : ""}</div></td>
                <td className="px-3 py-2 text-xs text-slate-600">{e.category}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOB_BADGE[e.mobility]}`}>{e.mobility}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{e.quantity}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{e.homeFacility ?? <span className="text-slate-300">—</span>}{e.building ? <div className="text-slate-400">{e.building}</div> : null}</td>
                <td className="px-3 py-2 text-xs">
                  {e.assignments.map((a) => <div key={a.id} className="flex items-center gap-1.5"><span className="text-slate-800">{a.quantity > 1 ? `${a.quantity} × ` : ""}{a.facility}</span><span className="text-slate-400">{a.from ?? "…"} → {a.to ?? "open"}</span><button disabled={pending} onClick={() => startTransition(async () => { await removeEquipmentAssignment(a.id); router.refresh(); })} className="text-slate-300 hover:text-rose-600">✕</button></div>)}
                  {e.mobility !== "fixed" && (assigning === e.id ? (
                    <form action={async (fd) => { await assignEquipment(e.id, fd); done(); }} className="mt-1 flex flex-wrap items-end gap-1">
                      <select name="facilityId" required className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"><option value="">room…</option>{rooms.filter((r) => r.institutionId === e.institutionId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                      <input name="quantity" type="number" min="1" defaultValue={1} className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
                      <input name="from" type="date" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" /><input name="to" type="date" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
                      <button className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">place</button><button type="button" onClick={() => setAssigning(null)} className="text-[11px] text-slate-500">cancel</button>
                    </form>
                  ) : <button onClick={() => setAssigning(e.id)} className="mt-1 text-[11px] text-rose-600 hover:underline">+ place in a room</button>)}
                  {e.mobility === "fixed" && e.assignments.length === 0 && <span className="text-slate-300">fixed in its home room</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{e.status}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => setEditing(e.id)} className="text-xs text-rose-600 hover:underline">edit</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No equipment matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EquipmentForm({ institutions, rooms, buildings, item, defaultInstitutionId, onDone }: { institutions: InstLite[]; rooms: WsRoom[]; buildings: WsBuilding[]; item?: WsEquipment; defaultInstitutionId?: string; onDone: () => void }) {
  const [instId, setInstId] = useState(item?.institutionId ?? defaultInstitutionId ?? institutions[0]?.id ?? "");
  return (
    <form action={async (fd) => { await saveEquipment(fd); onDone(); }} className="grid gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className="block"><span className={lbl}>Institution</span><select name="institutionId" value={instId} onChange={(e) => setInstId(e.target.value)} className={inp}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="block"><span className={lbl}>Name</span><input name="name" required defaultValue={item?.name} placeholder="e.g. Energized x-ray tube stand" className={inp} /></label>
      <label className="block"><span className={lbl}>Category</span><select name="category" defaultValue={item?.category ?? "Other"} className={inp}>{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label className="block"><span className={lbl}>Mobility</span><select name="mobility" defaultValue={item?.mobility ?? "fixed"} className={inp}>{MOBILITY.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
      <label className="block"><span className={lbl}>Quantity</span><input name="quantity" type="number" min="1" step="1" defaultValue={item?.quantity ?? 1} className={inp} /></label>
      <label className="block"><span className={lbl}>Make</span><input name="make" defaultValue={item?.make ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Model</span><input name="model" defaultValue={item?.model ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Serial</span><input name="serial" defaultValue={item?.serial ?? ""} className={inp} /></label>
      <label className="block"><span className={lbl}>Home room (installed in / stored in)</span><select name="homeFacilityId" defaultValue={item?.homeFacilityId ?? ""} className={inp}><option value="">—</option>{rooms.filter((r) => r.institutionId === instId).map((r) => <option key={r.id} value={r.id}>{r.name}{r.building ? ` · ${r.building}` : ""}</option>)}</select></label>
      <label className="block"><span className={lbl}>Building (if no room)</span><select name="buildingId" defaultValue={item?.buildingId ?? ""} className={inp}><option value="">— from the home room —</option>{buildings.filter((b) => b.institutionId === instId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="block"><span className={lbl}>Status</span><select name="status" defaultValue={item?.status ?? "active"} className={inp}><option value="active">active</option><option value="maintenance">maintenance</option><option value="retired">retired</option></select></label>
      <label className="block"><span className={lbl}>Acquired</span><input name="acquiredDate" type="date" defaultValue={item?.acquiredDate ?? ""} className={inp} /></label>
      <label className="block sm:col-span-2 lg:col-span-3"><span className={lbl}>Notes</span><input name="notes" defaultValue={item?.notes ?? ""} className={inp} /></label>
      <div className="flex items-end gap-2">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">{item ? "Save" : "Add equipment"}</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
        {item && <button formAction={async () => { if (confirm("Delete this equipment record?")) { await deleteEquipment(item.id); onDone(); } }} className="text-xs text-slate-300 hover:text-rose-600">✕</button>}
      </div>
    </form>
  );
}
