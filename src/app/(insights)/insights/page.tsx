import { redirect } from "next/navigation";

// Insights became Capacity (Phase 13). The generic pivot moved to /insights/explore, reachable from
// Setup → diagnostics, not from the main experience.
export default function InsightsPage({ searchParams }: { searchParams: { inst?: string } }) {
  redirect(searchParams.inst ? `/capacity?inst=${searchParams.inst}` : "/capacity");
}
