import { redirect } from "next/navigation";

// The scenario planner is switched off (set ROSIE_SCENARIOS=1 to bring it back); Programs is the way in.
export default function ScenariosPage() {
  redirect("/programs");
}
