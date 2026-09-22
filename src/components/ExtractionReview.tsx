"use client";

// DESCRIBE OR UPLOAD — the AI-assisted path beside manual entry. A file (Excel, CSV, text, a text PDF, Word) or
// pasted text becomes a PROPOSAL: items with the source excerpt each came from, what the server could and could
// not validate, and the questions a person must answer. Nothing is written until the reader accepts items, and
// what is written is a draft or a needs-review record. Labels say what they mean: "parsed", "needs interpretation
// review", never a bare "ready".

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startExtraction, runExtraction, cancelExtraction, applyExtraction, type ExtractionTarget, type JobView } from "@/lib/extractionactions";

const VERDICT: Record<string, { label: string; cls: string }> = { ok: { label: "parsed — nothing to interpret", cls: "bg-emerald-100 text-emerald-800" }, "needs-interpretation": { label: "needs interpretation review", cls: "bg-amber-100 text-amber-800" }, quarantined: { label: "unsupported — not applied", cls: "bg-rose-100 text-rose-800" } };
const KIND_LABEL: Record<string, string> = { session: "session", "setting-rule": "setting rule", supervision: "supervision", requirement: "requirement", "site-capability": "capability", "site-limit": "learner limit", "site-availability": "availability" };
const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";

export function ExtractionReview({ target, jobs, title = "Describe or upload" }: { target: ExtractionTarget; jobs: JobView[]; title?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(jobs.find((j) => j.status === "review")?.id ?? null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<{ errors: string[]; applied: Record<string, number> } | null>(null);
  const job = jobs.find((j) => j.id === open) ?? null;
  const submit = (fd: FormData) => { setError(null); start(async () => { const r = await startExtraction(target, fd); if (!r.ok) setError(r.error ?? "failed"); else { setOpen(r.id ?? null); setAccepted(new Set()); router.refresh(); } }); };
  const acceptAll = (verdict?: string) => { if (!job?.proposal) return; setAccepted(new Set(job.proposal.items.filter((i) => i.verdict !== "quarantined" && (!verdict || i.verdict === verdict)).map((i) => i.id))); };
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800">{title} <span className="font-normal text-slate-400">— a document or plain words become a reviewable proposal; manual entry stays available beside it</span></h3>
        <p className="text-[11px] text-slate-500">Supported: Excel, CSV / TSV, pasted cells or text, text PDFs and Word .docx. A scanned PDF with no text layer is reported as unreadable (no OCR here). Uploaded text is treated as data — instructions inside it are never followed. Applying writes drafts and needs-review records only.</p>
      </div>
      <form action={submit} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <input type="file" name="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,.md,.pdf,.docx" className="block text-xs" aria-label="File to extract from" />
          <textarea name="text" rows={3} placeholder={target.kind === "program" ? "…or describe the program in words: “Students complete 60 clinical hours in an acute medical-surgical unit or a long-term care facility, in ten six-hour sessions with a college instructor…”" : "…or describe the site: “The med-surg unit takes 4 students at a time on day shift, Monday to Friday; no students in the ICU; 900 laparoscopic cases a year…”"} className={`${inp} w-full`} aria-label="Pasted text" />
        </div>
        <button disabled={pending} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{pending ? "Working…" : "Propose from this"}</button>
        {error && <p className="text-xs text-rose-700 sm:col-span-2">{error}</p>}
      </form>
      {jobs.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-slate-100 px-4 py-2 text-[11px]">
          {jobs.map((j) => <button key={j.id} type="button" onClick={() => { setOpen(j.id); setAccepted(new Set()); setApplyResult(null); }} className={`rounded-full border px-2 py-0.5 ${open === j.id ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{j.sourceName} · {j.status}{j.duplicateOf ? " · same content applied before" : ""}</button>)}
        </div>
      )}
      {job && (
        <div className="border-t border-slate-100 px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{job.sourceName}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">{job.status}</span>
            <span className="text-slate-500">{job.format} · {job.fragments} fragments · attempt {job.attempts}{job.model ? ` · ${job.model}` : job.provider === "none" ? " · deterministic (no AI provider configured)" : ""}</span>
            {job.status === "review" && <button type="button" onClick={() => start(async () => { await runExtraction(job.id); router.refresh(); })} className="text-slate-600 hover:text-rose-700">re-run</button>}
            {job.status !== "applied" && job.status !== "cancelled" && <button type="button" onClick={() => start(async () => { await cancelExtraction(job.id); router.refresh(); })} className="text-slate-400 hover:text-rose-700">cancel</button>}
          </div>
          {job.error && <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">{job.error}{job.status === "review" ? " — the proposal below is what could be derived; re-run to try the provider again, or enter the rest by hand." : ""}</p>}
          {job.duplicateOf && <p className="mt-1 text-slate-500">The same content was applied before (job {job.duplicateOf}). Applying again creates new versions on purpose.</p>}
          {job.proposal && (
            <>
              <p className="mt-2 text-slate-700">{job.proposal.summary} — <strong>{job.proposal.stats.ok}</strong> parsed, <strong className="text-amber-700">{job.proposal.stats.needsInterpretation}</strong> need interpretation review, <strong className="text-rose-700">{job.proposal.stats.quarantined}</strong> unsupported.</p>
              {job.questions.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-800">{job.questions.slice(0, 10).map((q) => <li key={q}>{q}</li>)}</ul>}
              {job.status === "review" && (
                <form action={(fd) => start(async () => { const r = await applyExtraction(job.id, fd); setApplyResult({ errors: r.errors, applied: r.applied }); router.refresh(); })} className="mt-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => acceptAll("ok")} className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50">accept every parsed item</button>
                    <button type="button" onClick={() => acceptAll()} className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50">accept parsed + needs-review (as drafts)</button>
                    <button type="button" onClick={() => setAccepted(new Set())} className="text-slate-500 hover:text-rose-700">clear</button>
                    <span className="ml-auto text-slate-500">{accepted.size} accepted</span>
                    <button disabled={pending || accepted.size === 0} className="rounded bg-rose-600 px-3 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-50">Apply accepted as drafts</button>
                  </div>
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {job.proposal.items.map((it) => { const v = VERDICT[it.verdict]; return (
                      <li key={it.id} className="px-3 py-1.5">
                        <label className="flex flex-wrap items-center gap-2">
                          <input type="checkbox" name="accept" value={it.id} checked={accepted.has(it.id)} disabled={it.verdict === "quarantined"} onChange={(e) => setAccepted((s) => { const n = new Set(s); e.target.checked ? n.add(it.id) : n.delete(it.id); return n; })} />
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{KIND_LABEL[it.kind] ?? it.kind}</span>
                          <span className="font-medium text-slate-800">{it.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.cls}`}>{v.label}</span>
                          <span className="text-[10px] text-slate-400">{it.basis === "stated" ? "stated in the source" : "suggested default"} · confidence {it.confidence}</span>
                        </label>
                        <div className="ml-6 mt-0.5 grid gap-x-4 gap-y-0.5 text-[11px] text-slate-600 md:grid-cols-2">
                          <div><span className="text-slate-400">proposed:</span> {Object.entries(it.fields).filter(([, val]) => val != null && val !== "").slice(0, 10).map(([k, val]) => `${k}: ${k === "rule" ? "(rule — see questions)" : String(val)}`).join(" · ")}</div>
                          <div><span className="text-slate-400">source:</span> {it.anchors.map((a) => <span key={a.ref} className="mr-2"><span className="rounded bg-slate-100 px-1 font-mono text-[10px]">{a.ref}</span> “{a.excerpt.slice(0, 90)}{a.excerpt.length > 90 ? "…" : ""}”</span>)}</div>
                          {it.problems.length > 0 && <div className="text-rose-700 md:col-span-2">{it.problems.join("; ")}</div>}
                          {it.questions.length > 0 && <ul className="list-disc pl-4 text-amber-800 md:col-span-2">{it.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
                        </div>
                      </li>
                    ); })}
                    {job.proposal.items.length === 0 && <li className="px-3 py-2 text-slate-400">Nothing could be derived from this source.</li>}
                  </ul>
                </form>
              )}
              {applyResult && <div className={`mt-2 rounded border px-2 py-1 ${applyResult.errors.length ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>Applied: {Object.entries(applyResult.applied).map(([k, n]) => `${n} ${k}`).join(" · ") || "nothing"}{applyResult.errors.length ? ` · problems: ${applyResult.errors.join("; ")}` : ""}</div>}
              {job.status === "applied" && <p className="mt-1 text-emerald-700">Applied {job.appliedAt?.slice(0, 10)} as drafts and needs-review records.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
