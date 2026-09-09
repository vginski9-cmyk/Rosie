"use client";

// Workload policies & assumptions — by institution, by employer (partner
// sites), by position (role · employment type · title). The most specific
// policy governs each person; every staffing assignment's contact hours are
// credited and loaded by it.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWorkloadPolicy, deleteWorkloadPolicy, applyPolicyToEmployers } from "@/lib/actions";
import { DEFAULT_POLICIES } from "@/lib/workload";
import { dec } from "@/lib/format";

export interface PolicyRow {
  id: string; institutionId: string; institutionName: string; employerId: string | null; employerName: string | null; assetId?: string | null; assetName?: string | null;
  role: string; employmentType: string | null; title: string | null; label: string | null;
  contactHoursPerWeek: number; workWeekHours: number; termWeeks: number; annualWeeks: number;
  hoursPerContactHour: number | null; maxContactHoursPerWeek: number | null; notes: string | null;
}
interface InstLite { id: string; name: string }
interface EmpLite { id: string; name: string; institutionId: string }
interface AssetLite { id: string; employerId: string; institutionId: string; label: string }
interface RoleLite { id: string; institutionId: string; key: string; label: string; family: string }

const ROLES = ["instructor", "preceptor", "support", "supervisor", "coordinator"];
const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptor", support: "Support staff", supervisor: "Supervisor", coordinator: "Coordinator" };
const EMP_TYPES = ["full-time", "part-time", "adjunct", "contract", "preceptor"];
const fmt = (n: number | null | undefined, _dp = 2) => { void _dp; return dec(n); };
const credit = (p: { hoursPerContactHour: number | null; workWeekHours: number; contactHoursPerWeek: number }) => p.hoursPerContactHour ?? (p.contactHoursPerWeek > 0 ? p.workWeekHours / p.contactHoursPerWeek : 1);

