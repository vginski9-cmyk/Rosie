import { redirect } from "next/navigation";

// The standalone course sequencer was merged into the Design & sequence surface
// (the structure editor now handles term/course re-sequencing). Keep the URL
// working for any bookmarks by redirecting there.
export default function SequencerRedirect({ params }: { params: { id: string } }) {
  redirect(`/programs/${params.id}/structure`);
}
