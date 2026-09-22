"use server";

// EXTRACTION JOBS — upload or paste → parse → propose → validate → review → apply (recommendation 6).
// Every step is persisted on an ExtractionJob so a refresh or retry never loses work; the same content
// hash on the same target is reported as a duplicate (re-import is an explicit choice); applying is
// idempotent (a job applies once) and writes only DRAFT / needs-review records through the normal
// server actions — never an active scheduling fact.

import { prisma } from "./db";
import { revalidatePath } from "next/cache";
import { parseSource, parseText, contentHash, validateProposal, deterministicProposal, extractWithProvider, providerConfig, sessionsFromItems, PROMPT_VERSION, type ValidatedProposal, type ValidatedItem, type ParsedSource } from "./extraction";
import { KNOWN_SETTINGS } from "./settingrule";
import { saveRotationRule, saveRequirementDraft, saveSupervisionRule, saveSiteCapability, updateAssetLimits } from "./requirementactions";
import { importProgramSheet } from "./actions";
import { auditChange } from "./changesets";

export interface ExtractionTarget { kind: "program" | "site"; programId?: string | null; familyId?: string | null; employerId?: string | null }
export interface JobView { id: string; status: string; sourceName: string; format: string; bytes: number; attempts: number; error: string | null; provider: string | null; model: string | null; proposal: ValidatedProposal | null; questions: string[]; createdAt: string; appliedAt: string | null; duplicateOf: string | null; fragments: number }

const str = (v: FormDataEntryValue | null) => (v == null ? "" : String(v).trim());
const parseJson = <T,>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };

async function scopeOf(t: ExtractionTarget): Promise<{ institutionId: string } | null> {
  if (t.kind === "program" && t.programId) { const p = await prisma.program.findUnique({ where: { id: t.programId }, select: { institutionId: true } }); return p ? { institutionId: p.institutionId } : null; }
  if (t.kind === "site" && t.employerId) { const e = await prisma.employer.findUnique({ where: { id: t.employerId }, select: { institutionId: true } }); return e ? { institutionId: e.institutionId } : null; }
  return null;
}
async function knownFor(institutionId: string): Promise<Set<string>> {
  const codes = await prisma.clinicalAsset.findMany({ where: { employer: { institutionId }, status: { not: "archived" } }, distinct: ["settingCode"], select: { settingCode: true } });
  return new Set([...KNOWN_SETTINGS, ...codes.map((c) => c.settingCode)]);
}
export async function jobView(id: string): Promise<JobView | null> {
  const j = await prisma.extractionJob.findUnique({ where: { id } });
  if (!j) return null;
  const parsed = parseJson<ParsedSource | null>(j.parsed, null);
  const dup = await prisma.extractionJob.findFirst({ where: { sourceHash: j.sourceHash, institutionId: j.institutionId, id: { not: j.id }, status: "applied" }, select: { id: true } });
  return { id: j.id, status: j.status, sourceName: j.sourceName, format: j.format, bytes: j.bytes, attempts: j.attempts, error: j.error, provider: j.provider, model: j.model, proposal: parseJson<ValidatedProposal | null>(j.proposal, null), questions: parseJson<string[]>(j.questions, []), createdAt: j.createdAt.toISOString(), appliedAt: j.appliedAt?.toISOString() ?? null, duplicateOf: dup?.id ?? null, fragments: parsed?.fragments.length ?? 0 };
}

