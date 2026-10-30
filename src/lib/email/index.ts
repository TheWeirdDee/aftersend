import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { newId } from "../ids";

export type EmailMessage = { to: string; subject: string; text: string };

export class EmailError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "EmailError";
  }
}

export type EmailConfig = { ok: true; driver: "resend" | "file" } | { ok: false; reason: string };

/** Whether mail can be sent, without sending any. Used by readiness checks and before accepting a sign-in request. */
export function emailConfigured(): EmailConfig {
  const e = env();
  if (e.EMAIL_DRIVER === "file") {
    if (e.AFTERSEND_ALLOW_TEST_EMAIL !== "1") return { ok: false, reason: "EMAIL_DRIVER=file requires AFTERSEND_ALLOW_TEST_EMAIL=1." };
    return { ok: true, driver: "file" };
  }
  if (!e.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY is not set on the server." };
  if (!e.EMAIL_FROM) return { ok: false, reason: "EMAIL_FROM is not set on the server." };
  return { ok: true, driver: "resend" };
}

/** Sends plain text only: no HTML and no links, so there is nothing for a mail client to render or a scanner to click. */
export async function sendEmail(message: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<void> {
  const config = emailConfigured();
  if (!config.ok) throw new EmailError(config.reason, false);
  const e = env();

  if (config.driver === "file") {
    const dir = path.resolve(e.EMAIL_OUTBOX_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${Date.now()}-${newId("mail")}.json`), JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2));
    return;
  }

  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: e.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailError("Could not reach the email service.", true);
  }
  if (!res.ok) {
    // The provider's response body can echo request details, so only the status is kept.
    throw new EmailError(`The email service refused the message (${res.status}).`, res.status === 429 || res.status >= 500);
  }
}
