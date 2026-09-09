"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Insights is one analytics workspace: every analysis page is a tab of it.
const TABS: { label: string; href: string }[] = [
  { label: "Instructors & preceptors needed", href: "/insights/staffing-need" },
  { label: "Daily coverage", href: "/insights/coverage" },
  { label: "Clinical scheduler", href: "/scheduler" },
  { label: "Clinical site capacity", href: "/insights/clinical-sites" },
  { label: "Room utilization", href: "/utilization" },
  { label: "Asset supply", href: "/supply" },
  { label: "Semester", href: "/semester" },
  { label: "Explore", href: "/insights" },
];

export function InsightsTabs() {
  const pathname = usePathname() ?? "";
  return (
    <div className="-mx-6 border-b border-slate-200 bg-white px-6">
      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.href === "/insights" ? pathname === "/insights" : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link key={t.href} href={t.href} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? "border-rose-600 text-rose-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>{t.label}</Link>
          );
        })}
      </nav>
    </div>
  );
}
