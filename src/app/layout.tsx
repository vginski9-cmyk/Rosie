import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rosie — Program Planning & Capacity",
  description: "Workforce-aligned education program planning, capacity modeling, and stakeholder coordination.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-sm font-bold text-white">R</span>
                <span className="text-lg font-semibold tracking-tight">Rosie</span>
                <span className="hidden text-sm text-slate-400 sm:inline">· program planning &amp; capacity</span>
              </Link>
              <nav className="flex items-center gap-1 text-sm">
                <Link href="/" className="btn-ghost">Dashboard</Link>
                <Link href="/insights" className="btn-ghost">Insights</Link>
                <Link href="/students" className="btn-ghost">Students</Link>
                <Link href="/skills" className="btn-ghost">Skill library</Link>
                <Link href="/wbl" className="btn-ghost">WBL alignment</Link>
                <Link href="/programs/new" className="btn-primary">+ New program</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
          <footer className="mx-auto max-w-7xl px-6 py-8 text-xs text-slate-400">
            Rosie v0.2 — authored in-app: demand · program structure · talent funnel · capacity · KSA proficiency · WBL alignment.
          </footer>
        </div>
      </body>
    </html>
  );
}
