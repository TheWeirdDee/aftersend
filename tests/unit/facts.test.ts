import { describe, expect, it } from "vitest";
import { detectCriticalFacts, hasAmbiguousFacts } from "@/lib/notices/facts";

const values = (t: string) => detectCriticalFacts(t).map((f) => [f.kind, f.value, f.ambiguous]);

describe("detectCriticalFacts", () => {
  it("finds 12-hour times in common spellings", () => {
    expect(values("Pickup is at 3:00 PM, gates open 7am and close at 4:30 p.m.")).toEqual([
      ["time", "3:00 PM", false],
      ["time", "7am", false],
      ["time", "4:30 p.m.", false],
    ]);
  });

  it("finds 24-hour times and noon", () => {
    expect(values("Assembly at 08:30, lunch at noon")).toEqual([
      ["time", "08:30", false],
      ["time", "noon", false],
    ]);
  });

  it("finds written dates with weekdays", () => {
    expect(values("Classes end early on Friday, 24 October 2026.")).toEqual([["date", "Friday, 24 October 2026", false]]);
    expect(values("Resumption: Oct 27th")).toEqual([["date", "Oct 27th", false]]);
  });

  it("flags numeric dates that could be read either way", () => {
    const [f] = detectCriticalFacts("School resumes 05/06/26.");
    expect(f).toMatchObject({ kind: "date", value: "05/06/26", ambiguous: true });
    expect(hasAmbiguousFacts("School resumes 05/06/26.")).toBe(true);
  });

  it("accepts numeric dates that can only be read one way", () => {
    expect(detectCriticalFacts("Due 24/10/2026")[0]).toMatchObject({ ambiguous: false });
    expect(detectCriticalFacts("Due 06/06/2026")[0]).toMatchObject({ ambiguous: false });
  });

  it("finds Nigerian phone numbers", () => {
    expect(values("Call 0803 123 4567 or +234 803 123 4567.")).toEqual([
      ["phone", "0803 123 4567", false],
      ["phone", "+234 803 123 4567", false],
    ]);
  });

  it("ignores ordinary numbers", () => {
    expect(detectCriticalFacts("Bring 2 pencils and 1 notebook for 30 pupils.")).toEqual([]);
  });
});
