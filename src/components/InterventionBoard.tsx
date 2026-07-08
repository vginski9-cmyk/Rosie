"use client";

import { useMemo, useState } from "react";
import { createIntervention, updateIntervention, setInterventionStatus, deleteIntervention } from "@/lib/actions";

export interface InterventionRow {
  id: string; lane: string; stage: string; title: string; description: string | null;
  populations: string | null; owner: string | null; status: string; sequence: number;
  estCostLow: number | null; estCostHigh: number | null; targetStageKey: string | null;
}

export const LANES = [
  { key: "MIDDLE_SCHOOL", label: "Middle Schools" },
  { key: "HIGH_SCHOOL", label: "High Schools" },
  { key: "COMMUNITY_COLLEGE", label: "Community College" },
  { key: "EMPLOYER", label: "Employers" },
  { key: "CROSS_CUTTING", label: "Cross-cutting" },
];
export const STAGES = [
  { key: "AWARENESS", label: "Career Awareness & Exploration", funnel: "interested" },
  { key: "READINESS", label: "Coursework & Prereq Readiness", funnel: "qualified" },
  { key: "APPLICATION", label: "Application & Enrollment", funnel: "enrolled" },
  { key: "WBL", label: "Work-based Learning", funnel: null },
  { key: "SUPPORTS", label: "Student Supports", funnel: "completing" },
  { key: "RETENTION", label: "Retention & Productivity", funnel: "productive" },
];
const STATUS_ORDER = ["proposed", "planned", "active", "complete", "paused"];
const STATUS_BADGE: Record<string, string> = {
  proposed: "bg-slate-100 text-slate-500", planned: "bg-sky-100 text-sky-700",
  active: "bg-emerald-100 text-emerald-700", complete: "bg-emerald-600 text-white", paused: "bg-amber-100 text-amber-700",
};
const POP_BADGE = "rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700";
const cost = (lo: number | null, hi: number | null) => (lo == null && hi == null ? null : `~$${lo != null ? Math.round(lo / 1000) : "?"}–${hi != null ? Math.round(hi / 1000) : "?"}K`);

