import { ProgramTabBar } from "@/components/ProgramTabBar";

// Shared chrome for every program page: one tab bar so the program reads as a
// single workspace (overview · design · schedule · students · WBL · operations)
// instead of a scatter of sibling routes. Pages keep their own content/headers.
export default function ProgramLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  return (
    <div>
      <ProgramTabBar programId={params.id} />
      {children}
    </div>
  );
}
