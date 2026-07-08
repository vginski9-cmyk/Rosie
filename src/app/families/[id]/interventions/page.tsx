import { redirect } from "next/navigation";

export default function LegacyFamilyInterventions({ params }: { params: { id: string } }) {
  redirect(`/families/${params.id}/design`);
}
