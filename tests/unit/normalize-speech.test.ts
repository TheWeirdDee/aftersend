import { describe, expect, it } from "vitest";
import { numberWords, speakClockTime, speakPhoneNumber, toSpeechText } from "@/lib/notices/normalize-speech";

describe("speech normalisation", () => {
  it("reads clock times unambiguously", () => {
    expect(speakClockTime(3, 0, "pm")).toBe("three p.m.");
    expect(speakClockTime(4, 0, "pm")).toBe("four p.m.");
    expect(speakClockTime(7, 5, "am")).toBe("seven oh five a.m.");
    expect(speakClockTime(10, 45, "am")).toBe("ten forty-five a.m.");
    expect(speakClockTime(12, 0, "pm")).toBe("twelve noon");
    expect(speakClockTime(12, 0, "am")).toBe("twelve midnight");
  });

  it("spells numbers below sixty", () => {
    expect(numberWords(0)).toBe("zero");
    expect(numberWords(21)).toBe("twenty-one");
    expect(numberWords(59)).toBe("fifty-nine");
  });

  it("reads phone numbers digit by digit in their groups", () => {
    expect(speakPhoneNumber("0803 123 4567")).toBe("zero eight zero three, one two three, four five six seven");
    expect(speakPhoneNumber("+234 803")).toBe("plus two three four, eight zero three");
  });

  it("builds the script without changing the facts", () => {
    const s = toSpeechText("Pickup notice", "Dear parents,\n\nPickup is at 3:00 PM.\nBring your card");
    expect(s).toBe("Pickup notice. Dear parents, Pickup is at three p.m. Bring your card.");
  });

  it("includes an approved update preface after the title", () => {
    const s = toSpeechText("Pickup notice", "Pickup is at 4:00 PM.", "Update: pickup is now at 4:00 PM");
    expect(s).toBe("Pickup notice. Update: pickup is now at four p.m. Pickup is at four p.m.");
  });

  it("keeps Nigerian names and Lagos places verbatim", () => {
    const s = toSpeechText("Notice", "Mrs. Adebayo-Okonkwo will meet parents at Ikeja GRA and Lekki Phase 1.");
    expect(s).toContain("Mrs. Adebayo-Okonkwo will meet parents at Ikeja GRA and Lekki Phase 1.");
  });
});
