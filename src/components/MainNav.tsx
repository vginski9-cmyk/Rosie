"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Grouped top navigation with dropdown menus, so a now-rich platform reads cleanly:
// North Star · Insights ▾ · Directory ▾ · Library ▾.

type Item = { label: string; href: string };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  { label: "Insights", items: [{ label: "Explore", href: "/insights" }, { label: "Semester", href: "/semester" }] },
  { label: "Directory", items: [
    { label: "Students", href: "/students" },
    { label: "People (faculty & staff)", href: "/people" },
    { label: "Employers & clinical sites", href: "/employers" },
    { label: "Facilities", href: "/facilities" },
  ] },
  { label: "Library", items: [{ label: "Skill library", href: "/skills" }, { label: "WBL alignment", href: "/wbl" }] },
];

export function MainNav() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  useEffect(() => { setOpen(null); }, [pathname]);

  const homeActive = pathname === "/";
  const groupActive = (g: Group) => g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + "/"));

  return (
    <nav ref={ref} className="flex items-center gap-1 text-sm">
      <Link href="/" className={`rounded-lg px-3 py-1.5 font-medium ${homeActive ? "bg-rose-50 text-rose-700" : "text-slate-600 hover:bg-slate-100"}`}>North Star</Link>
      {GROUPS.map((g) => {
        const isOpen = open === g.label;
        const active = groupActive(g);
        return (
          <div key={g.label} className="relative">
            <button
              onClick={() => setOpen(isOpen ? null : g.label)}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium ${active ? "bg-rose-50 text-rose-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {g.label}<span className={`text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {isOpen && (
              <div className="absolute right-0 z-50 mt-1 min-w-[15rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {g.items.map((it) => {
                  const itActive = pathname === it.href || pathname.startsWith(it.href + "/");
                  return (
                    <Link key={it.href} href={it.href} className={`block px-4 py-2 text-sm ${itActive ? "bg-rose-50 font-medium text-rose-700" : "text-slate-600 hover:bg-slate-50"}`}>{it.label}</Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
