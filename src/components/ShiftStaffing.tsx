"use client";

// Who covers one session, shift by shift (section by section), for THIS
// offering. Each row is one person's share: role, contact hours, where in the
// session it starts. A 3-hour class can be 1 h + 0.75 h + 1.25 h by three
// people; two rows at the same offset are co-teaching. Coverage is judged
// against what the session row needs (length × faculty / preceptors / support).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addShiftAssignment, updateShiftAssignment, removeShiftAssignment, copyShiftAssignments } from "@/lib/actions";
import { coverageOf, familyOfRole, type AssignmentLite, type RoleFamily } from "@/lib/workload";

export interface ShiftPerson { id: string; name: string; role: string; employmentType?: string | null; title?: string | null; employerName?: string | null }
export interface ShiftAssignment extends AssignmentLite { sessionId: string; segment: string | null; personName: string; personRole: string }

const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptor", support: "Support", supervisor: "Supervisor", coordinator: "Coordinator" };
const ROLE_BADGE: Record<string, string> = { instructor: "bg-rose-100 text-rose-700", preceptor: "bg-orange-100 text-orange-700", support: "bg-sky-100 text-sky-700", supervisor: "bg-violet-100 text-violet-700", coordinator: "bg-emerald-100 text-emerald-700" };
const h = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ""));
const clock = (startTime: string | null, offsetMin: number | null) => {
  if (startTime == null || offsetMin == null) return null;
  const [hh, mm] = startTime.split(":").map(Number); if (!Number.isFinite(hh)) return null;
  const t = hh * 60 + (mm || 0) + offsetMin; const H = Math.floor(t / 60) % 24; const M = Math.round(t % 60);
  return `${H % 12 || 12}:${String(M).padStart(2, "0")}${H >= 12 ? "p" : "a"}`;
};

