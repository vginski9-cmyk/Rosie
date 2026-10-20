// MOVING BETWEEN THE PROGRAMS OF ONE FAMILY. A family can carry several programs — Rowan-Cabarrus's
// nine Electrical Systems Technology credentials, Brunswick's three RN pathways, Lenoir's six Nurse
// Aide models — each with its own pages. The switcher on the program pages keeps the reader on the
// same tab: the Design & sequence of one credential opens the Design & sequence of the next. An
// offering's pages belong to one program, so from there the sibling opens at its overview.

/** The same page for a sibling program: `/programs/a/structure` → `/programs/b/structure`; an offering page → the sibling's overview. */
export function siblingHref(pathname: string, programId: string, siblingId: string): string {
  const base = `/programs/${programId}`;
  if (!pathname.startsWith(base)) return `/programs/${siblingId}`;
  const rest = pathname.slice(base.length);
  if (rest.startsWith("/offerings/")) return `/programs/${siblingId}`;
  return `/programs/${siblingId}${rest}`;
}
