import { describe, expect, it } from "vitest";
import { tariffRules } from "../index";
import { type Answers, evaluateTariff } from "./engine";

// A typical importer that paid IEEPA duties as importer of record. Each scenario changes a few answers.
const base: Answers = {
  imported: "yes",
  ieepaPaid: "yes",
  importerOfRecord: "self",
  aceAccess: "yes",
  entryStatus: "unliquidated",
  actionsTaken: ["none"],
  achOnFile: "yes",
  dutyBand: "50k_250k",
  brokers: "Acme Customs",
  email: "owner@example.test",
};

const run = (changes: Answers) => evaluateTariff({ ...base, ...changes }, tariffRules, "public");
const actionIds = (changes: Answers) => run(changes).actions.map((a) => a.id);

describe("tariff refund paths", () => {
  it("1. unliquidated entries go to CAPE through the broker", () => {
    const r = run({});
    expect(r.pathId).toBe("cape");
    expect(r.path.kind).toBe("refund");
    expect(r.actions).toEqual([]);
    expect(r.path.deadlines[0]!.text).toContain("February 2027");
  });

  it("2. no imports in the window means likely no path", () => {
    const r = run({ imported: "no" });
    expect(r.pathId).toBe("no-path-dates");
    expect(r.path.kind).toBe("no-path");
  });

  it("3. no IEEPA duties means likely no path, even with other answers", () => {
    expect(run({ ieepaPaid: "no", entryStatus: "final" }).pathId).toBe("no-path-not-ieepa");
  });

  it("4. DDP courier shipments start with the courier", () => {
    const r = run({ importerOfRecord: "courier_ddp", achOnFile: "no" });
    expect(r.pathId).toBe("courier");
    // ACH is the importer of record's job, so it is not on the courier path.
    expect(r.actions.map((a) => a.id)).not.toContain("ach");
  });

  it("5. recently liquidated entries go to CAPE or a protest, with the 180-day protest window", () => {
    const r = run({ entryStatus: "liquidated_recent" });
    expect(r.pathId).toBe("cape-or-protest");
    expect(r.path.deadlines.map((d) => d.text).join(" ")).toContain("180 days of liquidation");
  });

  it("6. finally liquidated entries with an importer number go to CAPE Phase 3", () => {
    const r = run({ entryStatus: "final", actionsTaken: ["importer_number"] });
    expect(r.pathId).toBe("cape-phase3");
  });

  it("7. finally liquidated entries otherwise point to the Freestyle World class, plus ACH help", () => {
    const r = run({ entryStatus: "final", achOnFile: "not_sure" });
    expect(r.pathId).toBe("class");
    expect(r.actions.map((a) => a.id)).toEqual(["ach"]);
    expect(r.path.summary.map((s) => s.text).join(" ")).toContain("Freestyle World");
  });

  it("8. an importer with its own suit follows that case, whatever the entry status", () => {
    expect(run({ actionsTaken: ["own_suit", "importer_number"], entryStatus: "final" }).pathId).toBe("own-suit");
    expect(run({ actionsTaken: ["own_suit"], entryStatus: "unliquidated" }).pathId).toBe("own-suit");
  });

  it("9. unknown entry status asks for the entry list first", () => {
    expect(run({ entryStatus: "not_sure" }).pathId).toBe("find-status");
    expect(actionIds({ entryStatus: "not_sure", aceAccess: "no" })).toEqual(["ace"]);
  });

  it("10. unknown importer of record asks who it was first", () => {
    expect(run({ importerOfRecord: "not_sure" }).pathId).toBe("find-importer");
  });

  it("11. a filed protest on liquidated entries means following up on the protest", () => {
    expect(run({ entryStatus: "liquidated_recent", actionsTaken: ["protest"] }).pathId).toBe("protest-filed");
    expect(run({ entryStatus: "final", actionsTaken: ["protest"] }).pathId).toBe("protest-filed");
  });

  it("12. a broker filing in the company's name is treated like the company", () => {
    expect(run({ importerOfRecord: "broker_my_name" }).pathId).toBe("cape");
  });

  it("13. not-sure answers add the matching checks", () => {
    expect(actionIds({ imported: "not_sure", ieepaPaid: "not_sure", achOnFile: "no", aceAccess: "not_sure" })).toEqual([
      "check-dates",
      "check-ieepa",
      "ach",
      "ace",
    ]);
  });
});

describe("unverified facts", () => {
  it("are hidden from the public and listed for admin", () => {
    const pub = evaluateTariff(base, tariffRules, "public");
    const admin = evaluateTariff(base, tariffRules, "admin");
    const filing = "CAPE claims are filed in ACE";
    expect(pub.path.steps.map((s) => s.text).join(" ")).not.toContain(filing);
    expect(admin.path.steps.map((s) => s.text).join(" ")).toContain(filing);
    expect(pub.hidden.map((h) => h.verifyFacts).flat()).toContain("cape-filing");
    expect(admin.sources.some((s) => s.id === "cape-filing")).toBe(true);
    expect(pub.sources.some((s) => s.id === "cape-filing")).toBe(false);
  });

  it("show up for the public once marked verified", () => {
    const rules = structuredClone(tariffRules);
    rules.facts["cape-filing"]!.verify = false;
    const pub = evaluateTariff(base, rules, "public");
    expect(pub.path.steps.map((s) => s.text).join(" ")).toContain("CAPE claims are filed in ACE");
  });
});
