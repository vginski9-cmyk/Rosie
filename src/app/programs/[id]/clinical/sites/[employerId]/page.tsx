import { notFound } from "next/navigation";
import { getProgramFamilyId } from "@/lib/queries";
import { FamilySiteSetup } from "@/components/FamilySiteSetup";

export const dynamic = "force-dynamic";

// ONE SITE, SET UP FOR THIS PROGRAM.
export default async function ProgramSitePage({ params }: { params: { id: string; employerId: string } }) {
  const familyId = await getProgramFamilyId(params.id);
  if (!familyId) notFound();
  return <FamilySiteSetup familyId={familyId} employerId={params.employerId} base={`/programs/${params.id}/clinical`} />;
}
