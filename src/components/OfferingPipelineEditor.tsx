"use client";

// The offering page's own enrollment & pipeline targets — saved to THIS cohort.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCohortPipeline } from "@/lib/actions";
import { OfferingTargetsEditor, type OfferingTargets } from "@/components/OfferingTargetsEditor";
import type { LadderRates } from "@/lib/northstar";

export function OfferingPipelineEditor({ cohortId, initial, termNames, defaultRates }: {
  cohortId: string; initial: OfferingTargets; termNames: string[]; defaultRates: LadderRates;
}) {
  const router = useRouter();
  const [value, setValue] = useState<OfferingTargets>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveCohortPipeline(cohortId, { goal: value.goal, rates: value.rates as Record<string, number>, termOverrides: value.termOverrides });
      setDirty(false); router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">This offering&apos;s enrollment &amp; pipeline targets</div>
        <span className="text-[11px] text-slate-500">belong to this offering only — the goal page shows the same numbers on its slot</span>
      </div>
      <OfferingTargetsEditor value={value} termNames={termNames} defaultRates={defaultRates} onChange={(p) => { setValue((v) => ({ ...v, ...p })); setDirty(true); }} />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400">{busy ? "Saving…" : "Save to this offering"}</button>
        {dirty && <span className="text-[11px] text-amber-700">unsaved changes</span>}
      </div>
    </div>
  );
}