/** Start a job from an uploaded file (`file`) or pasted text (`text`). Parses at once; extraction runs in the same request (bounded by the size limits), and a failure is stored for retry. */
export async function startExtraction(target: ExtractionTarget, formData: FormData): Promise<{ ok: boolean; id?: string; error?: string }> {
  const scope = await scopeOf(target);
  if (!scope) return { ok: false, error: "the target program or site was not found" };
  const file = formData.get("file"); const text = str(formData.get("text"));
  let parsed: ParsedSource; let sourceName: string; let bytes = 0; let hash: string;
  try {
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File; const buf = Buffer.from(await f.arrayBuffer()); bytes = buf.length; sourceName = f.name; hash = contentHash(buf);
      parsed = await parseSource(f.name, buf, f.type || null);
    } else if (text) {
      sourceName = "pasted text"; bytes = Buffer.byteLength(text); hash = contentHash(text); parsed = parseText(text, "paste");
    } else return { ok: false, error: "choose a file or paste some text" };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "could not read the file" }; }
  const job = await prisma.extractionJob.create({ data: { institutionId: scope.institutionId, kind: target.kind, programId: target.programId ?? null, familyId: target.familyId ?? null, employerId: target.employerId ?? null, sourceName, sourceHash: hash, format: parsed.format, bytes, status: "parsing", parsed: JSON.stringify({ ...parsed, rows: parsed.rows?.slice(0, 5000) }), questions: JSON.stringify(parsed.warnings) } });
  await runExtraction(job.id);
  return { ok: true, id: job.id };
}

/** Run (or re-run) the proposal step for a job. The provider is tried when configured; on failure the deterministic proposer's result is kept and the error stored, so review can continue and a retry is possible. */
export async function runExtraction(id: string): Promise<{ ok: boolean; error?: string }> {
  const j = await prisma.extractionJob.findUnique({ where: { id } });
  if (!j) return { ok: false, error: "job not found" };
  if (j.status === "applied" || j.status === "cancelled") return { ok: false, error: `job is ${j.status}` };
  if (j.attempts >= 5) return { ok: false, error: "retry limit reached — start a new import" };
  const parsed = parseJson<ParsedSource | null>(j.parsed, null);
  if (!parsed) return { ok: false, error: "the parsed source is missing" };
  const known = await knownFor(j.institutionId);
  const cfg = providerConfig();
  await prisma.extractionJob.update({ where: { id }, data: { status: "extracting", attempts: { increment: 1 }, provider: cfg.provider, model: cfg.provider === "anthropic" ? cfg.model : null, promptVersion: PROMPT_VERSION } });
  const deterministic = validateProposal(deterministicProposal(parsed, j.kind as "program" | "site", known), parsed, known);
  let final = deterministic; let error: string | null = null; let model: string | null = null;
  if (cfg.provider === "anthropic") {
    try {
      const r = await extractWithProvider(parsed, j.kind as "program" | "site", cfg);
      const validated = validateProposal(r.proposal, parsed, known);
      model = r.model;
      // The provider's items join the deterministic ones; duplicates by label are kept once (the provider's, which carries questions).
      const seen = new Set(validated.items.map((x) => x.label.toLowerCase()));
      final = { ...validated, items: [...validated.items, ...deterministic.items.filter((x) => !seen.has(x.label.toLowerCase()))], stats: { ok: 0, needsInterpretation: 0, quarantined: 0 } };
      final.stats = { ok: final.items.filter((x) => x.verdict === "ok").length, needsInterpretation: final.items.filter((x) => x.verdict === "needs-interpretation").length, quarantined: final.items.filter((x) => x.verdict === "quarantined").length };
    } catch (e) { error = e instanceof Error ? e.message : "provider error"; }
  } else error = "no AI provider configured — deterministic proposal only (set ANTHROPIC_API_KEY to enable extraction)";
  await prisma.extractionJob.update({ where: { id }, data: { status: "review", proposal: JSON.stringify(final), questions: JSON.stringify([...parsed.warnings, ...final.questions]), error, model: model ?? (cfg.provider === "anthropic" ? cfg.model : null) } });
  return { ok: true, error: error ?? undefined };
}
export async function cancelExtraction(id: string): Promise<void> { await prisma.extractionJob.updateMany({ where: { id, status: { notIn: ["applied"] } }, data: { status: "cancelled" } }); }