export function WorkloadPolicies({ policies, institutions, employers, assets = [], roles = [], defaultInstitutionId }: { policies: PolicyRow[]; institutions: InstLite[]; employers: EmpLite[]; assets?: AssetLite[]; roles?: RoleLite[]; defaultInstitutionId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null); // policy id or "new"
  const [fInst, setFInst] = useState(defaultInstitutionId ?? "");

  const groups = useMemo(() => {
    const m = new Map<string, { inst: string; employer: string | null; key: string; rows: PolicyRow[] }>();
    for (const p of policies) {
      if (fInst && p.institutionId !== fInst) continue;
      const key = `${p.institutionId}|${p.employerId ?? ""}|${p.assetId ?? ""}`;
      const g = m.get(key) ?? { inst: p.institutionName, employer: p.assetId ? `${p.employerName} · ${p.assetName}` : p.employerName, key, rows: [] };
      g.rows.push(p); m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.inst.localeCompare(b.inst) || (a.employer ?? "").localeCompare(b.employer ?? ""));
  }, [policies, fInst]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={fInst} onChange={(e) => setFInst(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          <option value="">Every institution</option>
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <span className="text-xs text-slate-500">{policies.filter((p) => !fInst || p.institutionId === fInst).length} policies · the most specific match (employer → title → employment type → role) governs each person; anything uncoded falls back to the built-in defaults below.</span>
        <button onClick={() => setEditing(editing === "new" ? null : "new")} className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">{editing === "new" ? "Close" : "+ Add policy"}</button>
      </div>

      {editing === "new" && <PolicyForm institutions={institutions} employers={employers} assets={assets} roles={roles} defaultInstitutionId={fInst || defaultInstitutionId} onDone={() => { setEditing(null); router.refresh(); }} />}

      {groups.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400">No coded policies{fInst ? " for this institution" : ""} — the built-in defaults apply. Add one per position to set the real numbers.</p>}
      {groups.map((g) => (
        <div key={g.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-baseline gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
            <span className="font-semibold text-slate-800">{g.inst}</span>
            {g.employer ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">at {g.employer}</span> : <span className="text-slate-400">institution&apos;s own staff</span>}
          </div>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-1.5 text-left">Position</th><th className="px-2 py-1.5 text-right">Full load<br /><span className="font-normal normal-case">contact h / wk</span></th><th className="px-2 py-1.5 text-right">Work week<br /><span className="font-normal normal-case">hours</span></th><th className="px-2 py-1.5 text-right">Credit<br /><span className="font-normal normal-case">work h per contact h</span></th><th className="px-2 py-1.5 text-right">Term<br /><span className="font-normal normal-case">weeks</span></th><th className="px-2 py-1.5 text-right">Year<br /><span className="font-normal normal-case">weeks</span></th><th className="px-2 py-1.5 text-right">1.0 FTE<br /><span className="font-normal normal-case">contact h / term · yr</span></th><th className="px-2 py-1.5 text-right">Overload<br /><span className="font-normal normal-case">above h / wk</span></th><th className="px-2 py-1.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {g.rows.map((p) => editing === p.id ? (
                <tr key={p.id}><td colSpan={9} className="px-3 py-2"><PolicyForm institutions={institutions} employers={employers} assets={assets} roles={roles} policy={p} onDone={() => { setEditing(null); router.refresh(); }} /></td></tr>
              ) : (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-slate-800">{p.label ?? ROLE_LABEL[p.role] ?? p.role}</div>
                    <div className="text-[10px] text-slate-400">{[ROLE_LABEL[p.role] ?? p.role, p.employmentType, p.title].filter(Boolean).join(" · ")}{p.notes ? ` — ${p.notes}` : ""}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">{fmt(p.contactHoursPerWeek)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.workWeekHours)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(credit(p), 3)}{p.hoursPerContactHour == null && <span className="ml-1 text-[9px] text-slate-400">(wk ÷ load)</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.termWeeks)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.annualWeeks)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{fmt(p.contactHoursPerWeek * p.termWeeks)} · {fmt(p.contactHoursPerWeek * p.annualWeeks)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.maxContactHoursPerWeek ?? p.contactHoursPerWeek)}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(p.id)} className="text-rose-600 hover:underline">edit</button>
                    {!p.assetId && <button onClick={() => { if (confirm("Copy this policy onto every active partner site of the institution (replacing any site policy for the same position)?")) startTransition(async () => { const r = await applyPolicyToEmployers(p.id, "all"); alert(`Applied to ${r.applied} sites.`); router.refresh(); }); }} disabled={pending} className="ml-2 text-emerald-700 hover:underline" title="make every site carry the same numbers for this position">apply to every site</button>}
                    <button onClick={() => { if (confirm("Delete this policy? People it governed fall back to the next most specific one.")) startTransition(async () => { await deleteWorkloadPolicy(p.id); router.refresh(); }); }} disabled={pending} className="ml-2 text-slate-300 hover:text-rose-600" title="delete">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Built-in defaults (used only where nothing is coded)</summary>
        <table className="mt-2 w-full text-xs">
          <tbody className="divide-y divide-slate-100">
            {DEFAULT_POLICIES.map((d, i) => (
              <tr key={i}><td className="px-2 py-1 font-medium text-slate-700">{d.label}</td><td className="px-2 py-1 text-slate-500">{[ROLE_LABEL[d.role] ?? d.role, d.employmentType].filter(Boolean).join(" · ")}</td><td className="px-2 py-1 text-right tabular-nums">{fmt(d.contactHoursPerWeek)} contact h / wk of {fmt(d.workWeekHours)} · {fmt(credit(d), 3)} work h per contact h · {fmt(d.termWeeks)}-wk term · {fmt(d.annualWeeks)}-wk year</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function PolicyForm({ institutions, employers, assets = [], roles = [], policy, defaultInstitutionId, onDone }: { institutions: InstLite[]; employers: EmpLite[]; assets?: AssetLite[]; roles?: RoleLite[]; policy?: PolicyRow; defaultInstitutionId?: string; onDone: () => void }) {
  const [instId, setInstId] = useState(policy?.institutionId ?? defaultInstitutionId ?? institutions[0]?.id ?? "");
  const [empId, setEmpId] = useState(policy?.employerId ?? "");
  const instEmployers = employers.filter((e) => e.institutionId === instId);
  const empAssets = assets.filter((a) => a.employerId === empId);
  const inp = "w-full rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums";
  const lbl = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  return (
    <form action={async (fd) => { await saveWorkloadPolicy(fd); onDone(); }} className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3 sm:grid-cols-3 lg:grid-cols-6">
      {policy && <input type="hidden" name="id" value={policy.id} />}
      <label className="block"><span className={lbl}>Institution</span>
        <select name="institutionId" value={instId} onChange={(e) => setInstId(e.target.value)} className={inp}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="block"><span className={lbl}>Employer (partner site)</span>
        <select name="employerId" value={empId} onChange={(e) => setEmpId(e.target.value)} className={inp}><option value="">— institution&apos;s own staff —</option>{instEmployers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      {empId && empAssets.length > 0 && <label className="block"><span className={lbl}>Unit / asset (optional)</span>
        <select name="assetId" defaultValue={policy?.assetId ?? ""} className={inp}><option value="">— whole site —</option>{empAssets.map((a) => <option key={a.id} value={a.id}>{a.label.replace(/^[^·]+· /, "")}</option>)}</select></label>}
      <label className="block"><span className={lbl}>Role</span>
        <select name="role" defaultValue={policy?.role ?? "instructor"} className={inp}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}{roles.filter((r) => r.institutionId === instId).map((r) => <option key={r.id} value={r.key}>{r.label} (custom)</option>)}</select></label>
      <label className="block"><span className={lbl}>Employment type (optional)</span>
        <select name="employmentType" defaultValue={policy?.employmentType ?? ""} className={inp}><option value="">any</option>{EMP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <label className="block"><span className={lbl}>Job title (optional, exact)</span><input name="title" defaultValue={policy?.title ?? ""} placeholder="e.g. Clinical Coordinator" className={inp} /></label>
      <label className="block"><span className={lbl}>Label</span><input name="label" defaultValue={policy?.label ?? ""} placeholder="e.g. Full-time faculty" className={inp} /></label>
      <label className="block"><span className={lbl}>Full load — contact h / week</span><input name="contactHoursPerWeek" type="number" step="any" required defaultValue={policy?.contactHoursPerWeek ?? 16} className={inp} /></label>
      <label className="block"><span className={lbl}>Work week — hours</span><input name="workWeekHours" type="number" step="any" defaultValue={policy?.workWeekHours ?? 40} className={inp} /></label>
      <label className="block"><span className={lbl}>Work h credited per contact h</span><input name="hoursPerContactHour" type="number" step="any" defaultValue={policy?.hoursPerContactHour ?? ""} placeholder="blank = week ÷ load" className={inp} /></label>
      <label className="block"><span className={lbl}>Weeks in a term</span><input name="termWeeks" type="number" step="any" defaultValue={policy?.termWeeks ?? 16} className={inp} /></label>
      <label className="block"><span className={lbl}>Weeks in a year</span><input name="annualWeeks" type="number" step="any" defaultValue={policy?.annualWeeks ?? 32} className={inp} /></label>
      <label className="block"><span className={lbl}>Overload above — contact h / week</span><input name="maxContactHoursPerWeek" type="number" step="any" defaultValue={policy?.maxContactHoursPerWeek ?? ""} placeholder="blank = full load" className={inp} /></label>
      <label className="block sm:col-span-2 lg:col-span-4"><span className={lbl}>Notes</span><input name="notes" defaultValue={policy?.notes ?? ""} placeholder="where this comes from (contract, handbook, partner agreement)" className={inp} /></label>
      <div className="flex items-end gap-2 lg:col-span-2">
        <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">{policy ? "Save policy" : "Add policy"}</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-white">Cancel</button>
      </div>
    </form>
  );
}
