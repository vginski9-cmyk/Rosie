"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Insights is one analytics workspace: every analysis page is a tab of it, and
// every tab reads the same college — the one picked here, carried in ?inst=.
const TABS: { label: string; href: string }[] = [
  { label: "Instructors & preceptors needed", href: "/insights/staffing-need" },
  { label: "Daily coverage", href: "/insights/coverage" },
  { label: "Clinical scheduler", href: "/scheduler" },
  { label: "Clinical site load", href: "/insights/site-load" },
  { label: "Clinical site capacity", href: "/insights/clinical-sites" },
  { label: "Room utilization", href: "/utilization" },
  { label: "Asset supply", href: "/supply" },
  { label: "Semester", href: "/semester" },
  { label: "Explore", href: "/insights" },
];

export function InsightsTabs({ institutions, defaultInstitutionId }: { institutions: { id: string; name: string }[]; defaultInstitutionId: string | null }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const params = useSearchParams();
  const inst = params?.get("inst") || defaultInstitutionId || "";
  const withInst = (href: string) => (inst && inst !== defaultInstitutionId ? `${href}?inst=${inst}` : href);
  return (
    <div className="-mx-6 flex items-center gap-4 border-b border-slate-200 bg-white px-6">
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.href === "/insights" ? pathname === "/insights" : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link key={t.href} href={withInst(t.href)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? "border-rose-600 text-rose-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>{t.label}</Link>
          );
        })}
      </nav>
      {institutions.length > 1 && (
        <label className="flex shrink-0 items-center gap-2 py-1.5 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wide text-slate-400">College</span>
          <select value={inst} onChange={(e) => router.push(`${pathname}?inst=${e.target.value}`)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