/** Apply the accepted items as DRAFTS through the normal server actions. `accepted` = item ids; quarantined items are never applied whatever the form says. */
export async function applyExtraction(id: string, formData: FormData): Promise<{ ok: boolean; errors: string[]; applied: Record<string, number> }> {
  const j = await prisma.extractionJob.findUnique({ where: { id } });
  if (!j) return { ok: false, errors: ["job not found"], applied: {} };
  if (j.status === "applied") return { ok: false, errors: ["this job was already applied — start a new import to apply again"], applied: {} };
  if (j.status !== "review") return { ok: false, errors: [`job is ${j.status}, not in review`], applied: {} };
  const proposal = parseJson<ValidatedProposal | null>(j.proposal, null);
  if (!proposal) return { ok: false, errors: ["no proposal to apply"], applied: {} };
  const acceptedIds = new Set(formData.getAll("accept").map(String));
  const items = proposal.items.filter((it) => acceptedIds.has(it.id) && it.verdict !== "quarantined");
  const errors: string[] = []; const applied: Record<string, number> = {};
  const count = (k: string) => { applied[k] = (applied[k] ?? 0) + 1; };
  const ref = (it: ValidatedItem) => JSON.stringify({ kind: "extraction", jobId: j.id, source: j.sourceName, anchors: it.anchors });
  // Sessions: through the sheet importer in MERGE mode (never a silent replace).
  const sessions = sessionsFromItems(items);
  if (sessions.length && j.programId) { try { const r = await importProgramSheet(j.programId, sessions, { mode: "merge" }); applied["sessions"] = r.sessions; } catch (e) { errors.push(`sessions: ${e instanceof Error ? e.message : "failed"}`); } }
  for (const it of items) {
    try {
      if (it.kind === "setting-rule" && typeof it.fields.rule === "string") {
        const spec = JSON.parse(it.fields.rule) as { rule: unknown; mixing: string; continuity: string; sourceText: string | null; questions: string[] };
        const fd = new FormData(); fd.set("rotationType", String(it.fields.rotationType ?? spec.sourceText ?? it.label)); fd.set("rule", JSON.stringify(spec.rule)); fd.set("mixing", spec.mixing); fd.set("continuity", spec.continuity); fd.set("sourceText", String(spec.sourceText ?? it.fields.sourceText ?? "")); fd.set("questions", JSON.stringify([...spec.questions, ...it.questions])); fd.set("decision", "save");
        const r = await saveRotationRule(j.institutionId, fd); if (!r.ok) errors.push(`${it.label}: ${r.errors.join("; ")}`); else count("setting rules (needs review)");
      } else if (it.kind === "requirement" && j.programId) {
        const fd = new FormData(); fd.set("label", it.label); if (typeof it.fields.quantity === "number") fd.set("quantity", String(it.fields.quantity)); fd.set("unit", String(it.fields.unit ?? "hours")); fd.set("basis", String(it.fields.basis ?? "per-learner")); fd.set("sourceText", String(it.fields.sourceText ?? "")); fd.set("sourceRef", ref(it)); fd.set("sourceAuthority", "unknown"); fd.set("notes", it.questions.join(" "));
        if (typeof it.fields.rule === "string") { const spec = JSON.parse(it.fields.rule) as { rule: unknown; mixing: string; continuity: string; sourceText: string | null; questions: string[] }; fd.set("rule", JSON.stringify(spec.rule)); fd.set("mixing", spec.mixing); fd.set("continuity", spec.continuity); fd.set("questions", JSON.stringify(spec.questions)); fd.set("decision", "save"); }
        const r = await saveRequirementDraft({ scope: "program", programId: j.programId }, fd); if (!r.ok) errors.push(`${it.label}: ${r.errors.join("; ")}`); else count("requirement drafts");
      } else if (it.kind === "supervision" && j.programId) {
        // Supervision from a sheet is per session; without a matched session id it is recorded at program scope as needs-review.
        const fd = new FormData(); const mode = String(it.fields.clinicalMode ?? ""); fd.set("mode", /instructor|group/i.test(mode) ? "instructor-led" : /precept/i.test(mode) ? "preceptor-led" : /hybrid|both|combined/i.test(mode) ? "combined" : "unknown"); if (typeof it.fields.facultyNeeded === "number" && it.fields.facultyNeeded > 0) fd.set("instructor_staffPerGroup", String(it.fields.facultyNeeded)); if (typeof it.fields.preceptorsNeeded === "number" && it.fields.preceptorsNeeded > 0) fd.set("preceptor_staffPerGroup", String(it.fields.preceptorsNeeded)); fd.set("sourceText", mode || it.label); fd.set("sourceRef", ref(it)); fd.set("decision", "save");
        const r = await saveSupervisionRule({ scope: "program", programId: j.programId }, fd); if (!r.ok) errors.push(`${it.label}: ${r.errors.join("; ")}`); else count("supervision rules (needs review)");
      } else if (it.kind === "site-capability" && j.employerId) {
        const fd = new FormData(); fd.set("kind", String(it.fields.kind ?? "experience")); fd.set("label", it.label); fd.set("status", ["supported", "limited", "unsupported"].includes(String(it.fields.status)) ? String(it.fields.status) : "unknown"); if (it.fields.settingCode) fd.set("settingCode", String(it.fields.settingCode)); if (typeof it.fields.capacityValue === "number") { fd.set("capacityValue", String(it.fields.capacityValue)); fd.set("capacityUnit", String(it.fields.capacityUnit ?? "cases-per-year")); } if (it.fields.learnerTypes) fd.set("learnerTypes", String(it.fields.learnerTypes)); if (it.fields.restrictions) fd.set("restrictions", String(it.fields.restrictions)); fd.set("evidenceSource", `${j.sourceName} (extraction ${j.id}) — not verified`); fd.set("notes", it.questions.join(" "));
        const r = await saveSiteCapability(j.employerId, fd); if (!r.ok) errors.push(`${it.label}: ${r.errors.join("; ")}`); else count("site capabilities (unverified)");
      } else if (it.kind === "site-limit" && j.employerId && typeof it.fields.learnersPerShift === "number") {
        const asset = it.fields.assetLabel ? await prisma.clinicalAsset.findFirst({ where: { employerId: j.employerId, OR: [{ externalId: String(it.fields.assetLabel) }, { assetType: { contains: String(it.fields.assetLabel) } }] } }) : null;
        if (!asset) { errors.push(`${it.label}: no asset named "${String(it.fields.assetLabel ?? "")}" at this site — set the limit on the asset by hand`); continue; }
        const fd = new FormData(); fd.set("limitMode", "known"); fd.set("learnersPerShift", String(it.fields.learnersPerShift)); fd.set("availabilityMode", asset.availabilityMode); fd.set("dataSource", "ESTIMATE"); fd.set("evidenceSource", `${j.sourceName} (extraction ${j.id}) — not verified`); fd.set("capabilities", asset.capabilities);
        const r = await updateAssetLimits(asset.id, fd); if (!r.ok) errors.push(`${it.label}: ${r.errors.join("; ")}`); else count("asset limits (estimate)");
      } else if (it.kind === "session") { /* handled above */ }
      else errors.push(`${it.label}: nothing to apply for this kind here`);
    } catch (e) { errors.push(`${it.label}: ${e instanceof Error ? e.message : "failed"}`); }
  }
  const changeSetId = await auditChange({ kind: "extraction-apply", label: `Applied extraction of ${j.sourceName}`, institutionId: j.institutionId, summary: { created: applied, changed: {}, removed: {}, notes: [`${items.length} items accepted of ${proposal.items.length}`, ...(j.model ? [`model ${j.model} · prompt ${j.promptVersion}`] : ["deterministic proposal"]), ...errors.map((e) => `error: ${e}`)] } });
  await prisma.extractionJob.update({ where: { id }, data: { status: "applied", appliedAt: new Date(), appliedChangeSetId: changeSetId, error: errors.length ? errors.join(" | ") : null } });
  if (j.programId) { revalidatePath(`/programs/${j.programId}/structure`); revalidatePath("/insights/clinical-sites"); }
  if (j.employerId) revalidatePath(`/employers/${j.employerId}`);
  return { ok: errors.length === 0, errors, applied };
}

export async function listExtractions(target: ExtractionTarget): Promise<JobView[]> {
  const where = target.kind === "program" ? { programId: target.programId ?? "-" } : { employerId: target.employerId ?? "-" };
  const jobs = await prisma.extractionJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 8, select: { id: true } });
  return (await Promise.all(jobs.map((j) => jobView(j.id)))).filter((v): v is JobView => !!v);
}
