"use client";

// The password gate for the STATIC (GitHub Pages) build. That build is a
// crawled snapshot with no server, so nothing can check a cookie before a page
// is served — the gate runs in the browser instead: a full-screen door that
// stays up until the password's digest matches the one baked in at build time,
// then remembers it in this browser. It keeps casual visitors out; it is not a
// server-side guarantee (the page markup is still in the download).

import { useEffect, useState } from "react";

const MODE = process.env.NEXT_PUBLIC_GATE_MODE ?? "server";
const DIGEST = process.env.NEXT_PUBLIC_GATE_DIGEST ?? "";
const KEY = "rosie-gate";

async function digest(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}|rosie-gate-v1`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function DemoGate() {
  // Client mode starts CLOSED (the door is up in the very first paint, so nothing
  // shows through) and opens once this browser's remembered digest matches.
  const [open, setOpen] = useState<boolean>(MODE !== "client");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (MODE !== "client") return;
    try { if (DIGEST && localStorage.getItem(KEY) === DIGEST) setOpen(true); } catch { /* stays closed */ }
  }, []);
  if (open) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = await digest(pw);
    if (d === DIGEST) { try { localStorage.setItem(KEY, d); } catch { /* keep going */ } setOpen(true); }
    else { setErr(true); setPw(""); }
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-600 text-sm font-bold text-white">R</span>
            <span className="text-lg font-semibold text-slate-900">Rosie</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">Enter the password to open the site.</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Password</span>
          <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }} autoFocus required autoComplete="current-password" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none" />
        </label>
        {err && <p className="text-sm font-medium text-rose-700">That password isn&apos;t right — try again.</p>}
        <button className="w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Open Rosie</button>
      </form>
    </div>
  );
}
