"use client";

// SETTING RULE EDITOR — replaces the single "which setting" drop-down with the rule a rotation actually
// means: a compact plain-words summary, the original wording, the interpretation status and its open
// questions, and an edit control that builds one of the five bounded rule shapes. Nobody types JSON:
// the form produces it, the server validates it. "Propose from wording" is lexical help only — it
// never marks anything reviewed; a person does that, by name.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { describeRule, proposeRuleFromText, openQuestions, eligibleSettings, type SettingRule, type SettingRuleSpec, type Mixing, type Continuity } from "@/lib/settingrule";
import { saveRotationRule, type ActionResult } from "@/lib/requirementactions";
import { settingName } from "@/lib/settingPresets";

export interface RuleRowView {
  rotationType: string; unitCategory: string; rule: SettingRuleSpec | null; revision: number; reviewedBy: string | null; reviewedAt: string | null; sourceText: string | null;
  /** The rule was tagged automatically from the wording against the setting taxonomy and is not yet saved — one save keeps it (as proposed) for review. */
  auto?: boolean;
}

const STATUS_STYLE: Record<string, string> = { reviewed: "bg-emerald-100 text-emerald-800", "needs-review": "bg-amber-100 text-amber-800", proposed: "bg-sky-100 text-sky-800" };
const STATUS_TEXT: Record<string, string> = { reviewed: "reviewed", "needs-review": "needs interpretation review", proposed: "proposed — not reviewed" };
export function RuleStatusChip({ status }: { status: string | null }) {
  const s = status ?? "unmapped";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[s] ?? "bg-rose-100 text-rose-800"}`}>{STATUS_TEXT[s] ?? "no rule"}</span>;
}

/** A plain-words line for a rule, e.g. "medical-surgical OR long-term care · hours may not be mixed · one site". */
export function ruleSummary(spec: SettingRuleSpec | null): string {
  if (!spec) return "no setting rule — demand for this rotation cannot be matched";
  const bits = [describeRule(spec.rule, (c) => `${settingName(c)} (${c})`)];
  const alternatives = spec.rule.kind !== "only" && spec.rule.kind !== "all-of";
  if (alternatives) bits.push(spec.mixing === "allowed" ? "hours may be mixed" : spec.mixing === "forbidden" ? "hours may not be mixed" : "mixing: to confirm");
  if (spec.continuity === "one-site") bits.push("whole rotation at one site"); else if (spec.continuity === "unknown") bits.push("continuity: to confirm");
  return bits.join(" · ");
}

interface Draft { kind: SettingRule["kind"]; settings: string[]; quantities: Record<string, string>; count: string; minimumEach: string; mixing: Mixing; continuity: Continuity; sourceText: string; reviewedBy: string; questions: string[] }
const draftOf = (spec: SettingRuleSpec | null, rotationType: string): Draft => {
  const r = spec?.rule;
  const quantities: Record<string, string> = {};
  if (r?.kind === "all-of") for (const c of r.components) quantities[c.setting] = c.quantity == null ? "" : String(c.quantity);
  if (r?.kind === "pool") for (const m of r.minimums) quantities[m.setting] = String(m.quantity);
  return { kind: r?.kind ?? "only", settings: r ? eligibleSettings(r) : [], quantities, count: r?.kind === "n-of" ? String(r.count) : "2", minimumEach: r?.kind === "n-of" && r.minimumEach != null ? String(r.minimumEach) : "", mixing: spec?.mixing ?? "unknown", continuity: spec?.continuity ?? "unknown", sourceText: spec?.sourceText ?? rotationType, reviewedBy: "", questions: spec?.questions ?? [] };
};
/** The bounded rule the form describes — or null with a reason while it is incomplete. */
export function ruleFromDraft(d: Draft): { rule: SettingRule | null; problem: string | null } {
  const q = (s: string) => (d.quantities[s] === "" || d.quantities[s] == null ? null : Number(d.quantities[s]));
  switch (d.kind) {
    case "only": return d.settings.length === 1 ? { rule: { kind: "only", setting: d.settings[0] }, problem: null } : { rule: null, problem: "pick exactly one setting" };
    case "any-of": return d.settings.length >= 2 ? { rule: { kind: "any-of", settings: d.settings }, problem: null } : { rule: null, problem: "pick at least two alternative settings" };
    case "all-of": return d.settings.length >= 2 ? { rule: { kind: "all-of", components: d.settings.map((s) => ({ setting: s, quantity: q(s) })) }, problem: null } : { rule: null, problem: "pick at least two required settings" };
    case "pool": return d.settings.length >= 1 ? { rule: { kind: "pool", settings: d.settings, minimums: d.settings.filter((s) => q(s) != null && (q(s) as number) > 0).map((s) => ({ setting: s, quantity: q(s) as number })) }, problem: null } : { rule: null, problem: "pick the settings in the pool" };
    case "n-of": return d.settings.length >= 2 ? { rule: { kind: "n-of", count: Math.max(1, Math.round(Number(d.count) || 1)), settings: d.settings, minimumEach: d.minimumEach === "" ? null : Number(d.minimumEach) }, problem: null } : { rule: null, problem: "pick at least two settings to choose from" };
  }
}

const KIND_LABEL: Record<SettingRule["kind"], string> = { only: "one setting only", "any-of": "any of these (alternatives)", "all-of": "all of these (each required)", pool: "a pool with minimums", "n-of": "any N of these" };
const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";

/** The rule-building fields, shared by the rotation editor and the requirement ledger. Emits hidden inputs the server actions read. */
export function RuleFields({ draft, onChange, settings, unit = "hours" }: { draft: Draft; onChange: (d: Draft) => void; settings: string[]; unit?: string }) {
  const { rule, problem } = ruleFromDraft(draft);
  const toggle = (s: string) => onChange({ ...draft, settings: draft.settings.includes(s) ? draft.settings.filter((x) => x !== s) : [...draft.settings, s] });
  const needsQty = draft.kind === "all-of" || draft.kind === "pool";
  const alternatives = draft.kind === "any-of" || draft.kind === "pool" || draft.kind === "n-of";
  return (
    <div className="space-y-2 text-xs">
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Original wording</span><input value={draft.sourceText} onChange={(e) => onChange({ ...draft, sourceText: e.target.value })} className={`${inp} w-full`} placeholder="as the program wrote it" /></label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rule shape</span><select value={draft.kind} onChange={(e) => onChange({ ...draft, kind: e.target.value as SettingRule["kind"] })} className={inp}>{(Object.keys(KIND_LABEL) as SettingRule["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <button type="button" onClick={() => { const p = proposeRuleFromText(draft.sourceText, new Set(settings)); if (p) onChange({ ...draftOf(p, draft.sourceText), reviewedBy: draft.reviewedBy, sourceText: draft.sourceText, questions: p.questions }); else alert("No setting words recognised in that wording — pick the settings by hand."); }} className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">Propose from wording</button>
        <span className="text-[11px] text-slate-400">a lexical proposal — it never settles substitutability</span>
      </div>
      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Settings{draft.kind === "n-of" ? " to choose from" : ""}</span>
        <div className="mt-1 flex flex-wrap gap-1">{settings.map((s) => <button type="button" key={s} onClick={() => toggle(s)} className={`rounded-full border px-2 py-0.5 ${draft.settings.includes(s) ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`} title={settingName(s)}>{s}</button>)}</div>
        {draft.settings.length > 0 && <div className="mt-1 text-[11px] text-slate-500">{draft.settings.map((s) => `${s} = ${settingName(s)}`).join(" · ")}</div>}
      </div>
      {needsQty && draft.settings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draft.settings.map((s) => <label key={s} className="block"><span className="block text-[10px] text-slate-500">{draft.kind === "all-of" ? `${unit} required in ${s}` : `at least … ${unit} in ${s}`}</span><input type="number" min="0" step="any" value={draft.quantities[s] ?? ""} onChange={(e) => onChange({ ...draft, quantities: { ...draft.quantities, [s]: e.target.value } })} className={`${inp} w-28 text-right`} placeholder={draft.kind === "all-of" ? "to confirm" : "no minimum"} /></label>)}
        </div>
      )}
      {draft.kind === "n-of" && (
        <div className="flex flex-wrap gap-2">
          <label className="block"><span className="block text-[10px] text-slate-500">distinct settings required</span><input type="number" min="1" step="1" value={draft.count} onChange={(e) => onChange({ ...draft, count: e.target.value })} className={`${inp} w-20 text-right`} /></label>
          <label className="block"><span className="block text-[10px] text-slate-500">minimum {unit} in each</span><input type="number" min="0" step="any" value={draft.minimumEach} onChange={(e) => onChange({ ...draft, minimumEach: e.target.value })} className={`${inp} w-28 text-right`} placeholder="to confirm" /></label>
        </div>
      )}
      {alternatives && (
        <fieldset className="flex flex-wrap items-center gap-2"><legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">May one learner&apos;s {unit} be split across these settings?</legend>
          {(["allowed", "forbidden", "unknown"] as Mixing[]).map((m) => <label key={m} className="flex items-center gap-1"><input type="radio" name={`mixing-${draft.sourceText}`} checked={draft.mixing === m} onChange={() => onChange({ ...draft, mixing: m })} />{m === "allowed" ? "yes, mixing allowed" : m === "forbidden" ? "no — one setting only" : "not confirmed"}</label>)}
        </fieldset>
      )}
      <fieldset className="flex flex-wrap items-center gap-2"><legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Must the rotation stay at one site?</legend>
        {(["one-site", "none", "unknown"] as Continuity[]).map((c) => <label key={c} className="flex items-center gap-1"><input type="radio" name={`cont-${draft.sourceText}`} checked={draft.continuity === c} onChange={() => onChange({ ...draft, continuity: c })} />{c === "one-site" ? "yes, one site" : c === "none" ? "no" : "not confirmed"}</label>)}
      </fieldset>
      <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">{rule ? <>Reads as: <strong>{describeRule(rule, (c) => `${settingName(c)} (${c})`)}</strong></> : <span className="text-amber-700">{problem}</span>}</div>
      <input type="hidden" name="rule" value={rule ? JSON.stringify(rule) : ""} readOnly />
      <input type="hidden" name="mixing" value={draft.mixing} readOnly /><input type="hidden" name="continuity" value={draft.continuity} readOnly /><input type="hidden" name="scope" value="learner" readOnly />
      <input type="hidden" name="sourceText" value={draft.sourceText} readOnly /><input type="hidden" name="questions" value={JSON.stringify(draft.questions)} readOnly />
    </div>
  );
}
export type RuleDraft = Draft;
export const ruleDraftOf = draftOf;

/** One rotation type: the summary and, on demand, the editor. */
export function SettingRuleEditor({ institutionId, row, settings, extra }: { institutionId: string; row: RuleRowView; settings: string[]; extra?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(row.rule, row.sourceText ?? row.rotationType));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const questions = row.rule ? openQuestions(row.rule) : ["Map this rotation to the settings that satisfy it."];
  const submit = (decision: "save" | "review") => (fd: FormData) => { fd.set("decision", decision); fd.set("rotationType", row.rotationType); fd.set("expectedRevision", String(row.revision)); fd.set("unitCategory", row.unitCategory); fd.set("reviewedBy", draft.reviewedBy); start(async () => { const r = await saveRotationRule(institutionId, fd); setResult(r); if (r.ok) { setOpen(false); router.refresh(); } }); };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">{row.rotationType}</span>
        <RuleStatusChip status={row.rule?.status ?? null} />
        <span className="min-w-0 flex-1 text-xs text-slate-600">{ruleSummary(row.rule)}</span>
        {extra}
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50" aria-expanded={open}>{open ? "close" : row.rule ? "edit rule" : "map it"}</button>
      </div>
      {row.auto && row.rule && <div className="mt-0.5 text-[11px] text-sky-800">tagged automatically from the wording against the setting taxonomy — not saved yet; open it to keep it (as proposed) or correct it, then mark it reviewed</div>}
      {row.rule?.sourceText && row.rule.sourceText !== row.rotationType && <div className="mt-0.5 text-[11px] text-slate-500">wording: &ldquo;{row.rule.sourceText}&rdquo;</div>}
      {row.reviewedBy && row.rule?.status === "reviewed" && <div className="text-[11px] text-emerald-700">reviewed by {row.reviewedBy}{row.reviewedAt ? ` on ${row.reviewedAt.slice(0, 10)}` : ""}</div>}
      {questions.length > 0 && row.rule?.status !== "reviewed" && <ul className="mt-1 list-disc pl-5 text-[11px] text-amber-800">{questions.map((q) => <li key={q}>{q}</li>)}</ul>}
      {open && (
        <form action={submit("save")} className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          <RuleFields draft={draft} onChange={setDraft} settings={settings} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input value={draft.reviewedBy} onChange={(e) => setDraft({ ...draft, reviewedBy: e.target.value })} placeholder="reviewer's name (to mark reviewed)" className={`${inp} w-56`} aria-label="Reviewer's name" />
            <button disabled={pending} className="rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">Save — needs review</button>
            <button disabled={pending} formAction={submit("review")} className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white hover:bg-emerald-800">Save and mark reviewed</button>
            {pending && <span className="text-slate-500">saving…</span>}
          </div>
          {result && !result.ok && <ul className="list-disc rounded border border-rose-200 bg-rose-50 px-4 py-1 text-xs text-rose-800">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </form>
      )}
    </div>
  );
}
