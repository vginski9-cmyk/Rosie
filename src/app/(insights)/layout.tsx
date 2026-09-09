import { InsightsTabs } from "@/components/InsightsTabs";

// Every analysis page shares one strip of tabs, so Insights reads as one workspace.
export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <InsightsTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
