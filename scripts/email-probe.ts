/**
 * Sends ONE real message through AfterSend's own email sender (the same code path as a sign-in code) to a Resend
 * test address, then asks Resend what it recorded. It proves: the key works, the verified domain accepts the sender
 * address, and the message is accepted for delivery. It reaches no person's mailbox by default.
 *
 *   npm run email:probe                              # to delivered@resend.dev (Resend's "always delivers" test address)
 *   npm run email:probe -- --to bounced@resend.dev   # exercise the failure path
 *   npm run email:probe -- --to you@your-domain.com  # a real mailbox, to see the message with your own eyes
 *
 * It only ever calls POST /emails and GET /emails/<id of the message it just sent>. It never lists, reads or
 * changes anything else in the account, so it cannot disturb other applications that share the account.
 * The key is never printed.
 */
import "./load-env";
import { sendEmail, emailConfigured } from "../src/lib/email";
import { env } from "../src/lib/env";

const args = process.argv.slice(2);
const to = args.includes("--to") ? args[args.indexOf("--to") + 1]! : "delivered@resend.dev";

async function main() {
  const config = emailConfigured();
  if (!config.ok) {
    console.error(`Not run: ${config.reason}`);
    process.exit(2);
  }
  if (config.driver !== "resend") {
    console.error(`Not run: the email driver is "${config.driver}", not resend. This probe exists to test the real provider.`);
    process.exit(2);
  }
  const from = env().EMAIL_FROM!;
  console.log(`from (configured): ${from}`);
  console.log(`to: ${to}${to.endsWith("@resend.dev") ? " (Resend test address, no real mailbox)" : ""}`);

  const started = Date.now();
  let id: string | null;
  try {
    ({ id } = await sendEmail({
      to,
      subject: "AfterSend delivery probe (no action needed)",
      text: "This message was sent by AfterSend's email probe to check delivery. No action is needed.",
    }));
  } catch (err) {
    console.error(`FAIL  send: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS  accepted by Resend in ${Date.now() - started} ms; message id: ${id ?? "(none returned)"}`);
  if (!id) {
    process.exitCode = 1;
    return;
  }

  // Give Resend a moment to record the delivery event, then read back only this message.
  await new Promise((r) => setTimeout(r, 4000));
  const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env().RESEND_API_KEY}` } });
  if (!res.ok) {
    console.log(`INFO  could not read the message back (status ${res.status}). A sending-only key cannot, which is expected and fine; check the message in https://resend.com/emails.`);
    return;
  }
  const record = (await res.json()) as { from?: string; to?: string[]; subject?: string; last_event?: string; created_at?: string };
  console.log(`INFO  Resend recorded: from=${record.from} to=${(record.to ?? []).join(",")} last_event=${record.last_event}`);
  const same = record.from === from;
  console.log(same ? "PASS  the recorded sender matches the configured sender" : "FAIL  the recorded sender differs from the configured sender");
  if (!same) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
