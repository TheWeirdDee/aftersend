import { describe, expect, it } from "vitest";
import { nextFridayLabel, sampleNotice } from "@/lib/notices/samples";
import { detectCriticalFacts } from "@/lib/notices/facts";

describe("sample announcement", () => {
  it("always names a Friday that is a real Friday, at least four days ahead", () => {
    for (let i = 0; i < 800; i++) {
      const now = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
      const label = nextFridayLabel(now);
      const m = /^Friday, (\d+) (\w+) (\d{4})$/.exec(label)!;
      const date = new Date(`${m[1]} ${m[2]} ${m[3]} UTC`);
      expect(date.getUTCDay()).toBe(5);
      expect(date.getTime()).toBeGreaterThanOrEqual(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4));
      expect(detectCriticalFacts(sampleNotice(now).text).filter((f) => f.ambiguous)).toEqual([]);
    }
  });

  it("is dated from the 3 November 2026 example without the old Saturday mistake", () => {
    expect(nextFridayLabel(new Date(Date.UTC(2026, 10, 3)))).toBe("Friday, 13 November 2026");
  });

  it("contains the time the correction demo changes", () => {
    const s = sampleNotice();
    expect(s.text).toContain(s.correctedFrom);
  });
});
