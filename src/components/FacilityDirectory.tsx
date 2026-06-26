"use client";

import { useMemo, useState } from "react";
import { createFacility, updateFacility, deleteFacility } from "@/lib/actions";

export interface DirFacility {
  id: string;
  name: string;
  kind: string;
  building: string | null;
  capacity: number | null;
  areaSqft: number | null;
  hours: string | null;
  availability: string | null;
  equipment: string | null;
  status: string;
  institution: { id: string; name: string };
}
export interface InstLite { id: string; name: string }

const KINDS = ["CLASSROOM", "LAB", "CLINICAL", "SIM", "OTHER"];
const KIND_LABEL: Record<string, string> = { CLASSROOM: "Classroom", LAB: "Lab", CLINICAL: "Clinical", SIM: "Sim", OTHER: "Other" };
const KIND_BADGE: Record<string, string> = {
  CLASSROOM: "bg-sky-100 text-sky-700", LAB: "bg-violet-100 text-violet-700", CLINICAL: "bg-rose-100 text-rose-700",
  SIM: "bg-amber-100 text-amber-700", OTHER: "bg-slate-100 text-slate-600",
};

export function FacilityDirectory({ facilities, institutions }: { facilities: DirFacility[]; institutions: InstLite[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fKind, setFKind] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return facilities.filter((r) => {
      if (fInst && r.institution.id !== fInst) return false;
      if (fKind && r.kind !== fKind) return false;
      if (needle && !(r.name.toLowerCase().includes(needle) || (r.building ?? "").toLowerCase().includes(needle) || (r.equipment ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [facilities, q, fInst, fKind]);

  const byKind = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of filtered) m[r.kind] = (m[r.kind] ?? 0) + 1;
    return m;
  }, [filtered]);
  const totalSeats = filtered.reduce((n, r) => n + (r.capacity ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, building, equipment…" className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={fInst} onChange={(e) => setFInst(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {(q || fInst || fKind) && <button onClick={() => { setQ(""); setFInst(""); setFKind(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add facility"}</button>
      </div>

      {showAdd && <FacilityForm institutions={institutions} onDone={() => setShowAdd(false)} />}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{filtered.length}</span> spaces · {totalSeats} total seats/stations
        {Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
          <span key={k} className={`rounded-full px-2 py-0.5 ${KIND_BADGE[k] ?? "bg-slate-100 text-slate-600"}`}>{KIND_LABEL[k] ?? k} {n}</span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Facility</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-center font-semibold">Capacity</th>
              <th className="px-3 py-2 text-center font-semibold">Area</th>
              <th className="px-3 py-2 text-left font-semibold">Hours</th>
              <th className="px-3 py-2 text-left font-semibold">Equipment</th>
              <th className="px-3 py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              editing === r.id ? (
                <tr key={r.id} className="bg-rose-50/30"><td colSpan={7} className="px-3 py-3"><FacilityForm institutions={institutions} facility={r} onDone={() => setEditing(null)} compact /></td></tr>
              ) : (
                <tr key={r.id} className={`hover:bg-slate-50/60 ${r.status === "inactive" ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    <span className="block text-[11px] text-slate-400">{[r.building, r.institution.name].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_BADGE[r.kind] ?? "bg-slate-100 text-slate-600"}`}>{KIND_LABEL[r.kind] ?? r.kind}</span></td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{r.capacity ?? "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-500">{r.areaSqft != null ? `${r.areaSqft.toLocaleString()} ft²` : "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{r.hours ?? "—"}</td>
                  <td className="px-3 py-2 text-[12px] text-slate-500">{r.equipment ? (r.equipment.length > 48 ? r.equipment.slice(0, 48) + "…" : r.equipment) : "—"}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => setEditing(r.id)} className="text-xs text-rose-600 hover:underline">edit</button></td>
                </tr>
              )
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">No facilities match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FacilityForm({ institutions, facility, onDone, compact }: { institutions: InstLite[]; facility?: DirFacility; onDone: () => void; compact?: boolean }) {
  return (
    <form
      action={async (fd) => { facility ? await updateFacility(facility.id, fd) : await createFacility(fd); onDone(); }}
      className={compact ? "grid gap-3 sm:grid-cols-3 lg:grid-cols-4" : "grid gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4"}
    >
      {!facility && (
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
          <select name="institutionId" required defaultValue={institutions[0]?.id} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      )}
      <Field name="name" label="Name" defaultValue={facility?.name} required />
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Type</span>
        <select name="kind" defaultValue={facility?.kind ?? "CLASSROOM"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <Field name="building" label="Building" defaultValue={facility?.building} />
      <Field name="capacity" label="Capacity (seats)" type="number" defaultValue={facility?.capacity != null ? String(facility.capacity) : ""} />
      <Field name="areaSqft" label="Area (ft²)" type="number" defaultValue={facility?.areaSqft != null ? String(facility.areaSqft) : ""} />
      <Field name="hours" label="Hours" defaultValue={facility?.hours} placeholder="Mon–Fri 8a–9p" />
      <Field name="availability" label="Availability" defaultValue={facility?.availability} placeholder="open evenings" />
      <label className="block sm:col-span-2 lg:col-span-2">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Equipment</span>
        <input name="equipment" defaultValue={facility?.equipment ?? ""} placeholder="DR room, CR reader, 2 viewboxes…" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
        <select name="status" defaultValue={facility?.status ?? "active"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          <option value="active">active</option><option value="inactive">inactive</option>
        </select>
      </label>
      <div className="flex items-end gap-2 lg:col-span-4">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">{facility ? "Save" : "Add facility"}</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
        {facility && <button formAction={async () => { await deleteFacility(facility.id); onDone(); }} className="rounded-lg px-2 py-2 text-xs text-slate-300 hover:text-rose-600" title="delete">✕</button>}
      </div>
    </form>
  );
}

function Field({ name, label, defaultValue, type = "text", required, placeholder }: { name: string; label: string; defaultValue?: string | null; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
    </label>
  );
}
