import { redirect } from "next/navigation";

// Curriculum flow merged into Design & sequence — one design surface.
export default function LegacyFlow({ params }: { params: { id: string } }) {
  redirect(`/programs/${params.id}/structure`);
}
