import Link from "next/link";
import { getInsightsFacts } from "@/lib/queries";
import { PivotExplorer } from "@/components/PivotExplorer";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const facts = await getInsightsFacts();
  const institutions = new Set(facts.map((f) => f.institution)).size;
  const programs = new Set(facts.map((f) => f.program)).size;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← Portfolio</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Insights explorer</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          One tidy fact table across <strong>{institutions} institutions</strong> and <strong>{programs} programs</strong> —
          both the <strong>talent-pipeline</strong> metrics (interested → productive, target vs actual) and the
          <strong> delivery footprint</strong> (faculty &amp; preceptor FTE / contact hours, space hours, sections). Pick any
          two dimensions to aggregate or disaggregate by — institution, family/job, program, cohort, metric, year, term,
          semester — switch the measure, and click headers or cells to filter and drill.
        </p>
      </div>

      <PivotExplorer facts={facts} />
    </div>
  );
}
