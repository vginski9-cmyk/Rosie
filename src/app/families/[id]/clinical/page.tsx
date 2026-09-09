import { notFound, redirect } from "next/navigation";
import { getFamilyProgramId } from "@/lib/queries";

export default async function LegacyFamilyClinicalPage({ params }: { params: { id: string } }) {
  const programId = await getFamilyProgramId(params.id);
  if (!programId) notFound();
  redirect(`/programs/${programId}/clinical`);
}
