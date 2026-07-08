"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAlignmentProfile, deleteAlignmentProfile, type AlignmentTagInput } from "@/lib/actions";
import {
  LEARNER_MOTIVATIONS, LEARNER_CONSTRAINTS, LEARNER_CAPACITIES,
  EMPLOYER_MOTIVATIONS, EMPLOYER_CONSTRAINTS, EMPLOYER_CAPACITIES,
  computeQuadrant, recommendModes, configGuidance, mvdRequirement,
  TIER_LABEL, type Profile, type Tag, type Leaf, type Side,
} from "@/lib/alignment";

export interface ExistingProfile {
  id: string;
  checkpoint: string;
  mvdTier: number;
  narrative: string | null;
  conductedBy: string | null;
  capturedAt: string | Date;
  tags: { layer: string; code: string; tier: number | null; binding: boolean; conditionalOn: string | null; note: string | null }[];
}

function fromExisting(p: ExistingProfile | null): Tag[] {
  if (!p) return [];
  return p.tags.map((t) => ({
    layer: t.layer as Tag["layer"], code: t.code, tier: t.tier,
    binding: t.binding, conditionalOn: t.conditionalOn, note: t.note,
  }));
}

const CHECKPOINTS = [
  { key: "P0", label: "P0 · Intake" },
  { key: "PMID", label: "P·mid · Midpoint" },
  { key: "P1", label: "P1 · Exit" },
  { key: "P6", label: "P+6 mo" },
  { key: "P24", label: "P+24 mo" },
];
const TIER_CHIP: Record<number, string> = { 1: "bg-rose-600 text-white", 2: "bg-rose-200 text-rose-800", 3: "bg-slate-200 text-slate-700", 4: "bg-slate-100 text-slate-400" };
const QUAD_BADGE: Record<string, string> = { Q1: "bg-emerald-100 text-emerald-800", Q2: "bg-amber-100 text-amber-800", Q3: "bg-sky-100 text-sky-800", Q4: "bg-rose-100 text-rose-800" };

