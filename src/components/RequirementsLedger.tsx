"use client";

// REQUIREMENTS IN THE TEMPLATE — the template is the source of truth. A course's clinical requirements are fields of
// the course (CourseRequirements, inside the course block of Design & sequence); what represents them is derived from
// the course's own sessions and their setting rules (lib/requirementcoverage), never a hand-kept list of links. A
// session that reaches several requirements is "shared" until a person states its split. Family standards and
// program-wide requirements sit in a short summary above the terms (RequirementsSummary). Publishing records a
// person's review of an interpretation — it never certifies regulatory approval.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LedgerRequirement } from "@/lib/requirementstore";
import { saveRequirementDraft, publishRequirementVersion, retireRequirementVersion, linkRequirementFulfillment, unlinkRequirementFulfillment, type ActionResult, type RequirementTarget } from "@/lib/requirementactions";
import { RuleFields, ruleDraftOf, ruleSummary, RuleStatusChip, type RuleDraft } from "@/components/SettingRuleEditor";
import { supervisionSummary } from "@/components/SupervisionEditor";
import { dec } from "@/lib/format";

/** Kept for callers that still build the old session list; unused by the derived coverage. */
export interface LedgerSession { id: string; label: string; courseId: string; hours: number }
const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";
const AUTHORITY: Record<string, string> = { unknown: "source authority unknown", unofficial: "unofficial source (a transcription or draft)", official: "official program document" };

/** One requirement's status in a phrase: required · represented (from the template) · unresolved · shares to state. */
export function coverageLine(r: LedgerRequirement): { text: string; tone: "ok" | "short" | "unknown" } {
  const v = r.version;
  if (!v) return { text: r.draft ? "draft — not yet published" : "no version", tone: "unknown" };
  if (r.pool) {
    const tight = r.pool.sessionsNeeded != null && r.pool.sessionsNeeded > r.pool.sessions;
    return { text: `${dec(r.pool.allocated)} of ${dec(v.quantity ?? 0)} ${v.unit} from the course's rotation pool — ${dec(r.pool.hours)} h across ${r.pool.sessions} sessions against ${dec(r.pool.minimums)} h of minimums${r.unresolved > 0 ? ` · ${dec(r.unresolved)} unresolved` : " · covered by hours"}${r.pool.sessionsNeeded != null ? ` · whole sessions the minimums need: ${r.pool.sessionsNeeded} of ${r.pool.sessions}${tight ? " — a session is one setting per shift, so every minimum cannot be met at once; adjust the area hours or the session length" : ""}` : ""}; sessions are not tagged by setting`, tone: r.unresolved > 0 || tight ? "short" : "unknown" };
  }
  if (v.quantity == null) return { text: `${v.unit}: quantity not stated${r.contributors.length ? ` · ${r.contributors.length} session${r.contributors.length === 1 ? "" : "s"} in the template reach it` : ""}`, tone: "unknown" };
  const n = r.contributors.filter((c) => c.amount != null).length;
  const parts = [`${dec(r.represented)} of ${dec(v.quantity)} ${v.unit} from ${n} session${n === 1 ? "" : "s"}`];
  if (r.unstated) parts.push(`${r.unstated} shared session${r.unstated === 1 ? "" : "s"} — share to state`);
  if (r.represented > v.quantity) parts.push("more than the obligation — it is not multiplied");
  else if (r.unresolved > 0) parts.push(`${dec(r.unresolved)} unresolved`);
  else parts.push("complete");
  return { text: parts.join(" · "), tone: r.unresolved > 0 || r.unstated ? (r.unstated && r.unresolved === 0 ? "unknown" : "short") : "ok" };
}
const TONE = { ok: "text-emerald-700", short: "text-amber-700", unknown: "text-slate-500" } as const;

function useLedger() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>, then?: () => void) => start(async () => { const r = await fn(); setResult(r); if (r.ok) { then?.(); router.refresh(); } });
  return { router, pending, result, setResult, run };
}

