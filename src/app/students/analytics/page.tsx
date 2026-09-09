import Link from "next/link";
import { getLearnerAnalytics } from "@/lib/queries";
import { LearnerAnalytics } from "@/components/LearnerAnalytics";

export const dynamic = "force-dynamic";

export default async function LearnerAnalyticsPage() {
  const learners = await getLearnerAnalytics();
  const today = new Date().toISOString().slice(0, 10);
  const coded = learners.filter((l) => l.sex || l.raceEthnicity || l.dob).length;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/students" className="text-sm text-slate-500 hover:text-slate-700">← Students</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Learner analytics</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Aggregate and disaggregate every learner by coded demographics and outcomes: who enrolls, who completes, who withdraws and why,
          average age — by sex, race / ethnicity, age band, county, residency, prior education, employment, first-generation, veteran,
          Pell, disability, program, cohort, entry year. {learners.length} learners · {coded} with demographic data.
        </p>
      </div>
      <LearnerAnalytics learners={learners} today={today} />
    </div>
  );
}
