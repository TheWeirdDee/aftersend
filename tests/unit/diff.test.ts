import { describe, expect, it } from "vitest";
import { factChanges, suggestUpdatePreface, wordDiff } from "@/lib/notices/diff";

describe("revision diff", () => {
  it("shows the changed time as removed and added words", () => {
    const parts = wordDiff("Pickup is at 3:00 PM.", "Pickup is at 4:00 PM.");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text).join("")).toContain("3:00");
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text).join("")).toContain("4:00");
  });

  it("reports the time change as a critical fact change", () => {
    expect(factChanges("Pickup is at 3:00 PM.", "Pickup is at 4:00 PM.")).toEqual([
      { kind: "time", previousValue: "3:00 PM", currentValue: "4:00 PM" },
    ]);
  });

  it("ignores formatting-only differences", () => {
    expect(factChanges("Pickup at 3:00 PM", "Pickup at 3:00 p.m.")).toEqual([]);
  });

  it("detects added and removed facts", () => {
    expect(factChanges("Meet at 9am.", "Meet at 9am, call 0803 123 4567.")).toEqual([
      { kind: "phone", previousValue: null, currentValue: "0803 123 4567" },
    ]);
  });

  it("suggests a preface quoting only the publisher's own sentence", () => {
    const after = "Dear parents. Pickup is at 4:00 PM at the main gate. Thank you.";
    expect(suggestUpdatePreface(after, factChanges("Pickup is at 3:00 PM at the main gate.", after))).toBe(
      "Update: Pickup is at 4:00 PM at the main gate.",
    );
    expect(suggestUpdatePreface("Same text.", [])).toBeNull();
  });
});
