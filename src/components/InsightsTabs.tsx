"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Insights is one analytics workspace with two lenses: Explore (the pivot across
// every institution/program) and Semester (every offering running in one term).
// A shared sub-nav so they read as facets of one place, not separate destinations.
const TABS: { label: string; href: string }[] = [
  { label: "Explore", href: "/insights" },
  { label: "Semester", href: "/semester" },
];

export function InsightsTabs() {
  const pathname = usePathname() ?? "";
  return (
    <div className="-mx-6 border-b border-slate-200 bg-white px-6">
      <nav className="flex gap-1">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "border-rose-600 text-rose-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
