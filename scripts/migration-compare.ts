// MIGRATION COMPARISON — the legacy single-setting calculation against the typed setting rules, on the
// same seeded data, through the same scheduler. For every college it builds the roster-lever plan twice:
//   legacy  — every rotation collapsed to its first setting code (what the old mapping did), reviewed
//   rules   — the stored / derived setting rules (alternatives, minimums, mixing, one-site), as reviewed
//             or needs-review as they really are
// and prints placed share, unplaced sections, ready share, blockers and the evaluation service's
// counts side by side. Read-only: nothing is written.
//
//   npx tsx scripts/migration-compare.ts            # every college
//   npx tsx scripts/migration-compare.ts --json     # machine-readable

import { prisma } from "../src/lib/db";
import { getCapacityModel, getSchedulerData } from "../src/lib/queries";
import { schedulerModel, planFor, schedulerWindow, ROSTER_POLICY } from "../src/lib/schedulerplan";
import { onlyRule } from "../src/lib/settingrule";
import type { DemandUnit, Plan } from "../src/lib/scheduler";

interface Row { institution: string; variant: "legacy" | "rules"; sections: number; placed: number; placedShare: number; unplaced: number; readyShare: number; blockers: string; conflicts: number; gaps: number; codes: string; altBroadened: number; unreviewed: number }

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
function summarise(institution: string, variant: Row["variant"], plan: Plan, demand: DemandUnit[]): Row {
  const s = plan.evaluation.summary;
  return {
    institution, variant, sections: demand.length, placed: plan.summary.placedShifts, placedShare: plan.summary.placedShare, unplaced: plan.unmet.length, readyShare: plan.summary.readiness.readyShare,
    blockers: plan.blockers.filter((b) => b.blocking).map((b) => `${b.kind} ${b.shifts}`).join(", ") || "none",
    conflicts: s.conflictPlacements, gaps: s.gapOnlyPlacements, codes: s.byCode.slice(0, 5).map((t) => `${t.code} ${t.placements}`).join(", ") || "none",
    altBroadened: demand.filter((u) => u.eligible.length > 1).length, unreviewed: demand.filter((u) => !u.rule || u.rule.status !== "reviewed").length,
  };
}

async function main() {
  const json = process.argv.includes("--json");
  const rows: Row[] = [];
  for (const inst of await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })) {
    const data = await getCapacityModel({ institutionId: inst.id });
    if (!data || !data.cohorts.length) continue;
    const { from, to } = schedulerWindow(data.cohorts);
    const supply = await getSchedulerData(inst.id, from, to);
    const { demand, campus, holidays } = schedulerModel(data.cohorts, supply.rotations);
    const inWindow = demand.filter((u) => u.date >= from && u.date <= to);
    if (!inWindow.length) continue;
    // Legacy: the first setting only, treated as reviewed — exactly what the single-setting mapping meant.
    const legacyDemand = inWindow.map((u) => ({ ...u, rule: u.settingCode ? onlyRule(u.settingCode, u.rotationType, "reviewed") : null, eligible: u.settingCode ? [u.settingCode] : [] }));
    const legacy = planFor(legacyDemand, supply, ROSTER_POLICY, campus, holidays);
    const rules = planFor(inWindow, supply, ROSTER_POLICY, campus, holidays);
    rows.push(summarise(inst.name, "legacy", legacy, legacyDemand), summarise(inst.name, "rules", rules, inWindow));
  }
  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log("| College | Variant | Sections | Placed | Placed share | Unplaced | Ready share | Blocking | Conflicts | Gaps only | Top codes | Sections with alternatives | Unreviewed |");
  console.log("|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|---:|---:|");
  for (const r of rows) console.log(`| ${r.institution} | ${r.variant} | ${r.sections} | ${r.placed} | ${pct(r.placedShare)} | ${r.unplaced} | ${pct(r.readyShare)} | ${r.blockers} | ${r.conflicts} | ${r.gaps} | ${r.codes} | ${r.altBroadened} | ${r.unreviewed} |`);
}

main().then(async () => { await prisma.$disconnect(); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
