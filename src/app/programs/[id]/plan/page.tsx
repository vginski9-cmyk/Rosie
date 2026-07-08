import { redirect } from "next/navigation";

// Program-level operations plan retired: operations live on each offering.
export default function LegacyProgramPlan({ params }: { params: { id: string } }) {
  redirect(`/programs/${params.id}`);
}
