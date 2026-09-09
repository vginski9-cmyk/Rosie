"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One flat bar. Each item is a place, and each place has its own tabs — no menus to hunt through.
//   Home (the setup and where things stand) · Programs · Clinical sites · Students · People · Calendar · Insights · Setup
const ITEMS: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: "Home", href: "/", match: (p) => p === "/" || p === "/goals" },
  { label: "Programs", href: "/programs", match: (p) => p.startsWith("/programs") || p.startsWith("/courses") || (p.startsWith("/families/") && !p.includes("/clinical")) },
  { label: "Clinical sites", href: "/clinical", match: (p) => p.startsWith("/clinical") || p.startsWith("/employers") || p.includes("/clinical") },
  { label: "Students", href: "/students", match: (p) => p.startsWith("/students") },
  { label: "People", href: "/people", match: (p) => p.startsWith("/people") },
  { label: "Calendar", href: "/calendar", match: (p) => p.startsWith("/calendar") },
  { label: "Insights", href: "/insights/staffing-need", match: (p) => p.startsWith("/insights") || p.startsWith("/scheduler") || p.startsWith("/supply") || p.startsWith("/utilization") || p.startsWith("/semester") },
  { label: "Setup", href: "/setup", match: (p) => p.startsWith("/setup") || p.startsWith("/orgs") || p.startsWith("/facilities") },
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
