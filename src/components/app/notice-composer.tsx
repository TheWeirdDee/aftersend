"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { MAX_NOTICE_CHARS, MAX_TITLE_CHARS } from "@/lib/notices/validation";
import { FactsPanel } from "./facts-panel";
import { ArrowRight, Spinner } from "../icons";

type Voice = { id: string; label: string };

export function NoticeComposer({ voices, initial }: { voices: Voice[]; initial?: { title: string; text: string; sourceUrl?: string } }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { noticeId } = await api<{ noticeId: string }>("/api/notices", {
        method: "POST",
        body: { title, text, sourceUrl: sourceUrl || null, voiceId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      router.push(`/app/notices/${noticeId}/edit`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Could not save the notice.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1.25fr_1fr]" noValidate>
      <div className="space-y-6">
        <div>
          <label htmlFor="title" className="field-label">
            Title
          </label>
          <input
            id="title"
            className="input text-[17px]"
            value={title}
            maxLength={MAX_TITLE_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Early closure on Friday"
            required
          />
          <p className="field-hint">Spoken first, before the notice.</p>
        </div>
        <div>
          <label htmlFor="text" className="field-label">
            Notice text
          </label>
          <textarea
            id="text"
            className="input min-h-[280px] resize-y leading-[1.65]"
            value={text}
            maxLength={MAX_NOTICE_CHARS}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the exact wording you have approved."
            required
            aria-describedby="text-hint"
          />
          <p id="text-hint" className="field-hint flex justify-between gap-4">
            <span>Listeners hear exactly this text. Nothing is summarised or reworded.</span>
            <span className="shrink-0 font-mono">
              {text.length}/{MAX_NOTICE_CHARS}
            </span>
          </p>
        </div>
        <div>
          <label htmlFor="source" className="field-label">
            Source link <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="source"
            type="url"
            inputMode="url"
            className="input"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://"
          />
          <p className="field-hint">Shown to listeners as “Source provided by the publisher”. It is not verified.</p>
        </div>
      </div>
      <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <FactsPanel text={text} />
        <div>
          <label htmlFor="voice" className="field-label">
            Voice
          </label>
          <select id="voice" className="input" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="field-hint">A synthetic narrator voice, not a real person&apos;s voice.</p>
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-[14px] text-fg">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary h-12 w-full" disabled={busy || !title.trim() || !text.trim() || !voiceId}>
          {busy ? <Spinner /> : null} Save and continue to audio <ArrowRight />
        </button>
        <p className="text-[13px] leading-5 text-faint">Saving creates a private draft. Nothing is public until you approve it.</p>
      </div>
    </form>
  );
}
