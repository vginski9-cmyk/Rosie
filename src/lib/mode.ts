// The product boundary (Phase 13). Rosie models operational reality deeply — calendars, sequences,
// faculty qualification supply, ratios, preceptors, agreement dates, assets, experience types,
// travel, holidays, rooms and equipment, retention, lead times, evidence, uncertainty — and exposes
// operational ADMINISTRATION selectively. By default the product is strategic: the operational
// records are evidence and computational inputs, and the actions that write the operating plan
// (apply a schedule, auto-assign, realign, log competencies, edit offerings and students by hand)
// are hidden on the screens and refused on the server. Set ROSIE_OPERATIONAL=1 to open the
// operational module.
export const OPERATIONAL = process.env.ROSIE_OPERATIONAL === "1";

export const OPERATIONAL_MESSAGE = "This action belongs to the operational module, which is switched off in the strategic product. The records here are imported actuals and planning inputs; set ROSIE_OPERATIONAL=1 to open the operational module.";

/** Refuse an operational write in the strategic product. Called first in every server action that writes the operating plan or a person-level record. */
export function requireOperational(): void {
  if (!OPERATIONAL) throw new Error(OPERATIONAL_MESSAGE);
}
