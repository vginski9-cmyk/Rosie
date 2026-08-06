import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamily } from "@/lib/queries";
import { GoalPlanner } from "@/components/GoalPlanner";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";

export const dynamic = "force-dynamic";

const monthYear = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null);

const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };

export default async function FamilyPage({ params }: { params: { id: string } }) {
  const data = await getFamily(params.id);
  if (!data) notFound();
  const { family, demand } = data;

  // Grad years across all templates (drives the goal planner's year span).
  const cohortGradYears = family.programs.flatMap((p) => p.cohorts.map((co) => gradYearOf(co.name) || co.entryYear || 0)).filter((y) => y > 0);

  const demandByYear: Record<number, number> = {};
  for (const d of demand) if (d.openings != null) demandByYear[d.year] = d.openings;
  const goalByYear: Record<number, number> = {};
  for (const p of family.programs) for (const t of p.yearTargets) if (t.credentialTarget != null) goalByYear[t.year] = (goalByYear[t.year] ?? 0) + t.credentialTarget;

  const totalCohorts = cohortGradYears.length;
  const totalStudents = family.programs.reduce((n, p) => n + p.cohorts.reduce((m, c) => m + c._count.students, 0), 0);

  // Seeds for the multi-year North-Star goal planner: the span of years the
  // family is planning for (its target years ∪ cohort grad years), and the
  // per-year goals from the family's credential targets.
  const yearSet = new Set<number>([...Object.keys(goalByYear).map(Number), ...Object.keys(demandByYear).map(Number), ...cohortGradYears]);
  const seedYears = [...yearSet].sort((a, b) => a - b);
  const seedGoalsByYear: Record<number, number> = goalByYear;

  // Instantiations (cohorts) grouped by graduation year, with ACTUALS sourced live
  // from the student database (counts by lifecycle status).
  const STATUS_RANK: Record<string, number> = { prospect: 0, applicant: 1, admitted: 2, enrolled: 3, completed: 4, licensed: 5, placed: 6, productive: 7 };
  const today = new Date();
  const nowYear = today.getUTCFullYear();
  const instantiationsByYear: Record<number, import("@/components/GoalPlanner").Instantiation[]> = {};
  for (const p of family.programs) {
    const orderedTerms = [...p.terms].sort((a, b) => a.index - b.index);
    const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
    for (const co of p.cohorts) {
      const gy = gradYearOf(co.name) || co.entryYear || 0;
      if (!gy) continue;
      let enrolled = 0, completed = 0, placed = 0;
      for (const st of co.students) {
        if (st.status === "withdrawn") continue;
        const r = STATUS_RANK[st.status] ?? -1;
        if (r >= 3) enrolled++;
        if (r >= 4) completed++;
        if (r >= 6) placed++;
      }
      const goalProductive = Math.round(co.stages.find((x) => x.stageKey === "productive")?.targetNumber ?? 0);
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
      const realStarts = orderedTerms.map((t) => ctById.get(t.id) ?? null);
      const tm = computeCohortTiming(co.startDate, timingTerms, today, realStarts);
      (instantiationsByYear[gy] ??= []).push({
        id: co.id, name: co.name, programId: p.id, program: p.name,
        goalProductive, students: co._count.students, enrolled, completed, placed, status: co.status,
        phase: tm.phase, currentTerm: tm.currentTermName,
        endLabel: tm.endDate ? `${tm.phase === "graduated" ? "ended" : "ends"} ${monthYear(tm.endDate)}` : null,
      });
    }
  }

  // Full cumulative actual funnel per year (interested → productive) from student data.
  const actualByYear: Record<number, import("@/components/GoalPlanner").ActualFunnel> = {};
  for (const p of family.programs) {
    for (const co of p.cohorts) {
      const gy = gradYearOf(co.name) || co.entryYear || 0;
      if (!gy) continue;
      const a = (actualByYear[gy] ??= { interested: 0, qualified: 0, offered: 0, enrolled: 0, completing: 0, licensed: 0, placed: 0, productive: 0 });
      for (const st of co.students) {
        if (st.status === "withdrawn") continue;
        const r = STATUS_RANK[st.status] ?? -1;
        if (r >= 0) a.interested++;
        if (r >= 1) a.qualified++;
        if (r >= 2) a.offered++;
        if (r >= 3) a.enrolled++;
        if (r >= 4) a.completing++;
        if (r >= 5) a.licensed++;
        if (r >= 6) a.placed++;
        if (r >= 7) a.productive++;
      }
    }
  }

  // Group the family's delivery-model templates by credential (AAS / Diploma / Cert),
  // citing how many fully-productive workers each is expected to deliver this year.
  const homeYear = new Date().getUTCFullYear();
  const targetFor = (p: (typeof family.programs)[number], y: number) => p.yearTargets.find((t) => t.year === y)?.credentialTarget ?? 0;
  const credGroups = (() => {
    const m = new Map<string, { credential: string; expected: number; programs: { p: (typeof family.programs)[number]; running: number; expected: number }[] }>();
    for (const p of family.programs) {
      const cred = p.credential || "Other";
      const running = p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length;
      const e = m.get(cred) ?? { credential: cred, expected: 0, programs: [] };
      e.expected += targetFor(p, homeYear);
      e.programs.push({ p, running, expected: targetFor(p, homeYear) });
      m.set(cred, e);
    }
    return [...m.values()].sort((a, b) => b.expected - a.expected || a.credential.localeCompare(b.credential));
  })();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← {family.institution.name}</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{family.name}</h1>
            <p className="text-sm text-slate-500">
              Program family{family.occupation ? <> · {family.occupation.title} · SOC {family.occupation.socCode}</> : null} · {family.programs.length} template{family.programs.length === 1 ? "" : "s"} · {totalCohorts} cohorts · {totalStudents} students
            </p>
            {family.description && <p className="mt-1 max-w-3xl text-xs text-slate-400">{family.description}</p>}
          </div>
        </div>
      </div>

      {/* Design & pathways — delivery models + interventions per target population */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={`/families/${family.id}/design`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-rose-200 hover:bg-rose-50/40">
          <div>
            <div className="text-sm font-semibold text-slate-800">Program design &amp; pathways ↦</div>
            <div className="text-xs text-slate-500">
              {credGroups.map((g) => `${g.credential} (${g.programs.length})`).join(" · ")} · delivery models + pipeline interventions per target population
            </div>
          </div>
          <span className="text-rose-600">→</span>
        </Link>
        <Link href={`/families/${family.id}/analytics`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-rose-200 hover:bg-rose-50/40">
          <div>
            <div className="text-sm font-semibold text-slate-800">Talent-pipeline analytics ↦</div>
            <div className="text-xs text-slate-500">
              funnel ladder, health metrics vs benchmarks, year-by-season pipeline &amp; Y-O-Y — with full number lineage
            </div>
          </div>
          <span className="text-rose-600">→</span>
        </Link>
      </div>

      {/* North-Star goal planner — set the goal + adjust every % in a row, autocalculated */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">North-Star goal &amp; pipeline plan</h2>
          <p className="text-sm text-slate-500">
            Set the family&apos;s multi-year goal, then adjust any health-metric percentage — goal or actual — and the whole
            pipeline ladder, including term-by-term enrollment, recomputes live. This is how each program anchors its activity
            to the workforce goal it&apos;s working toward.
          </p>
        </div>
        <GoalPlanner familyId={family.id} familyName={family.name} seedYears={seedYears} seedGoalsByYear={seedGoalsByYear} savedPlan={family.goalPlan ?? null} instantiationsByYear={instantiationsByYear} actualByYear={actualByYear} nowYear={nowYear} />
      </section>

    </div>
  );
}