export function ShiftStaffing({ cohortId, programId, sessionId, sectionCount, need, startTime, assignments, people, roles = [] }: {
  cohortId: string; programId: string; sessionId: string; sectionCount: number;
  need: { lengthHours: number; facultyNeeded: number; preceptorsNeeded: number; supportStaffNeeded: number; kind: string };
  startTime: string | null;
  assignments: ShiftAssignment[];
  people: ShiftPerson[];
  /** Custom roles (key → what they cover). */
  roles?: { key: string; label: string; family: RoleFamily }[];
}) {
  const roleFamilies = Object.fromEntries(roles.map((r) => [r.key, r.family])) as Record<string, RoleFamily>;
  const roleLabelOf = (k: string) => ROLE_LABEL[k] ?? roles.find((r) => r.key === k)?.label ?? k;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | "all" | null>(null);
  const sections = Array.from({ length: Math.max(1, sectionCount) }, (_, i) => i + 1);
  const run = (fn: () => Promise<void>) => startTransition(async () => { await fn(); router.refresh(); });
  const defaultRole = need.kind === "CLINICAL" && need.preceptorsNeeded > 0 ? "preceptor" : "instructor";
  const total = assignments.reduce((n, a) => n + a.contactHours, 0);

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Who covers this session — shift by shift <span className="font-normal normal-case text-slate-500">· needs {h(need.lengthHours * need.facultyNeeded)} faculty h{need.preceptorsNeeded > 0 ? ` · ${h(need.lengthHours * need.preceptorsNeeded)} preceptor h` : ""}{need.supportStaffNeeded > 0 ? ` · ${h(need.lengthHours * need.supportStaffNeeded)} support h` : ""} per shift · {sections.length} shift{sections.length === 1 ? "" : "s"}</span></div>
        <span className="text-[11px] text-slate-500">{h(total)} contact h assigned across all shifts</span>
      </div>
      <div className="mt-2 space-y-2">
        {sections.map((sec) => {
          const rows = assignments.filter((a) => a.sectionIndex === sec).sort((a, b) => (a.startOffsetMin ?? 1e9) - (b.startOffsetMin ?? 1e9) || a.personName.localeCompare(b.personName));
          const cov = coverageOf(need, rows, roleFamilies);
          const tone = cov.status === "staffed" ? "text-emerald-700" : cov.status === "over" ? "text-violet-700" : cov.status === "partial" ? "text-amber-700" : "text-slate-400";
          const co = new Set(cov.coTeaching.flat());
          const remaining = Math.max(0, cov.faculty.required - cov.faculty.assigned);
          return (
            <div key={sec} className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span className="font-semibold text-slate-700">{sections.length > 1 ? `Shift ${sec} of ${sections.length}` : "The shift"}</span>
                <span className={`font-medium ${tone}`}>
                  {cov.status === "unstaffed" ? "unstaffed" : cov.status === "staffed" ? "fully staffed" : cov.status === "over" ? "over-assigned" : "partly staffed"}
                  {" · "}faculty {h(cov.faculty.assigned)}/{h(cov.faculty.required)} h{need.preceptorsNeeded > 0 ? ` · preceptor ${h(cov.preceptor.assigned)}/${h(cov.preceptor.required)} h` : ""}{need.supportStaffNeeded > 0 ? ` · support ${h(cov.support.assigned)}/${h(cov.support.required)} h` : ""}
                </span>
                {cov.coTeaching.length > 0 && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-800" title="two people's portions overlap in time">co-teaching {cov.coTeaching.length}×</span>}
                {cov.overruns.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800" title="a portion runs past the end of the session">runs past the end</span>}
                <span className="ml-auto flex gap-2">
                  {sections.length > 1 && rows.length > 0 && <button disabled={pending} onClick={() => run(() => copyShiftAssignments(cohortId, sessionId, sec, sections.length, programId))} className="text-[10px] text-slate-500 hover:text-rose-700" title="put this shift's people on every other shift of this session">copy to all shifts</button>}
                  <button onClick={() => setAdding(adding === sec ? null : sec)} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-slate-900">+ person</button>
                </span>
              </div>
              {/* coverage bar: each row's share, scaled to the session length × people needed */}
              {rows.length > 0 && (
                <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  {rows.map((r) => <span key={r.id} className={`h-full ${co.has(r.id) ? "bg-violet-400" : r.role === "preceptor" ? "bg-orange-400" : r.role === "support" ? "bg-sky-400" : "bg-rose-400"} border-r border-white`} style={{ width: `${Math.min(100, (r.contactHours / Math.max(0.01, need.lengthHours * Math.max(1, need.facultyNeeded + need.preceptorsNeeded + need.supportStaffNeeded))) * 100)}%` }} title={`${r.personName} ${h(r.contactHours)} h`} />)}
                </div>
              )}
              <div className="mt-1.5 space-y-1">
                {rows.map((r) => editing === r.id ? (
                  <AssignmentForm key={r.id} people={people} roles={roles} lengthHours={need.lengthHours} defaultRole={r.role} row={r} onSubmit={(fd) => run(async () => { await updateShiftAssignment(r.id, cohortId, programId, fd); setEditing(null); })} onCancel={() => setEditing(null)} />
                ) : (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ROLE_BADGE[r.role] ?? "bg-slate-100 text-slate-600"}`}>{roleLabelOf(r.role)}</span>
                    <span className="font-medium text-slate-800">{r.personName}</span>
                    <span className="tabular-nums text-slate-700">{h(r.contactHours)} h</span>
                    {r.startOffsetMin != null && <span className="tabular-nums text-slate-500">from {clock(startTime, r.startOffsetMin) ?? `+${h(r.startOffsetMin)} min`} to {clock(startTime, r.startOffsetMin + r.contactHours * 60) ?? `+${h(r.startOffsetMin + r.contactHours * 60)} min`}</span>}
                    {r.segment && <span className="text-slate-500">— {r.segment}</span>}
                    {co.has(r.id) && <span className="text-[9px] font-semibold text-violet-700">co-teaching</span>}
                    <button onClick={() => setEditing(r.id)} className="text-[10px] text-rose-600 hover:underline">edit</button>
                    <button disabled={pending} onClick={() => run(() => removeShiftAssignment(r.id, cohortId, programId))} className="text-slate-300 hover:text-rose-600" title="remove">✕</button>
                  </div>
                ))}
                {rows.length === 0 && adding !== sec && <div className="text-[11px] text-slate-400">nobody assigned yet</div>}
              </div>
              {adding === sec && (
                <AssignmentForm people={people} roles={roles} lengthHours={need.lengthHours} defaultRole={defaultRole} defaultHours={remaining > 0 ? remaining : need.lengthHours} sectionIndex={sec} sectionCount={sections.length} onSubmit={(fd) => run(async () => { await addShiftAssignment(cohortId, programId, fd); setAdding(null); })} onCancel={() => setAdding(null)} sessionId={sessionId} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssignmentForm({ people, roles = [], lengthHours, defaultRole, defaultHours, row, sectionIndex, sectionCount, sessionId, onSubmit, onCancel }: {
  people: ShiftPerson[]; roles?: { key: string; label: string; family: RoleFamily }[]; lengthHours: number; defaultRole: string; defaultHours?: number; row?: ShiftAssignment; sectionIndex?: number; sectionCount?: number; sessionId?: string;
  onSubmit: (fd: FormData) => void; onCancel: () => void;
}) {
  const [role, setRole] = useState(row?.role ?? defaultRole);
  const [allShifts, setAllShifts] = useState(false);
  const fams = Object.fromEntries(roles.map((r) => [r.key, r.family])) as Record<string, RoleFamily>;
  const fam = familyOfRole(role, fams);
  const candidates = people.filter((p) => familyOfRole(p.role, fams) === fam || (fam === "other" && p.role === role));
  const inp = "rounded border border-blue-200 bg-blue-50/70 px-1.5 py-0.5 text-[11px] text-blue-900";
  return (
    <form action={onSubmit} className="mt-1 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      {sessionId && <input type="hidden" name="sessionId" value={sessionId} />}
      {sectionIndex != null && <input type="hidden" name="sectionIndex" value={allShifts ? "all" : String(sectionIndex)} />}
      {sectionCount != null && <input type="hidden" name="sectionCount" value={String(sectionCount)} />}
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Role</span>
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={inp}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}{roles.map((r) => <option key={r.key} value={r.key}>{r.label} (covers {r.family})</option>)}</select></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Person</span>
        <select name="personId" required defaultValue={row?.personId ?? ""} className={`${inp} max-w-[16rem]`}>
          <option value="">choose…</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}{p.employmentType ? ` · ${p.employmentType}` : ""}{p.employerName ? ` @ ${p.employerName}` : ""}{p.title ? ` — ${p.title}` : ""}</option>)}
        </select></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Contact hours</span>
        <input name="contactHours" type="number" step="any" min="0" defaultValue={row?.contactHours ?? defaultHours ?? lengthHours} className={`${inp} w-20 text-right`} /></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Starts at (min into session)</span>
        <input name="startOffsetMin" type="number" step="any" min="0" defaultValue={row?.startOffsetMin ?? ""} placeholder="e.g. 60" className={`${inp} w-24 text-right`} /></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Covers</span>
        <input name="segment" defaultValue={row?.segment ?? ""} placeholder="lecture · skills demo · sim…" className={`${inp} w-36`} /></label>
      {sectionCount != null && sectionCount > 1 && (
        <label className="flex items-center gap-1 pb-1 text-[10px] text-slate-600"><input type="checkbox" checked={allShifts} onChange={(e) => setAllShifts(e.target.checked)} className="h-3 w-3" /> every shift of this session</label>
      )}
      <button className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700">{row ? "Save" : "Assign"}</button>
      <button type="button" onClick={onCancel} className="text-[11px] text-slate-500 hover:underline">cancel</button>
    </form>
  );
}
