"use client";

// Progressive disclosure (Phase 8): a form or panel that exists only once the reader asks for it.
// A server component can hand it the children; nothing is in the page's DOM until the button is
// pressed, so a list of 80 items carries 80 buttons, not 400 form controls. The button's accessible
// name says what it opens ("Edit Chest — PA and lateral"), never a bare "edit".

import { useState, type ReactNode } from "react";

export function Reveal({ label, name, className = "", buttonClassName = "text-[10px] text-slate-500 hover:text-rose-700", children }: {
  /** The verb ("edit", "edition, source and verification"). */
  label: string;
  /** What it applies to — becomes part of the accessible name. */
  name: string;
  className?: string;
  buttonClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? "Close" : label} — ${name}`} className={buttonClassName}>{open ? "close" : label} {open ? "▴" : "▸"}</button>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  );
}
