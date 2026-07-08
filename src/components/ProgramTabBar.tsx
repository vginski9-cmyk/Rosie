"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One consistent navigation strip for every program page, so a program reads as
// a single workspace with clear facets instead of a scatter of sibling routes.
// Grouped by intent: Design (the template) → Operate (a live cohort) → Analyze.

const TABS: { label: string; seg: string; group: string }[] = [
  { label: "Overview", seg: "", group: "" },
  { label: "Design & sequence", seg: "structure", group: "Design" },
  { label: "Curriculum flow", seg: "flow", group: "Design" },
  { label: "Students", seg: "students", group: "Operate" },
  { label: "WBL", seg: "wbl", group: "Operate" },
  { label: "Operations plan", seg: "plan", group: "Analyze" },
];

export function ProgramTabBar({ programId }: { programId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/programs/${programId}`;

  const isActive = (seg: string) => {
    if (seg === "") return pathname === base;
    return pathname === `${base}/${seg}` || pathname.startsWith(`${base}/${seg}/`);
  };
  // Offering (cohort) pages live under the program but aren't a template facet.
  const onOffering = pathname.startsWith(`${base}/offerings/`);

  return (
    <div className="-mx-6 mb-6 border-b border-slate-200 bg-white px-6">
      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = !onOffering && isActive(t.seg);
          return (
            <Link
              key={t.seg || "overview"}
              href={t.seg ? `${base}/${t.seg}` : base}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "border-rose-600 text-rose-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        {onOffering && (
          <span className="whitespace-nowrap border-b-2 border-rose-600 px-3 py-2.5 text-sm font-medium text-rose-700">
            Offering
          </span>
        )}
      </nav>
    </div>
  );
}
