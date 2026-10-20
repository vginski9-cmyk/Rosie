"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { siblingHref } from "@/lib/programnav";

// One strip of tabs for everything about a program, in the order the work happens:
// design it, set up its clinical network, set the goal, run offerings, follow the students.

const TABS: { label: string; seg: string }[] = [
  { label: "Offerings", seg: "" },
  { label: "Design & sequence", seg: "structure" },
  { label: "Clinical sites", seg: "clinical" },
  { label: "Goal & pipeline", seg: "goal" },
  { label: "Students", seg: "students" },
];

export interface SiblingProgram { id: string; name: string; credential: string | null }

export function ProgramTabBar({ programId, siblings = [] }: { programId: string; /** The family's programs (this one included), when it has more than one: a switcher keeps the reader on the same tab. */ siblings?: SiblingProgram[] }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const base = `/programs/${programId}`;
  const isActive = (seg: string) => (seg === "" ? pathname === base : pathname === `${base}/${seg}` || pathname.startsWith(`${base}/${seg}/`));
  const onOffering = pathname.startsWith(`${base}/offerings/`);

  return (
    <div className="-mx-6 mb-6 border-b border-slate-200 bg-white px-6">
      <nav className="flex items-center gap-1 overflow-x-auto">
        {siblings.length > 1 && (
          <label className="mr-2 flex shrink-0 items-center gap-1.5 py-1.5 text-xs text-slate-500">
            <span>Program</span>
            <select value={programId} onChange={(e) => router.push(siblingHref(pathname, programId, e.target.value))} aria-label="Switch to another program of this family" className="max-w-[22rem] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800">
              {siblings.map((p) => <option key={p.id} value={p.id}>{p.name}{p.credential ? ` · ${p.credential}` : ""}</option>)}
            </select>
          </label>
        )}
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
