import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ASSUMPTION_DEFS, resolveAssumptions, scopeOf, type AssumptionRow } from "@/lib/assumptions";
import { AssumptionRegistry } from "@/components/AssumptionRegistry";

export const dynamic = "force-dynamic";

// THE ASSUMPTION REGISTRY for one college (Phase 9): every planning assumption with its value, range,
// source, owner, status and review date — and where each came from (default, workspace, this college,
// a job family, a program). Edit at the college scope here; family and program scopes from the studio.
export default async function AssumptionsPage({ params, searchParams }: { params: { id: string }; searchParams: { scope?: string } }) {
  const inst = await prisma.institution.findUnique({ where: { id: params.id }, select: { id: true, name: true, programFamilies: { select: { id: true, name: true, programs: { select: { id: true, name: true } } } } } });
  if (!inst) notFound();
  const todayIso = new Date().toISOString().slice(0, 10);
  const scope = searchParams.scope && searchParams.scope !== "inst" ? searchParams.scope : scopeOf.institution(inst.id);
  const familyId = scope.startsWith("family:") ? scope.slice(7) : scope.startsWith("program:") ? inst.programFamilies.find((f) => f.programs.some((p) => p.id === scope.slice(8)))?.id ?? null : null;
  const programId = scope.startsWith("program:") ? scope.slice(8) : null;
  const rows: AssumptionRow[] = (await prisma.assumption.findMany()).map((r) => ({ scope: r.scope, key: r.key, value: r.value, low: r.low, high: r.high, source: r.source, owner: r.owner, status: r.status, verifiedAt: r.verifiedAt?.toISOString().slice(0, 10) ?? null, reviewBy: r.reviewBy?.toISOString().slice(0, 10) ?? null }));
  const resolved = resolveAssumptions(rows, { institutionId: inst.id, familyId, programId }, {}, todayIso);
  const own = new Map(rows.filter((r) => r.scope === scope).map((r) => [r.key, r]));
  const scopes = [{ value: scopeOf.institution(inst.id), label: `${inst.name} (college)` }, ...inst.programFamilies.flatMap((f) => [{ value: scopeOf.family(f.id), label: `${f.name} (job family)` }, ...f.programs.map((p) => ({ value: scopeOf.program(p.id), label: `${p.name} (program)` }))])];
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/orgs/${inst.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {inst.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Planning assumptions</h1>
        <p className="text-sm text-slate-600">The rates, lags, lead times, costs and workload figures every expansion analysis rests on. A default is never presented as verified; set the college&apos;s own figure, name who owns it and when to review it. The most specific scope wins: program over job family over college over workspace.</p>
      </div>
      <AssumptionRegistry defs={ASSUMPTION_DEFS} resolved={Object.values(resolved)} own={Object.fromEntries(own)} scope={scope} scopes={scopes} back={`/orgs/${inst.id}/assumptions?scope=${encodeURIComponent(scope)}`} />
    </div>
  );
}
