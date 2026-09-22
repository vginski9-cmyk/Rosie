"use client";

// REQUIREMENTS LEDGER — the program's educational requirements as structured, versioned inputs, beside the
// structure editor: what is required (value, unit, basis), in which settings (the rule), under what supervision,
// from which source and reviewed by whom; which sessions fulfil each one and how much; and the reconciliation:
// required vs represented vs unresolved. A draft may be incomplete; publishing needs a valid structure, a reviewed
// interpretation and a named reviewer, and an approved interpretation is never a claim of regulatory approval.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LedgerRequirement } from "@/lib/requirementstore";
import { saveRequirementDraft, publishRequirementVersion, retireRequirementVersion, linkRequirementFulfillment, unlinkRequirementFulfillment, type ActionResult, type RequirementTarget } from "@/lib/requirementactions";
import { RuleFields, ruleDraftOf, ruleSummary, RuleStatusChip, type RuleDraft } from "@/components/SettingRuleEditor";
import { supervisionSummary } from "@/components/SupervisionEditor";
import { dec } from "@/lib/format";

export interface LedgerSession { id: string; label: string; courseId: string; hours: number }
const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";
const AUTHORITY: Record<string, string> = { unknown: "source authority unknown", unofficial: "unofficial source (a transcription or draft)", official: "official program document" };

