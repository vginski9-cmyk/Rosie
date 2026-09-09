import { notFound, redirect } from "next/navigation";
import { getFamilyProgramId } from "@/lib/queries";

// A job's pages live under its program now. Keep old links working.
export default async function LegacyFamilyPage({ params }: { params: { id: string } }) {
  const programId = await getFamilyProgramId(params.id);
  if (!programId) notFound();
  redirect(`/programs/${programId}/goal`);
}
