"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The primary places are the product: workforce goals (Home), the programs that deliver them, the
// capacity that constrains them, and Setup (connections, mappings,
// assumptions, evidence review, exceptions). Operational records — students, people, the calendar,
// clinical sites, the scheduler — are drill-downs reached from those places, not destinations.
const ITEMS: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: "Home", href: "/", match: (p) => p === "/" || p === "/goals" },
  { label: "Programs", href: "/programs", match: (p) => p.startsWith("/programs") || p.startsWith("/courses") || p.startsWith("/families/") || p.startsWith("/students") || p.startsWith("/scenarios") },
  { label: "Capacity", href: "/capacity", match: (p) => p.startsWith("/capacity") || p.startsWith("/insights") || p.startsWith("/scheduler") || p.startsWith("/supply") || p.startsWith("/utilization") || p.startsWith("/semester") || p.startsWith("/clinical") || p.startsWith("/employers") || p.startsWith("/people") || p.startsWith("/calendar") },
  { label: "Setup", href: "/setup", match: (p) => p.startsWith("/setup") || p.startsWith("/orgs") },
  { label: "Glossary", href: "/glossary", match: (p) => p.startsWith("/glossary") },
];

export function MainNav() {
  const pathname = usePathname() ?? "";
  if (pathname === "/login") return null; // the door has no menu
  return (
    <nav className="flex items-center gap-0.5 text-sm">
      {ITEMS.map((it) => {
        const active = it.match(pathname);
        return <Link key={it.href} href={it.href} className={`rounded-lg px-2.5 py-1.5 font-medium ${active ? "bg-rose-50 text-rose-700" : "text-slate-600 hover:bg-slate-100"}`}>{it.label}</Link>;
      })}
    </nav>
  );
}
