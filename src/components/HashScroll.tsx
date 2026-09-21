"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// A page that streams in behind a loading skeleton misses the browser's own jump to "#section": the
// anchor is not in the document when the browser looks. Once the real page has mounted, this scrolls to it.
export function HashScroll() {
  const pathname = usePathname();
  useEffect(() => {
    const go = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start" });
    };
    go();
    const t = setTimeout(go, 250);
    window.addEventListener("hashchange", go);
    return () => { clearTimeout(t); window.removeEventListener("hashchange", go); };
  }, [pathname]);
  return null;
}
