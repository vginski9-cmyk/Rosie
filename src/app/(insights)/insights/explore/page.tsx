import Link from "next/link";
import { getInsightsFacts } from "@/lib/queries";
import { PivotExplorer } from "@/components/PivotExplorer";

export const dynamic = "force-dynamic";

// The generic pivot — a diagnostic, kept off the main experience (Phase 13). Reached from Setup.
export default async function ExplorePage() {
  const facts = await getInsightsFacts();
  const institutions = new Set(facts.map((f) => f.institution)).size;
  const programs = new Set(facts.map((f) => f.program)).size;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup" className="text-sm text-slate-500 hover:text-slate-700">← Setup</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Explore (diagnostic pivot)</h1>
        <p className="text-sm text-slate-500">Pipeline and delivery metrics across {institutions} institution{institutions === 1 ? "" : "s"} and {programs} programs with offerings — pick two dimensions, switch the measure, click to drill. A diagnostic for checking the data, not a place to decide from; the answers live under <Link href="/scenarios" className="text-rose-700 hover:underline">Scenarios</Link> and <Link href="/capacity" className="text-rose-700 hover:underline">Capacity</Link>.</p>
      </div>
      <PivotExplorer facts={facts} />
    </div>
  );
}
