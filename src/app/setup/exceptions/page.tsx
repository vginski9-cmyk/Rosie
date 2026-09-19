import Link from "next/link";
import { getExceptionQueue } from "@/lib/exceptions";
import { ExceptionQueue } from "@/components/ExceptionQueue";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// SETUP → EXCEPTIONS (Phase 13). The operational blocker queue — what is wrong in the imported
// records and the operating plan, worst first, each linking to where it gets fixed. It used to lead
// the Home page; executives read root constraints there now, and the queue lives with the setup work.
export default async function ExceptionsPage() {
  const items = await getExceptionQueue();
  return (
    <div className="space-y-4">
      <PageHeader crumb={{ href: "/setup", label: "Setup" }} title="Exceptions" lede="What the records raise: over-capacity days, unsecured placements, holiday collisions, unprecepted shifts, calendar conflicts, coverage gaps, unverified inputs. Fixing them is data work, not strategy." />
      <ExceptionQueue items={items} />
    </div>
  );
}
