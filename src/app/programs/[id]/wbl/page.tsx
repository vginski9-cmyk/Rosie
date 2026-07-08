import { redirect } from "next/navigation";

// Program-level WBL board retired: WBL operations live on each offering, where
// the real learner + employer data is.
export default function LegacyProgramWbl({ params }: { params: { id: string } }) {
  redirect(`/programs/${params.id}`);
}
