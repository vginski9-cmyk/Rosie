import { describe, it, expect } from "vitest";
import { hostSlots, hostsForSettings, type HostLite } from "../src/lib/hosts";

const H = (employerId: string, capacity: Record<string, number>, rank: number): HostLite => ({ employerId, name: employerId, capacity, rank });

describe("clinical hosts by setting", () => {
  const hosts = [
    H("hospitalA", { OR: 5, GEN: 3 }, 0), H("hospitalB", { OR: 2, GEN: 1 }, 0), H("officeC", { AMB: 1, GEN: 1 }, 0),
    H("hospitalD", { OR: 2 }, 1), H("nursingHome", { LTC: 8 }, 0),
  ];
  it("never sends an OR rotation to a site without the setting", () => {
    expect(hostsForSettings(hosts, ["OR"]).map((h) => h.employerId)).toEqual(["hospitalA", "hospitalB", "hospitalD"]);
  });
  it("fills secured OR sites to capacity before a secured office that only has the secondary setting, then asked OR sites", () => {
    const slots = hostSlots(hosts, ["OR", "AMB"]);
    expect(slots.slice(0, 7).sort()).toEqual(["hospitalA", "hospitalA", "hospitalA", "hospitalA", "hospitalA", "hospitalB", "hospitalB"].sort());
    expect(slots[0]).toBe("hospitalA"); expect(slots[1]).toBe("hospitalB"); // dealt round-robin inside the tier
    expect(slots[7]).toBe("officeC"); // secured, secondary setting
    expect(slots.slice(8)).toEqual(["hospitalD", "hospitalD"]); // asked tier last
  });
  it("secured before asked, and nursing homes never appear for an OR course", () => {
    expect(hostSlots(hosts, ["OR"])).not.toContain("nursingHome");
    expect(hostSlots(hosts, ["OR"]).indexOf("hospitalD")).toBe(7);
  });
});

describe("accreditor-approved capacity caps a site", () => {
  it("a recognized site takes no more sections at once than JRCERT approved, whatever its assets could host", () => {
    const hosts: HostLite[] = [H("bigHospital", { GEN: 6, PORT: 3 }, 0), H("clinic", { GEN: 2 }, 0)];
    hosts[0].approvedCapacity = 4;
    const slots = hostSlots(hosts, ["GEN", "PORT"]);
    expect(slots.filter((s) => s === "bigHospital").length).toBe(4);
    expect(slots.filter((s) => s === "clinic").length).toBe(2);
  });
});
