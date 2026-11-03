/**
 * What each step of the live journey needs before it can mean anything. A step whose prerequisite did not pass is recorded
 * as skipped, with the reason, instead of running against missing state: after a failed sign-in the old behaviour produced
 * a dozen 401s and "undefined" errors that hid the one real problem. Keys are the number at the start of a step's name.
 */
export const NEEDS: Record<string, string[]> = {
  "2-3": ["1"],
  "4": ["2-3"],
  "5-6": ["4"],
  "7": ["5-6"],
  "8-10": ["5-6"],
  "11a": ["8-10"],
  "11b": ["8-10"],
  "12-13": ["8-10"],
  "13b": ["12-13", "8-10"],
  "14": ["1"],
  "15": ["14", "2-3"],
  "16": ["2-3"],
  "17": ["15"],
};

/** "8-10. correct 3 PM to 4 PM ..." gives "8-10". Steps without a number (the capability check) have no key. */
export const stepKey = (name: string) => /^([0-9a-z-]+)\.\s/.exec(name)?.[1];

/** The prerequisites of a step that have not passed yet. Empty means it may run. */
export function blockedBy(key: string | undefined, passed: ReadonlySet<string>): string[] {
  return (key ? (NEEDS[key] ?? []) : []).filter((k) => !passed.has(k));
}
