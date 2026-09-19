"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One strip of tabs for everything about a program, in the order the work happens:
// design it, set up its clinical network, set the goal, run offerings, follow the students.

const TABS: { label: string; seg: string }[] = [
  { label: "Overview & offerings", seg: "" },
  { label: "Design & sequence", seg: "structure" },
  { label: "Clinical sites & requirements", seg: "clinical" },
  { label: "Goal & pipeline", seg: "goal" },
  { label: "Students", seg: "students" },
];

export function ProgramTabBar({ programId }: { programId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/programs/${programId}`;
  const isActive = (seg: string) => (seg === "" ? pathname === base : pathname === `${base}/${seg}` || pathname.startsWith(`${base}/${seg}/`));
  const onOffering = pathname.startsWith(`${base}/offerings/`);

  return (
    <div className="-mx-6 mb-6 border-b border-slate-200 bg-white px-6">
      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = !onOffering && isActive(t.seg);
          return (
            <Link key={t.seg || "overview"} href={t.seg ? `${base}/${t.seg}` : base} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? "border-rose-600 text-rose-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>
              {t.label}
            </Link>
          );
        })}
        {onOffering && <span className="whitespace-nowrap border-b-2 border-rose-600 px-3 py-2.5 text-sm font-medium text-rose-700">Offering</span>}
      </nav>
    </div>
  );
}
