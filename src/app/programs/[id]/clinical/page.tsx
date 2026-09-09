import { notFound } from "next/navigation";
import { getProgramFamilyId } from "@/lib/queries";
import { FamilyClinicalHub } from "@/components/FamilyClinicalHub";

export const dynamic = "force-dynamic";

// CLINICAL SITES & REQUIREMENTS — this program's clinical network, set up once for the job.
export default async function ProgramClinicalPage({ params }: { params: { id: string } }) {
  const familyId = await getProgramFamilyId(params.id);
  if (!familyId) notFound();
  return <FamilyClinicalHub familyId={familyId} base={`/programs/${params.id}/clinical`} />;
}
