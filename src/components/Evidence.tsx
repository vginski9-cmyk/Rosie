import Link from "next/link";
import { coverageHeadline, HEADLINE_TONE, EVIDENCE_LABEL, EVIDENCE_TONE, provisionalVerdict, type CoverageScore, type EvidenceStatus, type CalendarProvenance } from "@/lib/evidence";

// Evidence-status UI (Phase 3): the one coverage headline computed from the weakest required input, the
// "based on unverified standard" marker every derived output carries, an evidence chip, and the
// provisional-dates banner schedule-dependent screens show. Server-safe (no hooks).

/** "Potential coverage identified for 42/42. Confirmed: 0/42." — green only when every required
 *  experience is confirmed with a site; amber while any rests on inference; rose while any has no provider. */
export function CoverageHeadline({ score, href, unverifiedStandard = false, className = "" }: { score: CoverageScore; href?: string; unverifiedStandard?: boolean; className?: string }) {
  const h = coverageHeadline(score);
  const cls = `inline-flex flex-wrap items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${HEADLINE_TONE[h.tone]} ${className}`;
  const body = <>{h.text}{unverifiedStandard && <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-300">based on unverified standard</span>}</>;
  return href ? <Link href={href} className={cls}>{body}</Link> : <span className={cls}>{body}</span>;
}

/** The marker every output derived from a requirement set carries until the program verifies the list. */
export function UnverifiedStandard({ verified, size = "sm", what = "standard" }: { verified: boolean; size?: "xs" | "sm"; what?: string }) {
  if (verified) return null;
  return <span className={`inline-block rounded-full bg-amber-100 font-medium text-amber-800 ring-1 ring-amber-200 ${size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`} title="the requirement list is starter content from the public standard; nobody has verified it against the current edition, so every figure derived from it is provisional">based on unverified {what}</span>;
}

export function EvidenceChip({ status, label }: { status: EvidenceStatus; label?: string }) {
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${EVIDENCE_TONE[status]}`} title={EVIDENCE_LABEL[status]}>{label ?? EVIDENCE_LABEL[status]}</span>;
}

/** Shown on every schedule-dependent screen while dates are provisional. Quiet when the calendar is imported
 *  and every term date comes from it. */
export function ProvisionalDatesBanner({ provenance, names = [], compact = false }: { provenance: CalendarProvenance; names?: string[]; compact?: boolean }) {
  const v = provisionalVerdict(provenance);
  if (v.level === "ok") return null;
  const tone = v.level === "provisional" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`rounded-lg border px-3 ${compact ? "py-1 text-[11px]" : "py-2 text-xs"} ${tone}`} role="note">
      <span className="font-semibold">{v.level === "provisional" ? "Provisional dates." : "Dates set by hand."}</span> {v.text}{names.length ? ` (${names.join(", ")})` : ""}{v.level === "provisional" ? <> Paste the college calendar under <Link href="/setup" className="underline">Setup</Link> to code the real dates.</> : null}
    </div>
  );
}