/** The draft form: label, quantity, unit and basis, an optional setting rule, source authority, notes. */
function RequirementForm({ target, r, settings, pending, result, onSubmit, onCancel }: { target: RequirementTarget; r: LedgerRequirement | null; settings: string[]; pending: boolean; result: ActionResult | null; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<RuleDraft>(() => ruleDraftOf(r?.version?.settingRule ?? null, r?.version?.sourceText ?? r?.label ?? ""));
  const [useRule, setUseRule] = useState(!!(r?.version?.settingRule ?? true));
  return (
    <form action={onSubmit} className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
      {r?.draft && <input type="hidden" name="versionId" value={r.draft.id} readOnly />}
      {r?.draft && <input type="hidden" name="expectedUpdatedAt" value={r.draft.updatedAt} readOnly />}
      {r && !r.draft && <input type="hidden" name="requirementId" value={r.id} readOnly />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Requirement</span><input name="label" required defaultValue={r?.label ?? ""} className={`${inp} w-full`} placeholder="e.g. Operating room — scrub / first assist" /></label>
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quantity per learner</span><input name="quantity" type="number" min="0" step="any" defaultValue={r?.version?.quantity ?? ""} className={`${inp} w-full text-right`} placeholder="not stated" /></label>
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unit · basis</span><span className="flex gap-1"><select name="unit" defaultValue={r?.version?.unit ?? "hours"} className={inp}>{["hours", "shifts", "cases", "competencies", "exposures"].map((u) => <option key={u} value={u}>{u}</option>)}</select><select name="basis" defaultValue={r?.version?.basis ?? "per-learner"} className={inp}>{["per-learner", "per-group", "per-session", "per-offering"].map((b) => <option key={b} value={b}>{b}</option>)}</select></span></label>
      </div>
      <label className="flex items-center gap-1"><input type="checkbox" checked={useRule} onChange={(e) => setUseRule(e.target.checked)} />where it may be done (a setting rule — only A, A or B, A and B, minimums inside a total, any N of)</label>
      {useRule && <RuleFields draft={draft} onChange={setDraft} settings={settings} unit={r?.version?.unit ?? "hours"} />}
      {!useRule && <input type="hidden" name="rule" value="" readOnly />}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source authority</span><select name="sourceAuthority" defaultValue={r?.version?.sourceAuthority ?? "unknown"} className={inp}>{Object.entries(AUTHORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notes</span><input name="notes" defaultValue={r?.version?.notes ?? ""} className={`${inp} w-full`} /></label>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">{r?.draft ? "Save draft" : r ? "New draft version" : "Save as draft"}</button>
        <button type="button" onClick={onCancel} className="text-slate-500 hover:text-rose-700">cancel</button>
        {pending && <span className="text-slate-500">saving…</span>}
        <span className="text-slate-400">— a draft becomes the planning version when a named reviewer publishes it</span>
      </div>
      {result && !result.ok && <ul className="list-disc rounded border border-rose-200 bg-rose-50 px-4 py-1 text-rose-800">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <input type="hidden" name="scope" value={target.scope} readOnly />
    </form>
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

/** A session that reaches several requirements: the person states how much of it counts here. */
function ShareForm({ requirementId, sessionId, hours, onDone }: { requirementId: string; sessionId: string; hours: number; onDone: () => void }) {
  const [pending, start] = useTransition(); const [err, setErr] = useState<string[]>([]);
  return (
    <form action={(fd) => start(async () => { fd.set("sessionId", sessionId); const r = await linkRequirementFulfillment(requirementId, fd); setErr(r.errors); if (r.ok) onDone(); })} className="inline-flex items-center gap-1">
      <input name="amount" type="number" min="0" max={hours} step="any" placeholder={`of ${dec(hours)} h`} className={`${inp} w-20 text-right`} aria-label="Hours of this session that count here" />
      <button disabled={pending} className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">state share</button>
      {err.length > 0 && <span className="text-rose-700">{err.join("; ")}</span>}
    </form>
  );
}

/** One requirement row, used by both the course block and the summary. */
function RequirementRow({ r, settings, target, showScope = false }: { r: LedgerRequirement; settings: string[]; target: RequirementTarget; showScope?: boolean }) {
  const { router, pending, result, setResult, run } = useLedger();
  const [editing, setEditing] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const v = r.version; const cov = coverageLine(r);
  // In pool mode every session is in the pool: nothing is "shared" to state; the pool line says how the hours were allocated.
  const shared = r.pool ? [] : r.contributors.filter((c) => c.amount == null);
  const counted = r.pool ? r.contributors : r.contributors.filter((c) => c.amount != null);
  return (
    <li className="px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {showScope && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{r.scopeLabel}</span>}
        <span className="font-medium text-slate-800">{r.label}</span>
        {v ? <span className="tabular-nums text-slate-700">{v.quantity != null ? `${dec(v.quantity)} ${v.unit} ${v.basis}` : `${v.unit} — quantity not stated`}</span> : null}
        {v ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800">v{v.version} published</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">no published version</span>}
        {r.draft && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-800">draft v{r.draft.version}</span>}
        {v?.settingRule && <RuleStatusChip status={v.settingRule.status} />}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => { setEditing((e) => !e); setResult(null); }} className="text-slate-600 hover:text-rose-700">{editing ? "close" : r.draft ? "edit draft" : "new version"}</button>
          {r.draft && <PublishButton versionId={r.draft.id} updatedAt={r.draft.updatedAt} onDone={() => router.refresh()} />}
          {v && <button type="button" onClick={() => { if (confirm(`Retire ${r.label} v${v.version}?`)) run(() => retireRequirementVersion(v.id)); }} className="text-slate-400 hover:text-rose-700">retire</button>}
        </span>
      </div>
      <div className="mt-0.5 grid gap-x-6 gap-y-0.5 text-[11px] text-slate-600 md:grid-cols-2">
        <div><span className="text-slate-400">where:</span> {v?.settingRule ? ruleSummary(v.settingRule) : "no setting rule on this requirement"}{v?.supervision ? <> · <span className="text-slate-400">supervision:</span> {supervisionSummary(v.supervision, 10)}</> : null}</div>
        <div><span className="text-slate-400">source:</span> {v?.sourceText ? `“${v.sourceText.length > 90 ? `${v.sourceText.slice(0, 90)}…` : v.sourceText}” · ` : ""}{AUTHORITY[v?.sourceAuthority ?? "unknown"]}{v?.reviewedBy ? ` · reviewed by ${v.reviewedBy}` : ""}</div>
        <div className="md:col-span-2">
          <span className="text-slate-400">represented in the template:</span> <span className={TONE[cov.tone]}>{cov.text}</span>
          {counted.length > 0 && <button type="button" onClick={() => setShowSessions((s) => !s)} className="ml-2 text-slate-500 hover:text-rose-700">{showSessions ? "hide sessions" : "which sessions"}</button>}
        </div>
        {showSessions && counted.length > 0 && <div className="md:col-span-2 text-slate-500">{counted.map((c) => `${c.label} ${c.source === "pool" ? `${dec(c.hours)} h in the pool` : `${dec(c.amount ?? 0)}${c.source === "stated" ? " (stated)" : ""}`}`).join(" · ")}</div>}
        {shared.length > 0 && (
          <ul className="md:col-span-2 space-y-0.5 text-amber-800">
            {shared.slice(0, 8).map((c) => <li key={c.sessionId} className="flex flex-wrap items-center gap-2"><span>{c.label} ({dec(c.hours)} h) also reaches {c.sharedWith.length} other requirement{c.sharedWith.length === 1 ? "" : "s"} of this course — how much counts here?</span><ShareForm requirementId={r.id} sessionId={c.sessionId} hours={c.hours} onDone={() => router.refresh()} /></li>)}
            {shared.length > 8 && <li>and {shared.length - 8} more shared sessions</li>}
          </ul>
        )}
        {r.fulfillments.filter((f) => f.amount != null).length > 0 && <div className="md:col-span-2 text-slate-500">stated shares: {r.fulfillments.filter((f) => f.amount != null).map((f) => <span key={f.id} className="mr-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1 py-0.5">{f.label} {dec(f.amount ?? 0)}<button type="button" onClick={() => run(() => unlinkRequirementFulfillment(f.id))} className="text-slate-400 hover:text-rose-700" aria-label={`remove the stated share for ${f.label}`}>×</button></span>)}</div>}
      </div>
      {editing && <RequirementForm target={target} r={r} settings={settings} pending={pending} result={result} onSubmit={(fd) => run(() => saveRequirementDraft(target, fd), () => setEditing(false))} onCancel={() => setEditing(false)} />}
    </li>
  );
}

/** THE COURSE'S REQUIREMENTS — fields of the course, inside its block on Design & sequence. */
export function CourseRequirements({ programId, courseId, requirements, settings }: { programId: string; courseId: string; requirements: LedgerRequirement[]; settings: string[] }) {
  const { pending, result, setResult, run } = useLedger();
  const [adding, setAdding] = useState(false);
  const target: RequirementTarget = { scope: "course", courseId, programId } as RequirementTarget;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-rose-500">Clinical requirements of this course</span>
        <span className="text-slate-500">— what its clinical sessions must add up to per learner, and where; represented by the sessions below through their rotation rules</span>
        <button type="button" onClick={() => { setAdding((a) => !a); setResult(null); }} className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50">{adding ? "close" : "+ requirement"}</button>
      </div>
      {adding && <div className="px-3 pb-2"><RequirementForm target={target} r={null} settings={settings} pending={pending} result={result} onSubmit={(fd) => run(() => saveRequirementDraft(target, fd), () => setAdding(false))} onCancel={() => setAdding(false)} /></div>}
      <ul className="divide-y divide-slate-100">
        {requirements.map((r) => <RequirementRow key={r.id} r={r} settings={settings} target={target} />)}
        {requirements.length === 0 && <li className="px-3 py-2 text-[11px] text-slate-400">No requirement recorded for this course yet — add one, or let “Describe or upload” propose them from the program document.</li>}
      </ul>
    </div>
  );
}

/** PROGRAM-WIDE AND FAMILY STANDARDS — the short summary above the terms; course requirements live in their courses. */
export function RequirementsSummary({ programId, familyId, requirements, settings }: { programId: string; familyId: string | null; requirements: LedgerRequirement[]; settings: string[] }) {
  const { pending, result, setResult, run } = useLedger();
  const [adding, setAdding] = useState<RequirementTarget | null>(null);
  const published = requirements.filter((r) => r.version);
  const byUnit = new Map<string, { required: number; represented: number; unresolved: number; unstated: number }>();
  for (const r of published) { const u = r.version!.unit; const t = byUnit.get(u) ?? { required: 0, represented: 0, unresolved: 0, unstated: 0 }; t.required += r.version!.quantity ?? 0; t.represented += r.represented; t.unresolved += r.unresolved; t.unstated += r.unstated; byUnit.set(u, t); }
  const unreviewed = published.filter((r) => r.version!.interpretationStatus !== "reviewed" || (r.version!.settingRule && r.version!.settingRule.status !== "reviewed"));
  const unstatedQty = requirements.filter((r) => r.version && r.version.quantity == null).length;
  const top = requirements.filter((r) => r.scope === "family" || r.scope === "program");
  const courseCount = requirements.filter((r) => r.scope === "course").length;
  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-rose-700">
        Educational requirements <span className="font-normal text-slate-400">— {[...byUnit.entries()].map(([u, t]) => `${dec(t.required)} ${u} required · ${dec(t.represented)} in the template${t.unresolved ? ` · ${dec(t.unresolved)} unresolved` : ""}${t.unstated ? ` · ${t.unstated} shares to state` : ""}`).join(" · ") || "none recorded yet"}{unreviewed.length ? ` · ${unreviewed.length} interpretation${unreviewed.length === 1 ? "" : "s"} need review` : ""}{unstatedQty ? ` · ${unstatedQty} quantit${unstatedQty === 1 ? "y" : "ies"} not stated` : ""}</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3 text-xs">
        <p className="text-[11px] text-slate-500">Each course carries its own clinical requirements inside its block below ({courseCount} recorded); what represents them comes from the course&apos;s sessions and their rotation rules. Family standards are shared across the family&apos;s programs and referenced here. Publishing records a person&apos;s review of the interpretation — it does not certify regulatory approval.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => { setAdding({ scope: "program", programId } as RequirementTarget); setResult(null); }} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">+ program-wide requirement</button>
          {familyId && <button type="button" onClick={() => { setAdding({ scope: "family", familyId } as RequirementTarget); setResult(null); }} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">+ family standard</button>}
        </div>
        {adding && <RequirementForm target={adding} r={null} settings={settings} pending={pending} result={result} onSubmit={(fd) => run(() => saveRequirementDraft(adding, fd), () => setAdding(null))} onCancel={() => setAdding(null)} />}
        {top.length > 0 && <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">{top.map((r) => <RequirementRow key={r.id} r={r} settings={settings} showScope target={(r.scope === "family" ? { scope: "family", familyId: familyId ?? "" } : { scope: "program", programId }) as RequirementTarget} />)}</ul>}
      </div>
    </details>
  );
}
