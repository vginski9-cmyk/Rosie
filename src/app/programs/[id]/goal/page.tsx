import { notFound } from "next/navigation";
import { getFamily, getProgramFamilyId } from "@/lib/queries";
import { GoalPlanner } from "@/components/GoalPlanner";
import { prisma } from "@/lib/db";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";

export const dynamic = "force-dynamic";

// GOAL & PIPELINE — the job's multi-year North Star goal, and which offerings deliver it.
// Shared by every program template under the same job.

const monthYear = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null);
const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };
const STATUS_RANK: Record<string, number> = { prospect: 0, applicant: 1, admitted: 2, enrolled: 3, completed: 4, licensed: 5, placed: 6, productive: 7 };

export default async function ProgramGoalPage({ params }: { params: { id: string } }) {
  const familyId = await getProgramFamilyId(params.id);
  const data = familyId ? await getFamily(familyId) : null;
  if (!data) notFound();
  const { family, demand } = data;
  const campuses = await prisma.campus.findMany({ where: { institutionId: family.institutionId }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { id: true, name: true, city: true } });

  const cohortGradYears = family.programs.flatMap((p) => p.cohorts.map((co) => gradYearOf(co.name) || co.entryYear || 0)).filter((y) => y > 0);
  const demandByYear: Record<number, number> = {};
  for (const d of demand) if (d.openings != null) demandByYear[d.year] = d.openings;
  const goalByYear: Record<number, number> = {};
  for (const p of family.programs) for (const t of p.yearTargets) if (t.credentialTarget != null) goalByYear[t.year] = (goalByYear[t.year] ?? 0) + t.credentialTarget;
  const yearSet = new Set<number>([...Object.keys(goalByYear).map(Number), ...Object.keys(demandByYear).map(Number), ...cohortGradYears]);
  const seedYears = [...yearSet].sort((a, b) => a - b);

  const today = new Date();
  const nowYear = today.getUTCFullYear();
  const offeringsByYear: Record<number, import("@/components/GoalPlanner").OfferingSummary[]> = {};
  const actualByYear: Record<number, import("@/components/GoalPlanner").ActualFunnel> = {};
  for (const p of family.programs) {
    const orderedTerms = [...p.terms].sort((a, b) => a.index - b.index);
    const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
    for (const co of p.cohorts) {
      const gy = gradYearOf(co.name) || co.entryYear || 0;
      if (!gy) continue;
      let enrolled = 0, completed = 0, placed = 0;
      const a = (actualByYear[gy] ??= { interested: 0, qualified: 0, offered: 0, enrolled: 0, completing: 0, licensed: 0, placed: 0, productive: 0 });
      // The offering's stage actuals (the same figures its own page shows) are the record; the student rows are a
      // fallback, and a withdrawn student did reach "enrolled" before leaving.
      const actualOf = (k: string) => co.stages.find((s) => s.stageKey === k)?.actualNumber ?? null;
      if (co.stages.some((s) => s.actualNumber != null)) {
        for (const k of ["interested", "qualified", "offered", "enrolled", "completing", "licensed", "placed", "productive"] as const) a[k] += actualOf(k) ?? 0;
        enrolled = actualOf("enrolled") ?? 0; completed = actualOf("completing") ?? 0; placed = actualOf("placed") ?? 0;
      } else {
        for (const st of co.students) {
          const r = st.status === "withdrawn" ? 3 : STATUS_RANK[st.status] ?? -1;
          if (r >= 3) enrolled++; if (r >= 4) completed++; if (r >= 6) placed++;
          if (r >= 0) a.interested++; if (r >= 1) a.qualified++; if (r >= 2) a.offered++; if (r >= 3) a.enrolled++; if (r >= 4) a.completing++; if (r >= 5) a.licensed++; if (r >= 6) a.placed++; if (r >= 7) a.productive++;
        }
      }
      const goalProductive = Math.round(co.stages.find((x) => x.stageKey === "productive")?.targetNumber ?? 0);
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
      const tm = computeCohortTiming(co.startDate, timingTerms, today, orderedTerms.map((t) => ctById.get(t.id) ?? null));
      (offeringsByYear[gy] ??= []).push({
        id: co.id, name: co.name, programId: p.id, program: p.name,
        goalProductive, students: co._count.students, enrolled, completed, placed, status: co.status,
        pipelineRates: co.pipelineRates ?? null, terms: orderedTerms.length, startDate: co.startDate ? co.startDate.toISOString().slice(0, 10) : null,
        location: [co.campus?.name, co.locationNote].filter(Boolean).join(", ") || null,
        phase: tm.phase, currentTerm: tm.currentTermName,
        endLabel: tm.endDate ? `${tm.phase === "graduated" ? "ended" : "ends"} ${monthYear(tm.endDate)}` : null,
      });
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Goal &amp; pipeline <span className="text-sm font-normal text-slate-500">— {family.occupation?.title ?? family.name}: workers a year, and the class that delivers each</span></h2>
      <GoalPlanner
        familyId={family.id} familyName={family.name} seedYears={seedYears} seedGoalsByYear={goalByYear}
        savedPlan={family.goalPlan ?? null} offeringsByYear={offeringsByYear} actualByYear={actualByYear} nowYear={nowYear}
        models={family.programs.map((p) => ({
          programId: p.id, name: p.name, credential: p.credential, terms: p.terms.length,
          spanWeeks: p.terms.reduce((n, t) => n + ((t.endWeek ?? 16) - (t.startWeek ?? 1) + 1), 0),
          maxCapacity: p.defaultCohortSeats ?? p.yearTargets.reduce<number | null>((m, t) => (t.cohortCapacity != null && (m == null || t.cohortCapacity > m) ? t.cohortCapacity : m), null),
          running: p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length,
          sessionMax: (() => { const mx: Partial<Record<"CLASS" | "LAB" | "CLINICAL", number>> = {}; for (const t of p.terms) for (const c of t.courses) for (const x of c.sessions) { const k = x.kind as "CLASS" | "LAB" | "CLINICAL"; if (x.maxStudents > 0) mx[k] = Math.min(mx[k] ?? Infinity, x.maxStudents); } return mx; })(),
        }))}
        campuses={campuses.map((c) => ({ id: c.id, name: c.name, city: c.city }))}
      />
    </div>
  );
}
