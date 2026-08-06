import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamily } from "@/lib/queries";
import { cohortFacts, type PipelineFact } from "@/lib/pipeline";
import { BENCHMARK_RATES, type LadderRates } from "@/lib/northstar";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";
import { PipelineAnalytics, type CohortOpt, type ProgramOpt } from "@/components/PipelineAnalytics";

export const dynamic = "force-dynamic";

const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };
const seasonOf = (d: Date | null): string => {
  if (!d) return "Fall";
  const m = d.getUTCMonth() + 1;
  return m <= 5 ? "Spring" : m <= 7 ? "Summer" : "Fall";
};
const STATUS_RANK: Record<string, number> = { prospect: 0, applicant: 1, admitted: 2, enrolled: 3, completed: 4, licensed: 5, placed: 6, productive: 7 };

export default async function FamilyAnalyticsPage({ params }: { params: { id: string } }) {
  const data = await getFamily(params.id);
  if (!data) notFound();
  const { family } = data;
  const today = new Date();

  // The SAME rates the goal planner saves — one goal plan, every surface reads it.
  let rates: LadderRates = { ...BENCHMARK_RATES };
  if (family.goalPlan) {
    try {
      const saved = JSON.parse(family.goalPlan) as { goal?: Partial<LadderRates> };
      if (saved.goal) rates = { ...rates, ...saved.goal };
    } catch { /* keep benchmarks */ }
  }

  const facts: PipelineFact[] = [];
  const cohortOpts: CohortOpt[] = [];
  for (const p of family.programs) {
    const orderedTerms = [...p.terms].sort((a, b) => a.index - b.index);
    const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
    for (const co of p.cohorts) {
      const endYear = gradYearOf(co.name) || co.entryYear || 0;
      if (!endYear) continue;

      // Actuals — cumulative stage counts from live student records.
      let interested = 0, qualified = 0, offered = 0, enrolled = 0, completing = 0, licensed = 0, placed = 0, productive = 0, active = 0;
      for (const st of co.students) {
        if (st.status === "withdrawn") continue;
        const r = STATUS_RANK[st.status] ?? -1;
        if (r >= 0) interested++;
        if (r >= 1) qualified++;
        if (r >= 2) offered++;
        if (r >= 3) enrolled++;
        if (r >= 4) completing++;
        if (r >= 5) licensed++;
        if (r >= 6) placed++;
        if (r >= 7) productive++;
        if (st.status === "enrolled") active++;
      }
      const hasStudents = co.students.some((s) => s.status !== "withdrawn");

      // Per-term actual headcount where we can know it: term 1 = everyone who
      // ever enrolled; the CURRENT term (from the live calendar) = currently
      // active students. Past/future terms stay blank rather than guessed.
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
      const realStarts = orderedTerms.map((t) => ctById.get(t.id) ?? null);
      const tm = computeCohortTiming(co.startDate, timingTerms, today, realStarts);
      const termActuals: (number | null)[] = orderedTerms.map(() => null);
      if (hasStudents && termActuals.length) {
        termActuals[0] = enrolled || null;
        if (tm.phase === "in-program" && tm.currentTermIndex && tm.currentTermIndex > 1) {
          termActuals[tm.currentTermIndex - 1] = active || null;
        }
      }

      const productiveGoal = co.stages.find((s) => s.stageKey === "productive")?.targetNumber ?? 0;
      cohortOpts.push({ id: co.id, name: co.name, programId: p.id, endYear });
      facts.push(...cohortFacts({
        institution: family.institution.name, familyId: family.id, family: family.name,
        programId: p.id, program: p.name, credential: p.credential,
        cohortId: co.id, cohort: co.name, endYear, season: seasonOf(co.startDate),
        productiveGoal, numTerms: Math.max(1, orderedTerms.length),
        actuals: hasStudents
          ? { interested, qualified, offered, enrolled, completing, licensed, placed, productive, terms: termActuals }
          : { terms: termActuals },
      }, rates));
    }
  }
  cohortOpts.sort((a, b) => a.endYear - b.endYear || a.name.localeCompare(b.name));

  const programOpts: ProgramOpt[] = family.programs.map((p) => ({ id: p.id, name: p.name, credential: p.credential }));

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/families/${family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Talent-pipeline analytics</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The whole pipeline for {family.occupation?.title ?? family.name} as one connected system: targets derived
          backward from each cohort&apos;s North-Star goal, actuals pulled live from student records, and every ratio
          computed from the same numbers you see in the tables — turn on the lineage toggle to see exactly where each
          figure is sourced from.
        </p>
      </div>
      <PipelineAnalytics
        institution={family.institution.name}
        familyName={family.name}
        programs={programOpts}
        cohorts={cohortOpts}
        facts={facts}
        rates={rates}
        nowYear={today.getUTCFullYear()}
      />
    </div>
  );
}