export function AlignmentIntake({ side, studentId, employerId, subjectName, existing }: {
  side: Side; studentId?: string; employerId?: string; subjectName: string; existing: ExistingProfile[];
}) {
  const router = useRouter();
  const [checkpoint, setCheckpoint] = useState("P0");
  const current = existing.find((p) => p.checkpoint === checkpoint) ?? null;

  const [tags, setTags] = useState<Tag[]>(() => fromExisting(current));
  const [narrative, setNarrative] = useState(current?.narrative ?? "");
  const [conductedBy, setConductedBy] = useState(current?.conductedBy ?? "");
  const [loadedFor, setLoadedFor] = useState(checkpoint);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Re-hydrate the editor when switching checkpoints.
  if (loadedFor !== checkpoint) {
    setLoadedFor(checkpoint);
    setTags(fromExisting(current));
    setNarrative(current?.narrative ?? "");
    setConductedBy(current?.conductedBy ?? "");
    setSavedAt(null);
  }

  const [motivLeaves, constraintLeaves, capacityLeaves] = side === "LEARNER"
    ? [LEARNER_MOTIVATIONS, LEARNER_CONSTRAINTS, LEARNER_CAPACITIES]
    : [EMPLOYER_MOTIVATIONS, EMPLOYER_CONSTRAINTS, EMPLOYER_CAPACITIES];

  const profile: Profile = useMemo(() => ({ side, tags }), [side, tags]);
  const quadrant = useMemo(() => computeQuadrant(profile), [profile]);
  const modes = useMemo(() => recommendModes(profile), [profile]);
  const config = useMemo(() => configGuidance(profile), [profile]);
  const mvd = useMemo(() => mvdRequirement(profile, modes.find((m) => !m.struck && m.signals > 0)?.mode.key), [profile, modes]);
  const taggedMotivs = tags.filter((t) => t.layer === "MOTIVATION");

  const tagOf = (code: string) => tags.find((t) => t.code === code);
  const setMotivTier = (code: string, tier: number | null) => setTags((ts) => {
    const rest = ts.filter((t) => t.code !== code);
    return tier == null ? rest : [...rest, { layer: "MOTIVATION" as const, code, tier }];
  });
  const setConditional = (code: string, on: string | null) => setTags((ts) => ts.map((t) => (t.code === code ? { ...t, conditionalOn: on } : t)));
  const toggleConstraint = (code: string) => setTags((ts) => {
    const cur = ts.find((t) => t.code === code);
    if (!cur) return [...ts, { layer: "CONSTRAINT" as const, code, binding: true }];
    if (cur.binding) return ts.map((t) => (t.code === code ? { ...t, binding: false } : t)); // binding → present-not-binding
    return ts.filter((t) => t.code !== code); // present → off
  });
  const toggleCapacity = (code: string) => setTags((ts) => (ts.some((t) => t.code === code) ? ts.filter((t) => t.code !== code) : [...ts, { layer: "CAPACITY" as const, code }]));

  const save = () => startTransition(async () => {
    await saveAlignmentProfile({
      subjectType: side, studentId: studentId ?? null, employerId: employerId ?? null,
      checkpoint, mvdTier: mvd.tier, narrative: narrative || null, conductedBy: conductedBy || null,
      tags: tags.map((t): AlignmentTagInput => ({ layer: t.layer, code: t.code, tier: t.tier ?? null, binding: t.binding ?? false, conditionalOn: t.conditionalOn ?? null, note: t.note ?? null })),
    });
    setSavedAt(new Date().toLocaleTimeString());
    router.refresh();
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      {/* ---- Intake side ---- */}
      <div className="space-y-5">
        {/* Checkpoint + admin */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Checkpoint</span>
            <select value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {CHECKPOINTS.map((c) => <option key={c.key} value={c.key}>{c.label}{existing.some((p) => p.checkpoint === c.key) ? " ✓" : ""}</option>)}
            </select>
          </label>
          <label className="block grow">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Conducted by</span>
            <input value={conductedBy} onChange={(e) => setConductedBy(e.target.value)} placeholder="staff / advisor name" className="w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            {current && <button onClick={() => startTransition(async () => { await deleteAlignmentProfile(current.id); router.refresh(); })} className="text-xs text-slate-400 hover:text-rose-600">delete checkpoint</button>}
            <button onClick={save} disabled={pending} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">{pending ? "Saving…" : `Save ${checkpoint}`}</button>
          </div>
          {savedAt && <span className="w-full text-right text-[11px] text-emerald-600">saved {savedAt}</span>}
        </div>

        {/* Narrative */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700">Narrative</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {side === "LEARNER"
              ? "“Tell me how you came to be considering this — what's it for you?” Capture the story, then tag what's operating below. Economic and family-context motivations are legitimate and welcomed."
              : "“What would make hosting learners worth it for this organization — and who inside actually wants it?” Watch for stakeholder layers that want different things."}
          </p>
          <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={3} placeholder="Narrative capture…" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>

        {/* Motivations */}
        <LeafSection
          title="Motivations" subtitle="Tag what's operating, weighted: Driving (Tier 1) → Latent. Mark a motivation conditional when it only holds if another is served."
          leaves={motivLeaves}
          render={(leaf) => {
            const t = tagOf(leaf.code);
            return (
              <div key={leaf.code} className={`rounded-lg border px-3 py-2 ${t ? "border-rose-200 bg-rose-50/40" : "border-slate-100"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400">{leaf.code}</span>
                  <span className="text-[13px] font-medium text-slate-800">{leaf.label}</span>
                  {leaf.sensitive && <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700" title="consequence-bearing — confidentiality handling">sensitive</span>}
                  <span className="ml-auto flex gap-1">
                    {[1, 2, 3, 4].map((tier) => (
                      <button key={tier} onClick={() => setMotivTier(leaf.code, t?.tier === tier ? null : tier)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${t?.tier === tier ? TIER_CHIP[tier] : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
                        {TIER_LABEL[tier]}
                      </button>
                    ))}
                  </span>
                </div>
                {leaf.hint && <div className="mt-0.5 text-[11px] text-slate-400">{leaf.hint}</div>}
                {t && taggedMotivs.length > 1 && (
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                    conditional on
                    <select value={t.conditionalOn ?? ""} onChange={(e) => setConditional(leaf.code, e.target.value || null)} className="rounded border border-slate-200 px-1 py-0.5 text-[11px]">
                      <option value="">— nothing —</option>
                      {taggedMotivs.filter((m) => m.code !== leaf.code).map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
                    </select>
                  </div>
                )}
              </div>
            );
          }}
        />

        {/* Constraints */}
        <LeafSection
          title="Constraints" subtitle="Design parameters, not deficits. One click = binding (strikes placements); second click = present but not binding; third clears."
          leaves={constraintLeaves}
          render={(leaf) => {
            const t = tagOf(leaf.code);
            const state = !t ? "off" : t.binding ? "binding" : "present";
            return (
              <button key={leaf.code} onClick={() => toggleConstraint(leaf.code)}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left ${state === "binding" ? "border-rose-300 bg-rose-50" : state === "present" ? "border-amber-200 bg-amber-50/50" : "border-slate-100 hover:border-slate-200"}`}>
                <span className="text-[10px] font-mono text-slate-400">{leaf.code}</span>
                <span className="grow">
                  <span className="block text-[13px] font-medium text-slate-800">{leaf.label}</span>
                  {leaf.hint && <span className="block text-[11px] text-slate-400">{leaf.hint}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${state === "binding" ? "bg-rose-600 text-white" : state === "present" ? "bg-amber-200 text-amber-800" : "bg-slate-100 text-slate-400"}`}>
                  {state === "binding" ? "BINDING" : state === "present" ? "present" : "—"}
                </span>
              </button>
            );
          }}
        />

        {/* Capacities */}
        <LeafSection
          title="Capacities" subtitle={side === "LEARNER" ? "What they bring — including experience the credentialing system doesn't count." : "What this partner can actually offer learners."}
          leaves={capacityLeaves}
          render={(leaf) => {
            const on = !!tagOf(leaf.code);
            return (
              <button key={leaf.code} onClick={() => toggleCapacity(leaf.code)}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left ${on ? "border-emerald-300 bg-emerald-50" : "border-slate-100 hover:border-slate-200"}`}>
                <span className="text-[10px] font-mono text-slate-400">{leaf.code}</span>
                <span className="grow">
                  <span className="block text-[13px] font-medium text-slate-800">{leaf.label}</span>
                  {leaf.hint && <span className="block text-[11px] text-slate-400">{leaf.hint}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${on ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"}`}>{on ? "✓" : "—"}</span>
              </button>
            );
          }}
        />
      </div>

      {/* ---- Computed positioning (live) ---- */}
      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">§ Computed positioning <span className="font-normal normal-case">← tiers (settledness) × constraints (capacity)</span></h3>
          <div className="mt-2 flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${QUAD_BADGE[quadrant.quadrant]}`}>{quadrant.quadrant} · {quadrant.name}</span>
          </div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {quadrant.settled ? "HIGH" : "LOW"} settledness · {quadrant.highCapacity ? "HIGH" : "LOW"} operating capacity
          </div>
          <ul className="mt-2 space-y-1 text-[12px] text-slate-600">
            {quadrant.reasoning.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">§ Recommended modes <span className="font-normal normal-case">← motivations × tiers, filtered by constraints</span></h3>
          <div className="mt-2 space-y-2">
            {modes.filter((m) => m.signals > 0 || m.struck).map((m) => (
              <div key={m.mode.key} className={`rounded-lg border p-2.5 ${m.struck ? "border-slate-100 opacity-60" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-semibold ${m.struck ? "text-slate-400 line-through" : "text-slate-800"}`}>{m.mode.label}</span>
                  {!m.struck && m.signals > 0 && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">{m.signals} signal{m.signals === 1 ? "" : "s"} · {m.mode.key}</span>}
                </div>
                <div className="text-[11px] text-slate-400">{m.mode.blurb}</div>
                {!m.struck && m.because.length > 0 && <div className="mt-1 text-[11px] text-slate-600"><span className="font-medium">Because:</span> {m.because.join("; ")}.</div>}
                {m.struck && <div className="mt-1 text-[11px] text-rose-500">Struck: {m.struckBecause}</div>}
                {m.variantNotes.map((v, i) => <div key={i} className="mt-0.5 text-[11px] text-amber-600">⚑ {v}</div>)}
              </div>
            ))}
            {modes.every((m) => m.signals === 0 && !m.struck) && <p className="text-[12px] text-slate-400">Tag motivations to see mode recommendations.</p>}
          </div>
        </div>

        {config.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">§ Configuration <span className="font-normal normal-case">← Tier-1 motivations × constraints × capacities</span></h3>
            <div className="mt-2 space-y-2">
              {config.map((n, i) => (
                <div key={i} className="text-[12px]"><span className="font-semibold text-slate-700">{n.topic}:</span> <span className="text-slate-600">{n.note}</span></div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">§ Disclosure &amp; intake requirement <span className="font-normal normal-case">← sensitivity × stakes</span></h3>
          <div className="mt-2 flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${mvd.tier === 3 ? "bg-rose-100 text-rose-800" : mvd.tier === 2 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>MVD.{mvd.tier}</span>
            <span className="text-[11px] text-slate-400">for {subjectName}</span>
          </div>
          <ul className="mt-2 space-y-1 text-[12px] text-slate-600">{mvd.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

function LeafSection({ title, subtitle, leaves, render }: { title: string; subtitle: string; leaves: Leaf[]; render: (l: Leaf) => React.ReactNode }) {
  // Group by family for readable scanning.
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; leaves: Leaf[] }>();
    for (const l of leaves) {
      const g = m.get(l.family) ?? { label: l.familyLabel, leaves: [] };
      g.leaves.push(l);
      m.set(l.family, g);
    }
    return [...m.values()];
  }, [leaves]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
            <div className="space-y-1.5">{g.leaves.map(render)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
