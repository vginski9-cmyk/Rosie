"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { label: string; href: string; hint: string }[] = [
  { label: "By program", href: "/clinical", hint: "each program's sites, set up the way that program counts them" },
  { label: "All organizations", href: "/employers", hint: "each college's partner records: agreement, drive time, assets, people" },
  { label: "Site registry", href: "/sites", hint: "every clinical site in the world the platform knows, whichever colleges approach it" },
];

export function ClinicalTabs() {
  const pathname = usePathname() ?? "";
  return (
    <div className="-mx-6 border-b border-slate-200 bg-white px-6">
      <nav className="flex gap-1">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return <Link key={t.href} href={t.href} title={t.hint} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? "border-rose-600 text-rose-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>{t.label}</Link>;
        })}
      </nav>
    </div>
  );
}
