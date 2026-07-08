import { redirect } from "next/navigation";

// The template-level schedule (legacy engine, browser-only staffing) is retired:
// real scheduling lives on each offering's bookings panel and the master calendar.
export default function LegacyProgramSchedule() {
  redirect("/calendar");
}
