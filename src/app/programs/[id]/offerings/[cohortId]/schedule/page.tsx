import { redirect } from "next/navigation";

// The legacy section scheduler is retired — sections are real bookings edited on
// the offering page (and the master calendar).
export default function LegacyOfferingScheduler({ params }: { params: { id: string; cohortId: string } }) {
  redirect(`/programs/${params.id}/offerings/${params.cohortId}`);
}
