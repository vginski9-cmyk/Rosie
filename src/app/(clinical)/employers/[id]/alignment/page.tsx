import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlignmentSubject } from "@/lib/queries";
import { AlignmentIntake } from "@/components/AlignmentIntake";

export const dynamic = "force-dynamic";

export default async function EmployerAlignmentPage({ params }: { params: { id: string } }) {
  const data = await getAlignmentSubject("employer", params.id);
  if (!data || data.kind !== "employer") notFound();
  const e = data.subject as { id: string; name: string; setting: string | null; status: string; institution: { id: string; name: string } };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/employers/${e.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {e.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Partner alignment intake — {e.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          What is this partner actually trying to accomplish by hosting learners — underneath what gets said? Tag the
          operating motivations (tiered), the hosting constraints, and the real capacities. The computed panel shows the
          quadrant, which WBL modes this partner can genuinely host, and configuration honesty notes.
          {" "}{[e.setting, e.institution.name].filter(Boolean).join(" · ")}
        </p>
      </div>
      <AlignmentIntake side="EMPLOYER" employerId={e.id} subjectName={e.name} existing={data.profiles as never} />
    </div>
  );
}
