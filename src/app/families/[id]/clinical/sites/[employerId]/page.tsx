import { notFound, redirect } from "next/navigation";
import { getFamilyProgramId } from "@/lib/queries";

export default async function LegacyFamilySitePage({ params }: { params: { id: string; employerId: string } }) {
  const programId = await getFamilyProgramId(params.id);
  if (!programId) notFound();
  redirect(`/programs/${programId}/clinical/sites/${params.employerId}`);
}
