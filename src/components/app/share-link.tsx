"use client";

import { useState } from "react";
import { CopyButton } from "./copy-button";

export function ShareLink({ url, title }: { url: string; title: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const text = `${title}\nRead or listen to the latest announcement here: ${url}\nKeep this link: it stays the same if the announcement is corrected.`;

  return (
    <div className="mt-4 space-y-3">
      <button type="button" className="btn-secondary btn-sm" onClick={async () => {
        try {
          if (navigator.share) {
            await navigator.share({ title, text: `Read or listen to the latest announcement: ${title}`, url });
          } else {
            await navigator.clipboard.writeText(text);
            setMessage("Message copied. Paste it into your family group or email.");
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setMessage("Sharing could not open. Copy the message below and send it yourself.");
        }
      }}>Share</button>
      <label htmlFor="share-message" className="field-label">Message to send to families</label>
      <textarea id="share-message" readOnly value={text} rows={4} className="input resize-y text-[14px]" />
      <CopyButton value={text} label="Copy message" />
      {message ? <p role="status" className="text-[14px] text-muted">{message}</p> : null}
    </div>
  );
}
