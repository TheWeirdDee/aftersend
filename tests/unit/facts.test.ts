import { describe, expect, it } from "vitest";
import { detectCriticalFacts, findAmbiguousSpokenFact, hasAmbiguousFacts } from "@/lib/notices/facts";

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

describe("calendar validation", () => {
  const problem = (t: string) => detectCriticalFacts(t).find((f) => f.ambiguous);

  it("rejects numeric dates that are not on the calendar", () => {
    expect(problem("Due 31/02/2026")).toMatchObject({ value: "31/02/2026", note: "This date is not on the calendar." });
    expect(problem("Due 02/30/2026")).toBeDefined();
    expect(problem("Due 31/04/2026")).toBeDefined();
    expect(problem("Due 00/05/2026")).toBeDefined();
    expect(problem("Due 13/13/2026")).toBeDefined();
  });

  it("handles leap years", () => {
    expect(problem("Due 29/02/2025")).toBeDefined();
    expect(problem("Due 29/02/2024")).toBeUndefined();
    expect(problem("Due 29/02/2100")).toBeDefined(); // 2100 is not a leap year
    expect(problem("Due 29/02/2000")).toBeUndefined(); // 2000 is
  });

  it("still accepts real unambiguous numeric dates and still flags real ambiguity", () => {
    expect(problem("Due 31/01/2026")).toBeUndefined();
    expect(problem("Due 12/31/2026")).toBeUndefined(); // can only be month-first
    expect(problem("Due 05/06/2026")).toMatchObject({ note: expect.stringContaining("either way") });
  });

  it("rejects written dates that are not on the calendar", () => {
    expect(problem("Meet on 31 February 2026")).toMatchObject({ note: "This date is not on the calendar." });
    expect(problem("Meet on 31 April")).toBeDefined();
    expect(problem("Meet on June 31st")).toBeDefined();
    expect(problem("Meet on Feb 30")).toBeDefined();
    expect(problem("Meet on 29 February 2025")).toBeDefined();
  });

  it("accepts real written dates, and 29 February when no year is given", () => {
    expect(problem("Meet on 29 February")).toBeUndefined();
    expect(problem("Meet on 29 February 2028")).toBeUndefined();
    expect(problem("Meet on 31 October 2026")).toBeUndefined();
    expect(problem("Friday, 24 October 2026")).toBeUndefined();
  });
});

describe("weekday detection", () => {
  const weekdays = (t: string) => detectCriticalFacts(t).map((f) => f.value);

  it("finds full names in any case", () => {
    expect(weekdays("Closed on monday, TUESDAY and Wednesday.")).toEqual(["monday", "TUESDAY", "Wednesday"]);
  });

  it("finds capitalised abbreviations but not ordinary lower-case words", () => {
    expect(weekdays("Mon to Fri, SAT only by arrangement.")).toEqual(["Mon", "Fri", "SAT"]);
    expect(weekdays("They sat down and the sun was out; we wed on a mon.")).toEqual([]);
  });
});

describe("findAmbiguousSpokenFact", () => {
  it("looks at every spoken field and names the one that has the problem", () => {
    expect(findAmbiguousSpokenFact({ title: "Trip 05/06/26", text: "Fine." })).toMatchObject({ field: "title" });
    expect(findAmbiguousSpokenFact({ title: "Trip", text: "Fine.", updatePreface: "Moved to 31/02/2026" })).toMatchObject({ field: "updatePreface" });
    expect(findAmbiguousSpokenFact({ title: "Trip", text: "Leaves 05/06/26." })).toMatchObject({ field: "text" });
    expect(findAmbiguousSpokenFact({ title: "Trip", text: "Leaves 5 June 2026.", updatePreface: null })).toBeNull();
  });
});
