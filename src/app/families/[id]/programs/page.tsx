import { redirect } from "next/navigation";

export default function LegacyFamilyPrograms({ params }: { params: { id: string } }) {
  redirect(`/families/${params.id}/design`);
}
