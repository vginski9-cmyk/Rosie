import Link from "next/link";
import { getInsightsFacts } from "@/lib/queries";
import { PivotExplorer } from "@/components/PivotExplorer";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// The generic pivot — a diagnostic, kept off the main experience (Phase 13). Reached from Setup.
export default async function ExplorePage() {
  const facts = await getInsightsFacts();
  const institutions = new Set(facts.map((f) => f.institution)).size;
  const programs = new Set(facts.map((f) => f.program)).size;

  return (
    <div className="space-y-6">
      <div>
        <PageHeader crumb={{ href: "/setup", label: "Setup" }} title="Explore (diagnostic pivot)" />
        <p className="text-sm text-slate-500">Pipeline and delivery metrics across {institutions} institution{institutions === 1 ? "" : "s"} and {programs} programs with offerings — pick two dimensions, switch the measure, click to drill. A diagnostic for checking the data, not a place to decide from; the answers live under <Link href="/scenarios" className="text-rose-700 hover:underline">Scenarios</Link> and <Link href="/capacity" className="text-rose-700 hover:underline">Capacity</Link>.</p>
      </div>
      <PivotExplorer facts={facts} />
    </div>
  );
}
