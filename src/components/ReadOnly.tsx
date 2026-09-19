import type { ReactNode } from "react";
import { OPERATIONAL } from "@/lib/mode";

// Phase 13: in the strategic product an operational panel is shown but cannot be written. A
// disabled fieldset disables every form control inside it — buttons, selects, inputs — in every
// nested form, so the panel reads as the record it is, and the server refuses the action anyway
// (requireOperational in lib/actions).
export function ReadOnly({ children, what = "This record" }: { children: ReactNode; what?: string }) {
  if (OPERATIONAL) return <>{children}</>;
  return (
    <div>
      <p className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600"><strong>Read-only.</strong> {what} is an imported actual, shown as evidence; changes are made in the source system or the operational module.</p>
      <fieldset disabled className="contents [&_button]:cursor-not-allowed [&_button]:opacity-50 [&_input]:bg-slate-50 [&_select]:bg-slate-50">{children}</fieldset>
    </div>
  );
}
