import { ClinicalTabs } from "@/components/ClinicalTabs";

// Clinical sites: by program (the setup that matters) first; the cross-program organization list second.
export default function ClinicalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ClinicalTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
