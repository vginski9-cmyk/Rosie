"use client";

// Staff roles: the five built-ins plus any an institution adds. Each role's
// family tells the workload engine what it covers on a shift.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStaffRole, deleteStaffRole } from "@/lib/actions";
import { BUILT_IN_ROLES, ROLE_FAMILIES } from "@/lib/workload";

export interface RoleRow { id: string; institutionId: string; institution: string; key: string; label: string; family: string; notes: string | null }
interface InstLite { id: string; name: string }

export function StaffRoles({ roles, institutions, defaultInstitutionId }: { roles: RoleRow[]; institutions: InstLite[]; defaultInstitutionId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const inp = "rounded-lg border border-slate-300 px-2 py-1 text-xs";
  const Form = ({ r }: { r?: RoleRow }) => (
    <form action={async (fd) => { await saveStaffRole(fd); setEditing(null); router.refresh(); }} className="flex flex-wrap items-end gap-2 rounded-lg border border-rose-200 bg-rose-50/40 p-2">
      {r && <input type="hidden" name="id" value={r.id} />}
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Institution</span><select name="institutionId" defaultValue={r?.institutionId ?? defaultInstitutionId ?? institutions[0]?.id} className={inp}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Role label</span><input name="label" required defaultValue={r?.label} placeholder="e.g. Clinical instructor" className={inp} /></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Key</span><input name="key" defaultValue={r?.key} placeholder="auto from label" className={inp + " w-32"} /></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Covers, on a shift</span><select name="family" defaultValue={r?.family ?? "faculty"} className={inp}>{ROLE_FAMILIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Notes</span><input name="notes" defaultValue={r?.notes ?? ""} className={inp + " w-48"} /></label>
      <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white">{r ? "Save" : "Add role"}</button>
      {r && <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-500">cancel</button>}
    </form>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="text-slate-500">Built in:</span>
        {BUILT_IN_ROLES.map((r) => <span key={r.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" title={`covers ${r.family}`}>{r.label} <span className="text-slate-400">· {r.family}</span></span>)}
      </div>
      {roles.filter((r) => !defaultInstitutionId || r.institutionId === defaultInstitutionId).map((r) => editing === r.id ? <Form key={r.id} r={r} /> : (
        <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
          <span className="font-medium text-slate-800">{r.label}</span><span className="rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">{r.key}</span><span className="text-slate-500">covers {r.family}</span><span className="text-slate-400">· {r.institution}</span>{r.notes && <span className="text-slate-400">— {r.notes}</span>}
          <span className="ml-auto flex gap-2"><button onClick={() => setEditing(r.id)} className="text-rose-600 hover:underline">edit</button><button disabled={pending} onClick={() => { if (confirm("Delete this role? People with it keep the key.")) startTransition(async () => { await deleteStaffRole(r.id); router.refresh(); }); }} className="text-slate-300 hover:text-rose-600">✕</button></span>
        </div>
      ))}
      <Form />
    </div>
  );
}
