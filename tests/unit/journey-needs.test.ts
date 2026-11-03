import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { blockedBy, NEEDS, stepKey } from "../../scripts/journey-needs";

/** The step names exactly as the journey script declares them, in the order it runs them. */
function declaredSteps(): string[] {
  const source = fs.readFileSync("scripts/live-journey.ts", "utf8");
  return [...source.matchAll(/await step\("([^"]+)"/g)].map((m) => m[1]!);
}

describe("live journey prerequisites", () => {
  const names = declaredSteps();
  const keys = names.map(stepKey).filter((k): k is string => !!k);

  it("reads a step's key from its name", () => {
    expect(stepKey("1. sign up with email")).toBe("1");
    expect(stepKey("8-10. correct 3 PM to 4 PM")).toBe("8-10");
    expect(stepKey("11b. the superseded storage object")).toBe("11b");
    expect(stepKey("target is live-capable (real speech)")).toBeUndefined();
  });

  it("every step in the script is either the capability check or has a key", () => {
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => !stepKey(n))).toEqual(["target is live-capable (real speech and real email), unless rehearsing"]);
  });

  it("only names steps that exist, and every prerequisite runs earlier than the step that needs it", () => {
    for (const [key, needs] of Object.entries(NEEDS)) {
      expect(keys, `unknown step ${key}`).toContain(key);
      for (const need of needs) {
        expect(keys, `${key} needs unknown step ${need}`).toContain(need);
        expect(keys.indexOf(need), `${need} must run before ${key}`).toBeLessThan(keys.indexOf(key));
      }
    }
  });

  it("every step after sign-in depends, directly or through others, on sign-in", () => {
    const reaches = (key: string, seen = new Set<string>()): boolean => {
      if (key === "1") return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return (NEEDS[key] ?? []).some((n) => reaches(n, seen));
    };
    for (const key of keys.filter((k) => k !== "1")) expect(reaches(key), `${key} would run without a signed-in session`).toBe(true);
  });

  it("a failed sign-in blocks everything that depends on it, and names the cause", () => {
    const passed = new Set<string>();
    expect(blockedBy("2-3", passed)).toEqual(["1"]);
    expect(blockedBy("13b", passed)).toEqual(["12-13", "8-10"]);
  });

  it("a step runs once what it needs has passed", () => {
    expect(blockedBy("2-3", new Set(["1"]))).toEqual([]);
    expect(blockedBy("15", new Set(["1", "14"]))).toEqual(["2-3"]);
    expect(blockedBy("15", new Set(["1", "14", "2-3"]))).toEqual([]);
  });

  it("steps with no key, and the first step, are never blocked", () => {
    expect(blockedBy(undefined, new Set())).toEqual([]);
    expect(blockedBy("1", new Set())).toEqual([]);
  });
});
