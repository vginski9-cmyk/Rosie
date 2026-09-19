import Link from "next/link";
import { getExceptionQueue } from "@/lib/exceptions";
import { ExceptionQueue } from "@/components/ExceptionQueue";

export const dynamic = "force-dynamic";

// SETUP → EXCEPTIONS (Phase 13). The operational blocker queue — what is wrong in the imported
// records and the operating plan, worst first, each linking to where it gets fixed. It used to lead
// the Home page; executives read root constraints there now, and the queue lives with the setup work.
export default async function ExceptionsPage() {
  const items = await getExceptionQueue();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup" className="text-sm text-slate-500 hover:text-slate-700">← Setup</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Exceptions</h1>
        <p className="text-sm text-slate-600">Operational problems in the records the answers rest on: over-capacity days, unsecured placements, holiday sessions, unprecepted shifts, calendar conflicts, coverage gaps, unverified inputs. Fixing them is data work at the source system or on the linked screen; it changes the evidence, not the strategy.</p>
      </div>
      <ExceptionQueue items={items} />
    </div>
  );
}
