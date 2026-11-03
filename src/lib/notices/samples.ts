/** The announcement a new guest starts from. They can replace every word of it. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The next Friday that is at least four days away, written the way a school would write it. Computed, so the weekday always matches the date. */
export function nextFridayLabel(now: Date = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4));
  while (day.getUTCDay() !== 5) day.setUTCDate(day.getUTCDate() + 1);
  return `Friday, ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

export function sampleNotice(now: Date = new Date()) {
  return {
    title: "Early pickup on Friday",
    text: [
      "Dear parents and guardians,",
      `Classes will end early on ${nextFridayLabel(now)} for a staff training day.`,
      "Pickup is at 3:00 PM at the main gate. Please bring your pickup card.",
      "Thank you for your support.",
    ].join("\n\n"),
    correctedFrom: "3:00 PM",
    correctedTo: "4:00 PM",
  };
}

/** For scripts and tests that need one fixed sample. The app itself calls sampleNotice() so the date is never stale. */
export const SAMPLE_NOTICE = sampleNotice();
