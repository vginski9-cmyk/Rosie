"use client";

// SUPERVISION EDITOR — the explicit role model behind a clinical session's mode: which roles must be present
// (college instructor, site preceptor, both), how many per group or how many learners per person, whether a
// named assignment is needed before a shift is ready, and what is still unknown. Controls are conditional on the
// mode; an inapplicable role shows nothing to fill in. The legacy count columns stay on the workbook grid and
// still drive contact hours and FTE — this rule drives readiness and staffing demand.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { staffDemand, requiredRoles, peopleForGroup, type SupervisionSpec, type SupervisionMode, type SupervisionRole } from "@/lib/supervision";
import { saveSupervisionRule, type ActionResult } from "@/lib/requirementactions";
import { dec } from "@/lib/format";

export interface SupervisionView { spec: SupervisionSpec; source: string; conflicts: string[]; revision: number; scope: "session" | "course" | "program" | "family" }

const MODE_LABEL: Record<SupervisionMode, string> = { "instructor-led": "Instructor-led group (college instructor with the group)", "preceptor-led": "Preceptor-led (a site preceptor per learner or small group)", combined: "Both — instructor and site preceptors", unknown: "Not yet decided" };
const ROLE_NAME: Record<SupervisionRole, string> = { instructor: "College instructor", preceptor: "Site preceptor" };

/** Plain words for the roles a session needs: "1 college instructor per group of 10 · no site preceptor required". */
export function supervisionSummary(spec: SupervisionSpec, learners: number): string {
  const parts = spec.roles.map((r) => {
    if (!r.required) return `no ${ROLE_NAME[r.role].toLowerCase()} required`;
    const n = peopleForGroup(r, learners);
    return n == null ? `${ROLE_NAME[r.role].toLowerCase()} required — count or ratio to confirm` : r.staffPerGroup != null ? `${dec(r.staffPerGroup)} ${ROLE_NAME[r.role].toLowerCase()}${r.staffPerGroup === 1 ? "" : "s"} per group` : `1 ${ROLE_NAME[r.role].toLowerCase()} per ${r.maxLearnersPerStaff} learner${r.maxLearnersPerStaff === 1 ? "" : "s"} (${n} for ${learners})`;
  });
  return `${MODE_LABEL[spec.mode].split(" (")[0]} · ${parts.join(" · ")}`;
}

