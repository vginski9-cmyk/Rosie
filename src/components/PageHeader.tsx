import Link from "next/link";
import type { ReactNode } from "react";

// One header for every page (Phase 13): a crumb back to where you came from, the title, one
// sentence on what the page answers, and the page's actions on the right. Long explanations do
// not belong here — they go behind a "How to read this" on the page itself.
export function PageHeader({ title, lede, crumb, actions, meta }: {
  title: ReactNode;
  /** One sentence: what this page answers. */
  lede?: ReactNode;
  /** Where this page hangs from, e.g. { href: "/setup", label: "Setup" }. */
  crumb?: { href: string; label: string };
  /** Buttons and links for the page's actions. */
  actions?: ReactNode;
  /** A short line of facts under the lede (counts, the window, the college). */
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-200 pb-4">
      <div className="min-w-0">
        {crumb && <Link href={crumb.href} className="text-xs text-slate-500 hover:text-slate-800">← {crumb.label}</Link>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {lede && <p className="mt-1 max-w-3xl text-sm text-slate-600">{lede}</p>}
        {meta && <p className="mt-1 text-xs text-slate-500">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
