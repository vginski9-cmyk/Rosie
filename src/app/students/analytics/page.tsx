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
        <p className="text-sm text-slate-500">Who enrolls, completes and withdraws, by any coded demographic. {learners.length} learners · {coded} with demographic data.</p>
      </div>
      <LearnerAnalytics learners={learners} today={today} />
    </div>
  );
}
