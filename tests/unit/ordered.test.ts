import { describe, expect, it } from "vitest";
import { createOrdered } from "@/lib/client/ordered";

describe("answers in the order of the questions", () => {
  it("accepts answers in order", () => {
    const o = createOrdered();
    const a = o.next();
    const b = o.next();
    expect(o.accept(a)).toBe(true);
    expect(o.accept(b)).toBe(true);
  });

  it("refuses an older answer that arrives after a newer one", () => {
    const o = createOrdered();
    const slow = o.next();
    const fast = o.next();
    expect(o.accept(fast)).toBe(true);
    expect(o.accept(slow)).toBe(false);
  });

  it("refuses the same answer twice, and accepts a later question after a refusal", () => {
    const o = createOrdered();
    const a = o.next();
    const b = o.next();
    expect(o.accept(b)).toBe(true);
    expect(o.accept(a)).toBe(false);
    expect(o.accept(b)).toBe(false);
    const c = o.next();
    expect(o.accept(c)).toBe(true);
  });
});
