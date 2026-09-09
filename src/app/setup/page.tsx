import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrganizations } from "@/lib/queries";

export const dynamic = "force-dynamic";

// SETUP — the institution's own page. With one institution, go straight to it.
export default async function SetupPage() {
  const orgs = await getOrganizations();
  if (orgs.length === 1) redirect(`/orgs/${orgs[0].id}`);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {orgs.map((o) => (
          <Link key={o.id} href={`/orgs/${o.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-rose-300 hover:bg-rose-50/30">
            <div className="text-base font-semibold text-slate-900">{o.name}</div>
            <div className="text-xs text-slate-500">{[o.kind, [o.city, o.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "no basics yet"} · {o.counts.programs} programs · {o.counts.employers} sites · {o.counts.people} people</div>
          </Link>
        ))}
        {orgs.length === 0 && <p className="text-sm text-slate-400">No institution yet — add a North Star goal on the <Link href="/goals" className="text-rose-600 hover:underline">goals page</Link> to create one.</p>}
      </div>
    </div>
  );
}