const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";
export function SupervisionEditor({ target, view, learners, hours, groups = 1 }: { target: { scope: "session" | "course" | "program" | "family"; sessionId?: string; courseId?: string; programId?: string; familyId?: string }; view: SupervisionView; learners: number; hours: number; groups?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SupervisionMode>(view.spec.mode);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const demand = staffDemand(view.spec, groups, learners, hours);
  const roleOf = (r: SupervisionRole) => view.spec.roles.find((x) => x.role === r);
  const shows = (r: SupervisionRole) => mode === "combined" || (mode === "instructor-led" && r === "instructor") || (mode === "preceptor-led" && r === "preceptor") || mode === "unknown";
  const submit = (decision: "save" | "review") => (fd: FormData) => { fd.set("decision", decision); fd.set("expectedRevision", String(view.revision)); start(async () => { const r = await saveSupervisionRule(target, fd); setResult(r); if (r.ok) { setOpen(false); router.refresh(); } }); };
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-slate-500">Supervision</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${view.spec.status === "reviewed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{view.spec.status === "reviewed" ? "reviewed" : "needs review"}</span>
        <span className="text-slate-700">{supervisionSummary(view.spec, learners)}</span>
        <span className="text-slate-400">from {view.source}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-white" aria-expanded={open}>{open ? "close" : "edit"}</button>
      </div>
      <div className="mt-1 text-[11px] text-slate-600">
        For {groups} group{groups === 1 ? "" : "s"} of {learners} over {dec(hours)} h: <strong>{dec(demand.learnerHours)}</strong> learner-hours · <strong>{dec(demand.groupHours)}</strong> group hours
        {(["instructor", "preceptor"] as SupervisionRole[]).map((r) => <span key={r}> · {ROLE_NAME[r].toLowerCase()}s: {demand.concurrent[r] == null ? <span className="text-amber-700">policy missing</span> : <>{demand.concurrent[r]} at once, {dec(demand.contactHours[r] ?? 0)} contact h</>}</span>)}
      </div>
      {view.conflicts.length > 0 && <p className="mt-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">Conflict: {view.conflicts.join("; ")} — a planning rule cannot relax a mandatory one; the mandatory rule stands.</p>}
      {view.spec.questions.length > 0 && <ul className="mt-1 list-disc pl-5 text-[11px] text-amber-800">{view.spec.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
      {open && (
        <form action={submit("save")} className="mt-2 space-y-2 border-t border-slate-200 pt-2">
          <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Model</span><select name="mode" value={mode} onChange={(e) => setMode(e.target.value as SupervisionMode)} className={inp}>{(Object.keys(MODE_LABEL) as SupervisionMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
          <div className="grid gap-3 md:grid-cols-2">
            {(["instructor", "preceptor"] as SupervisionRole[]).filter(shows).map((r) => { const cur = roleOf(r); return (
              <fieldset key={r} className="rounded border border-slate-200 bg-white p-2">
                <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{ROLE_NAME[r]}</legend>
                {mode === "unknown" && <label className="flex items-center gap-1"><input type="checkbox" name={`${r}_required`} defaultChecked={cur?.required} />required</label>}
                <div className="mt-1 flex flex-wrap gap-2">
                  <label className="block"><span className="block text-[10px] text-slate-500">people per group</span><input name={`${r}_staffPerGroup`} type="number" min="0" step="any" defaultValue={cur?.staffPerGroup ?? ""} className={`${inp} w-24 text-right`} placeholder="—" /></label>
                  <label className="block"><span className="block text-[10px] text-slate-500">or learners per person</span><input name={`${r}_maxLearnersPerStaff`} type="number" min="1" step="1" defaultValue={cur?.maxLearnersPerStaff ?? ""} className={`${inp} w-24 text-right`} placeholder="—" /></label>
                  <label className="block"><span className="block text-[10px] text-slate-500">presence</span><select name={`${r}_presence`} defaultValue={cur?.presence ?? "unknown"} className={inp}><option value="continuous">the whole time</option><option value="intermittent">part of the time</option><option value="unknown">not stated</option></select></label>
                </div>
                <label className="mt-1 flex items-center gap-1"><input type="checkbox" name={`${r}_namedNotRequired`} defaultChecked={cur ? !cur.namedAssignmentRequired : false} />a named person is NOT needed before the shift counts as ready</label>
                <label className="mt-1 block"><span className="block text-[10px] text-slate-500">qualifications / authorization</span><input name={`${r}_qualifications`} defaultValue={cur?.qualifications ?? ""} className={`${inp} w-full`} placeholder="e.g. RN with 2 years' experience, program orientation" /></label>
                <div className="mt-1 flex gap-2"><label className="block"><span className="block text-[10px] text-slate-500">valid from</span><input name={`${r}_validFrom`} type="date" defaultValue={cur?.validFrom ?? ""} className={inp} /></label><label className="block"><span className="block text-[10px] text-slate-500">valid to</span><input name={`${r}_validTo`} type="date" defaultValue={cur?.validTo ?? ""} className={inp} /></label></div>
              </fieldset>
            ); })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="block text-[10px] text-slate-500">source (the document or policy this comes from)</span><input name="sourceText" defaultValue={view.spec.sourceText ?? ""} className={`${inp} w-72`} /></label>
            <label className="block"><span className="block text-[10px] text-slate-500">authority</span><select name="authority" defaultValue="planning" className={inp}><option value="planning">planning assumption</option><option value="mandatory">mandatory (regulatory / program approval)</option></select></label>
            <input name="reviewedBy" placeholder="reviewer's name (to mark reviewed)" className={`${inp} w-56`} aria-label="Reviewer's name" />
            <button disabled={pending} className="rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">Save — needs review</button>
            <button disabled={pending} formAction={submit("review")} className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white hover:bg-emerald-800">Save and mark reviewed</button>
          </div>
          {result && !result.ok && <ul className="list-disc rounded border border-rose-200 bg-rose-50 px-4 py-1 text-rose-800">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </form>
      )}
    </div>
  );
}