export function RequirementsLedger({ programId, familyId, requirements, sessions, settings }: { programId: string; familyId: string | null; requirements: LedgerRequirement[]; sessions: LedgerSession[]; settings: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<RequirementTarget | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(() => ruleDraftOf(null, ""));
  const [useRule, setUseRule] = useState(true);
  const published = requirements.filter((r) => r.version);
  const byUnit = new Map<string, { required: number; represented: number; unresolved: number }>();
  for (const r of published) { const u = r.version!.unit; const t = byUnit.get(u) ?? { required: 0, represented: 0, unresolved: 0 }; t.required += r.version!.quantity ?? 0; t.represented += r.represented; t.unresolved += r.unresolved; byUnit.set(u, t); }
  const unreviewed = published.filter((r) => r.version!.interpretationStatus !== "reviewed" || (r.version!.settingRule && r.version!.settingRule.status !== "reviewed"));
  const run = (fn: () => Promise<ActionResult>, then?: () => void) => start(async () => { const r = await fn(); setResult(r); if (r.ok) { then?.(); router.refresh(); } });
  const openAdd = (t: RequirementTarget) => { setAdding(t); setEditing(null); setDraft(ruleDraftOf(null, "")); setResult(null); };
  const openEdit = (r: LedgerRequirement) => { setEditing(r.id); setAdding(null); setDraft(ruleDraftOf(r.version?.settingRule ?? null, r.version?.sourceText ?? r.label)); setUseRule(!!r.version?.settingRule); setResult(null); };

  const form = (target: RequirementTarget, r: LedgerRequirement | null) => (
    <form action={(fd) => run(() => saveRequirementDraft(target, fd), () => { setAdding(null); setEditing(null); })} className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
      {r?.draft && <input type="hidden" name="versionId" value={r.draft.id} readOnly />}
      {r?.draft && <input type="hidden" name="expectedUpdatedAt" value={r.draft.updatedAt} readOnly />}
      {r && !r.draft && <input type="hidden" name="requirementId" value={r.id} readOnly />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Requirement</span><input name="label" required defaultValue={r?.label ?? ""} className={`${inp} w-full`} placeholder="e.g. Clinical hours — 60 per learner" /></label>
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quantity</span><input name="quantity" type="number" min="0" step="any" defaultValue={r?.version?.quantity ?? ""} className={`${inp} w-full text-right`} placeholder="unknown" /></label>
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unit · basis</span><span className="flex gap-1"><select name="unit" defaultValue={r?.version?.unit ?? "hours"} className={inp}>{["hours", "shifts", "cases", "competencies", "exposures"].map((u) => <option key={u} value={u}>{u}</option>)}</select><select name="basis" defaultValue={r?.version?.basis ?? "per-learner"} className={inp}>{["per-learner", "per-group", "per-session", "per-offering"].map((b) => <option key={b} value={b}>{b}</option>)}</select></span></label>
      </div>
      <label className="flex items-center gap-1"><input type="checkbox" checked={useRule} onChange={(e) => setUseRule(e.target.checked)} />this requirement has a setting rule (where it may be done)</label>
      {useRule && <RuleFields draft={draft} onChange={setDraft} settings={settings} unit={r?.version?.unit ?? "hours"} />}
      {!useRule && <input type="hidden" name="rule" value="" readOnly />}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source authority</span><select name="sourceAuthority" defaultValue={r?.version?.sourceAuthority ?? "unknown"} className={inp}>{Object.entries(AUTHORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notes</span><input name="notes" defaultValue={r?.version?.notes ?? ""} className={`${inp} w-full`} /></label>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">{r?.draft ? "Save draft" : r ? "New draft version" : "Save as draft"}</button>
        <button type="button" onClick={() => { setAdding(null); setEditing(null); }} className="text-slate-500 hover:text-rose-700">cancel</button>
        {pending && <span className="text-slate-500">saving…</span>}
      </div>
      {result && !result.ok && <ul className="list-disc rounded border border-rose-200 bg-rose-50 px-4 py-1 text-rose-800">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </form>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div><h3 className="text-sm font-semibold text-slate-800">Educational requirements <span className="font-normal text-slate-400">— what the clinicals must add up to, and where</span></h3>
          <p className="text-[11px] text-slate-500">Family standards are shared and referenced; a course or session rule specializes them. Publishing records a person&apos;s review of the interpretation — it does not certify regulatory approval.</p></div>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => openAdd({ scope: "program", programId })} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">+ program requirement</button>
          {familyId && <button type="button" onClick={() => openAdd({ scope: "family", familyId })} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">+ family standard</button>}
        </div>
      </div>
      <div className="grid gap-2 px-4 py-3 sm:grid-cols-3">
        {[...byUnit.entries()].map(([unit, t]) => <div key={unit} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{unit} per learner</div><div className="text-slate-800"><strong className="text-lg tabular-nums">{dec(t.required)}</strong> required · <strong className="tabular-nums">{dec(t.represented)}</strong> represented by linked sessions · <strong className={`tabular-nums ${t.unresolved > 0 ? "text-amber-700" : "text-emerald-700"}`}>{dec(t.unresolved)}</strong> unresolved</div></div>)}
        <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Interpretation</div><div className="text-slate-800"><strong className="text-lg tabular-nums">{published.length - unreviewed.length}</strong> of {published.length} published requirements reviewed{unreviewed.length ? <span className="text-amber-700"> · {unreviewed.length} need review</span> : null}</div></div>
      </div>
      {adding && <div className="px-4 pb-3">{form(adding, null)}</div>}
      <ul className="divide-y divide-slate-100">
        {requirements.map((r) => { const v = r.version; return (
          <li key={r.id} className="px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{r.scopeLabel}</span>
              <span className="font-medium text-slate-800">{r.label}</span>
              {v ? <><span className="tabular-nums text-slate-700">{v.quantity != null ? `${dec(v.quantity)} ${v.unit} ${v.basis}` : `${v.unit} (quantity unknown)`}</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800">v{v.version} published{v.publishedAt ? ` ${v.publishedAt.slice(0, 10)}` : ""}</span></> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">no published version</span>}
              {r.draft && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-800">draft v{r.draft.version}</span>}
              {v?.settingRule && <RuleStatusChip status={v.settingRule.status} />}
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={() => openEdit(r)} className="text-slate-600 hover:text-rose-700">{r.draft ? "edit draft" : "new version"}</button>
                {r.draft && <PublishButton versionId={r.draft.id} updatedAt={r.draft.updatedAt} onDone={() => router.refresh()} />}
                {v && <button type="button" onClick={() => { if (confirm(`Retire ${r.label} v${v.version}?`)) run(() => retireRequirementVersion(v.id)); }} className="text-slate-400 hover:text-rose-700">retire</button>}
              </span>
            </div>
            {v && (
              <div className="mt-1 grid gap-x-6 gap-y-0.5 text-[11px] text-slate-600 md:grid-cols-2">
                <div><span className="text-slate-400">where:</span> {v.settingRule ? ruleSummary(v.settingRule) : "no setting rule on this requirement"}</div>
                <div><span className="text-slate-400">supervision:</span> {v.supervision ? supervisionSummary(v.supervision, 10) : "as the sessions say"}</div>
                <div><span className="text-slate-400">source:</span> {v.sourceText ? `“${v.sourceText}” · ` : ""}{AUTHORITY[v.sourceAuthority]}{v.reviewedBy ? ` · reviewed by ${v.reviewedBy}` : ""}</div>
                <div><span className="text-slate-400">fulfilled by:</span> {r.fulfillments.length ? r.fulfillments.map((f) => <span key={f.id} className="mr-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1 py-0.5">{f.label}{f.amount != null ? ` ${dec(f.amount)}` : " (share to state)"}<button type="button" onClick={() => run(() => unlinkRequirementFulfillment(f.id))} className="text-slate-400 hover:text-rose-700" aria-label={`unlink ${f.label}`}>×</button></span>) : <span className="text-amber-700">nothing linked yet</span>}
                  {v.quantity != null && <span className={r.unresolved > 0 ? "text-amber-700" : "text-emerald-700"}> → {dec(r.represented)} of {dec(v.quantity)} {v.unit}{r.represented > v.quantity ? " (over-represented: sessions cite more than the obligation — the obligation is not multiplied)" : r.unresolved > 0 ? ` · ${dec(r.unresolved)} unresolved` : " · complete"}</span>}
                  <LinkForm requirementId={r.id} sessions={sessions} onDone={() => router.refresh()} />
                </div>
              </div>
            )}
            {editing === r.id && form({ scope: r.scope as RequirementTarget["scope"] }, r)}
          </li>
        ); })}
        {requirements.length === 0 && <li className="px-4 py-4 text-xs text-slate-400">No structured requirements yet. Run the backfill (scripts/backfill-requirements.ts) to derive them from the course grid, or add one.</li>}
      </ul>
    </section>
  );
}

function PublishButton({ versionId, updatedAt, onDone }: { versionId: string; updatedAt: string; onDone: () => void }) {
  const [name, setName] = useState(""); const [err, setErr] = useState<string[]>([]); const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(async () => { fd.set("expectedUpdatedAt", updatedAt); const r = await publishRequirementVersion(versionId, fd); setErr(r.errors); if (r.ok) onDone(); })} className="inline-flex items-center gap-1">
      <input name="reviewedBy" value={name} onChange={(e) => setName(e.target.value)} placeholder="reviewer" className={`${inp} w-28`} aria-label="Reviewer's name" />
      <button disabled={pending || !name} className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50">publish</button>
      {err.length > 0 && <span className="text-rose-700">{err.join("; ")}</span>}
    </form>
  );
}
function LinkForm({ requirementId, sessions, onDone }: { requirementId: string; sessions: LedgerSession[]; onDone: () => void }) {
  const [pending, start] = useTransition(); const [err, setErr] = useState<string[]>([]);
  return (
    <form action={(fd) => start(async () => { const r = await linkRequirementFulfillment(requirementId, fd); setErr(r.errors); if (r.ok) onDone(); })} className="mt-1 flex flex-wrap items-center gap-1">
      <select name="sessionId" className={inp} aria-label="Session to link"><option value="">link a session…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
      <input name="amount" type="number" min="0" step="any" placeholder="amount per learner" className={`${inp} w-32 text-right`} />
      <button disabled={pending} className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50">link</button>
      {err.length > 0 && <span className="text-rose-700">{err.join("; ")}</span>}
    </form>
  );
}