export function InterventionBoard({ familyId, interventions, funnel, funnelTarget = {} }: {
  familyId: string;
  interventions: InterventionRow[];
  funnel: Record<string, number>;
  funnelTarget?: Record<string, number>;
}) {
  const [fLane, setFLane] = useState("");
  const [fPop, setFPop] = useState("");
  const [editing, setEditing] = useState<InterventionRow | "new" | null>(null);
  const [newCell, setNewCell] = useState<{ lane: string; stage: string } | null>(null);

  const populations = useMemo(() => {
    const s = new Set<string>();
    for (const i of interventions) (i.populations ?? "").split(",").map((x) => x.trim()).filter(Boolean).forEach((p) => s.add(p));
    return [...s].sort();
  }, [interventions]);

  const visible = interventions.filter((i) => (!fLane || i.lane === fLane) && (!fPop || (i.populations ?? "").includes(fPop)));
  const byCell = useMemo(() => {
    const m = new Map<string, InterventionRow[]>();
    for (const i of visible) {
      const k = `${i.lane}|${i.stage}`;
      const arr = m.get(k) ?? [];
      arr.push(i);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sequence - b.sequence);
    return m;
  }, [visible]);

  const laneTotals = (lane: string) => {
    const rows = interventions.filter((i) => i.lane === lane);
    const lo = rows.reduce((n, i) => n + (i.estCostLow ?? 0), 0);
    const hi = rows.reduce((n, i) => n + (i.estCostHigh ?? 0), 0);
    return { count: rows.length, band: lo || hi ? `~$${Math.round(lo / 1000)}–${Math.round(hi / 1000)}K` : "—" };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lane</span>
          <select value={fLane} onChange={(e) => setFLane(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {LANES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Priority population</span>
          <select value={fPop} onChange={(e) => setFPop(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {populations.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {(fLane || fPop) && <button onClick={() => { setFLane(""); setFPop(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <div className="ml-auto text-xs text-slate-500">{visible.length} interventions</div>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-[1080px] w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="w-36 px-3 py-2 text-left font-semibold">Partner lane</th>
              {STAGES.map((s) => (
                <th key={s.key} className="px-2 py-2 text-left font-semibold">
                  {s.label}
                  {s.funnel != null && funnel[s.funnel] != null && (() => {
                    const now = funnel[s.funnel!]; const tgt = funnelTarget[s.funnel === "completing" ? "completing" : s.funnel!] ?? null;
                    const short = tgt != null && now < tgt;
                    return <span className={`ml-1 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium normal-case ring-1 ${short ? "text-rose-600 ring-rose-200" : "text-emerald-600 ring-emerald-100"}`}>{now} now{tgt != null ? ` / ${tgt} target` : ""}</span>;
                  })()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {LANES.filter((l) => !fLane || l.key === fLane).map((lane) => {
              const t = laneTotals(lane.key);
              return (
                <tr key={lane.key} className="align-top">
                  <td className="px-3 py-2">
                    <div className="text-[13px] font-semibold text-slate-800">{lane.label}</div>
                    <div className="text-[10px] text-slate-400">{t.count} · {t.band}/yr</div>
                  </td>
                  {STAGES.map((stage) => {
                    const items = byCell.get(`${lane.key}|${stage.key}`) ?? [];
                    return (
                      <td key={stage.key} className="px-1.5 py-2">
                        <div className="space-y-1">
                          {items.map((i) => (
                            <button key={i.id} onClick={() => setEditing(i)} className="block w-full rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-left hover:border-rose-200">
                              <span className="block text-[11px] font-medium leading-tight text-slate-800">{i.sequence > 0 ? `${i.sequence}. ` : ""}{i.title}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_BADGE[i.status]}`}>{i.status}</span>
                                {(i.populations ?? "").split(",").map((p) => p.trim()).filter(Boolean).slice(0, 2).map((p) => <span key={p} className={POP_BADGE}>{p}</span>)}
                                {i.owner && <span className="text-[9px] text-slate-400">{i.owner}</span>}
                                {cost(i.estCostLow, i.estCostHigh) && <span className="text-[9px] text-slate-400">{cost(i.estCostLow, i.estCostHigh)}</span>}
                              </span>
                            </button>
                          ))}
                          <button onClick={() => { setNewCell({ lane: lane.key, stage: stage.key }); setEditing("new"); }} className="block w-full rounded-lg border border-dashed border-slate-200 px-2 py-1 text-left text-[10px] text-slate-300 hover:border-rose-200 hover:text-rose-500">+ add</button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditModal
          familyId={familyId}
          item={editing === "new" ? null : editing}
          defaults={newCell}
          onClose={() => { setEditing(null); setNewCell(null); }}
        />
      )}
    </div>
  );
}

function EditModal({ familyId, item, defaults, onClose }: { familyId: string; item: InterventionRow | null; defaults: { lane: string; stage: string } | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800">{item ? "Edit intervention" : "New intervention"}</h3>
        <form action={async (fd) => { if (item) await updateIntervention(item.id, familyId, fd); else await createIntervention(familyId, fd); onClose(); }} className="mt-3 grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Title</span>
            <input name="title" required defaultValue={item?.title} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lane</span>
            <select name="lane" defaultValue={item?.lane ?? defaults?.lane ?? "COMMUNITY_COLLEGE"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {LANES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Stage</span>
            <select name="stage" defaultValue={item?.stage ?? defaults?.stage ?? "AWARENESS"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Description</span>
            <textarea name="description" rows={2} defaultValue={item?.description ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Priority populations</span>
            <input name="populations" defaultValue={item?.populations ?? ""} placeholder="K-12, Adult learners, …" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Owner</span>
            <input name="owner" defaultValue={item?.owner ?? ""} placeholder="named owner" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
            <select name="status" defaultValue={item?.status ?? "proposed"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sequence (order in lane)</span>
            <input name="sequence" type="number" min={0} defaultValue={item?.sequence ?? 0} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Est. cost low ($/yr)</span>
            <input name="estCostLow" type="number" min={0} defaultValue={item?.estCostLow ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Est. cost high ($/yr)</span>
            <input name="estCostHigh" type="number" min={0} defaultValue={item?.estCostHigh ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Target funnel stage</span>
            <select name="targetStageKey" defaultValue={item?.targetStageKey ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">—</option>
              {["interested", "qualified", "offered", "enrolled", "completing", "licensed", "placed", "productive"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <div className="col-span-2 flex items-center gap-2">
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">{item ? "Save" : "Add"}</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
            {item && (
              <>
                <button formAction={async () => { const next = STATUS_ORDER[(STATUS_ORDER.indexOf(item.status) + 1) % STATUS_ORDER.length]; await setInterventionStatus(item.id, familyId, next); onClose(); }} className="ml-auto rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-500 hover:bg-slate-50">advance status →</button>
                <button formAction={async () => { await deleteIntervention(item.id, familyId); onClose(); }} className="rounded-lg px-2 py-2 text-xs text-slate-300 hover:text-rose-600">✕ delete</button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
