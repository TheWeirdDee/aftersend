"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { factChanges, suggestUpdatePreface } from "@/lib/notices/diff";
import { hasAmbiguousFacts } from "@/lib/notices/facts";
import { toSpeechText } from "@/lib/notices/normalize-speech";
import { MAX_NOTICE_CHARS, MAX_TITLE_CHARS } from "@/lib/notices/validation";
import { formatDuration } from "@/lib/format";
import { AudioPlayer } from "../audio-player";
import { Alert, Check, External, Spinner, Wave } from "../icons";
import { DiffView } from "./diff-view";
import { FactsPanel } from "./facts-panel";
import { TestAudioBadge } from "./status-pill";

type Voice = { id: string; label: string };
type RevStatus = "draft" | "queued" | "synthesizing" | "preview_ready" | "failed" | "published" | "superseded" | "discarded";

type StatusResponse = {
  status: RevStatus;
  synthesisKey: string;
  previewUrl: string | null;
  audio: { mimeType: string; durationMs: number | null; sha256: string; providerLatencyMs: number | null; providerKind: string } | null;
  attempts: {
    id: string;
    outcome: string;
    startedAt: string;
    completedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    modelId: string | null;
    voiceId: string;
    retries: number;
  }[];
};

export type EditorProps = {
  noticeId: string;
  noticeState: "draft" | "published" | "withdrawn";
  publicPath: string;
  isDemo: boolean;
  sourceUrl: string | null;
  base: { revisionId: string; revisionNumber: number; title: string; displayText: string; voiceId: string } | null;
  draft: {
    revisionId: string;
    title: string;
    displayText: string;
    updatePreface: string | null;
    voiceId: string;
  } | null;
  voices: Voice[];
  provider: { ok: boolean; reason: string | null };
};

type SaveState = "saved" | "dirty" | "saving" | "error";
type Phase = "idle" | "preparing" | "synthesizing" | "publishing";

export function NoticeEditor(props: EditorProps) {
  const router = useRouter();
  const { base } = props;
  const [revisionId, setRevisionId] = useState(props.draft?.revisionId ?? null);
  const [title, setTitle] = useState(props.draft?.title ?? base?.title ?? "");
  const [text, setText] = useState(props.draft?.displayText ?? base?.displayText ?? "");
  const [preface, setPreface] = useState(props.draft?.updatePreface ?? "");
  const [voiceId, setVoiceId] = useState(props.draft?.voiceId ?? base?.voiceId ?? props.voices[0]?.id ?? "");
  const [sourceUrl, setSourceUrl] = useState(props.sourceUrl ?? "");
  const [save, setSave] = useState<SaveState>("saved");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [listened, setListened] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromise = useRef<Promise<string | null> | null>(null);
  const latest = useRef({ title, text, preface, voiceId, sourceUrl });
  useEffect(() => {
    latest.current = { title, text, preface, voiceId, sourceUrl };
  });

  const isCorrection = !!base;
  const changes = useMemo(() => (base ? factChanges(base.displayText, text) : []), [base, text]);
  const suggestion = useMemo(() => (base ? suggestUpdatePreface(text, changes) : null), [base, text, changes]);
  const unchanged = !!base && text.trim() === base.displayText.trim() && title.trim() === base.title.trim() && !preface.trim() && voiceId === base.voiceId;
  const speechScript = useMemo(() => toSpeechText(title || " ", text, isCorrection ? preface : null), [title, text, preface, isCorrection]);
  const ambiguous = useMemo(() => hasAmbiguousFacts(text), [text]);

  const refreshStatus = useCallback(async (id: string) => {
    const s = await api<StatusResponse>(`/api/revisions/${id}/status`);
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    if (!revisionId) return;
    let live = true;
    api<StatusResponse>(`/api/revisions/${revisionId}/status`)
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [revisionId]);

  // Persist edits. A correction draft is created on the first real change.
  const persist = useCallback(async (): Promise<string | null> => {
    const v = latest.current;
    if (!v.title.trim() || !v.text.trim()) return revisionId;
    setSave("saving");
    try {
      let id = revisionId;
      if (!id) {
        if (base && v.text.trim() === base.displayText.trim() && v.title.trim() === base.title.trim() && !v.preface.trim() && v.voiceId === base.voiceId) {
          setSave("saved");
          return null;
        }
        const res = await api<{ revisionId: string }>(`/api/notices/${props.noticeId}/revisions`, {
          method: "POST",
          body: { title: v.title, text: v.text, voiceId: v.voiceId, updatePreface: v.preface || null },
        });
        id = res.revisionId;
        setRevisionId(id);
      } else {
        await api(`/api/revisions/${id}`, {
          method: "PATCH",
          body: {
            title: v.title,
            text: v.text,
            voiceId: v.voiceId,
            updatePreface: isCorrection ? v.preface || null : null,
            ...(props.noticeState === "draft" ? { sourceUrl: v.sourceUrl || null } : {}),
          },
        });
      }
      setSave("saved");
      await refreshStatus(id);
      return id;
    } catch (e) {
      setSave("error");
      setError(e instanceof ApiFailure ? e.message : "Could not save your changes.");
      return null;
    }
  }, [revisionId, base, props.noticeId, props.noticeState, isCorrection, refreshStatus]);

  const scheduleSave = () => {
    setSave("dirty");
    setListened(false);
    setConfirmed(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePromise.current = persist();
    }, 700);
  };

  const flush = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return persist();
    }
    if (savePromise.current) await savePromise.current;
    return revisionId;
  };

  useEffect(() => {
    if (phase !== "synthesizing" && phase !== "preparing") return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving" || phase !== "idle") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save, phase]);

  const generate = async () => {
    setError(null);
    setElapsed(0);
    setPhase("preparing");
    const id = await flush();
    if (!id) {
      setPhase("idle");
      if (!error) setError(unchanged ? "Change the notice before generating new audio." : "Save the notice first.");
      return;
    }
    setPhase("synthesizing");
    setListened(false);
    setConfirmed(false);
    try {
      await api(`/api/revisions/${id}/generate`, { method: "POST" });
    } catch (e) {
      if (e instanceof ApiFailure && e.error.code === "synthesis_in_progress") {
        // Another request is already generating this exact revision: follow its result.
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const s = await refreshStatus(id).catch(() => null);
          if (s && s.status !== "synthesizing") break;
        }
      } else {
        setError(e instanceof ApiFailure ? e.message : "Audio generation failed.");
      }
    }
    await refreshStatus(id).catch(() => {});
    setPhase("idle");
  };

  const approve = async () => {
    if (!revisionId) return;
    setError(null);
    setPhase("publishing");
    try {
      const res = await api<{ revisionNumber: number }>(`/api/revisions/${revisionId}/approve`, {
        method: "POST",
        body: { confirmedCriticalFacts: true },
      });
      router.push(`/app/notices/${props.noticeId}?published=${res.revisionNumber}`);
      router.refresh();
    } catch (e) {
      setPhase("idle");
      if (e instanceof ApiFailure && e.error.code === "conflict") setConflict(e.message);
      else setError(e instanceof ApiFailure ? e.message : "Publishing failed. The previous version is still live.");
      if (revisionId) refreshStatus(revisionId).catch(() => {});
    }
  };

  const ready = status?.status === "preview_ready" && !!status.previewUrl && save === "saved";
  const spokenRef = useRef<HTMLElement>(null);
  const previewUrl = ready ? status?.previewUrl : null;

  // On narrow screens the player sits below the text; bring it into view once a preview is ready.
  useEffect(() => {
    if (previewUrl && window.matchMedia("(max-width: 1023px)").matches) {
      spokenRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [previewUrl]);
  const lastAttempt = status?.attempts[0];
  const busy = phase !== "idle";

  const approveBlocker = !props.provider.ok
    ? "Speech generation is unavailable."
    : !ready
      ? "Generate the audio preview first."
      : !listened
        ? "Play the preview before approving."
        : !confirmed
          ? "Confirm you've checked the critical facts."
          : null;

  const generateBlocker = !props.provider.ok
    ? props.provider.reason
    : ambiguous
      ? "Resolve the ambiguous date first."
      : !title.trim() || !text.trim()
        ? "Add a title and notice text."
        : unchanged && !revisionId
          ? "Make a change to the notice to create a correction."
          : null;

  const phaseLabel =
    phase === "preparing"
      ? "Preparing script"
      : phase === "synthesizing"
        ? `Synthesizing audio and checking the file · ${elapsed}s`
        : phase === "publishing"
          ? "Publishing"
          : status?.status === "preview_ready"
            ? "Ready to preview"
            : status?.status === "failed"
              ? "Generation failed"
              : status?.status === "synthesizing"
                ? "Synthesizing audio"
                : "No audio generated yet";

  const approveLabel = isCorrection ? "Approve update" : "Approve and publish";

  return (
    <div className="pb-28 lg:pb-0">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
        {/* Source and edits */}
        <div className="min-w-0 space-y-6">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted">
              {isCorrection ? `Correcting version ${base!.revisionNumber}` : "First version"}
              {props.isDemo ? <span className="pill ml-2 border-warn/40 text-warn">Demo data</span> : null}
            </span>
            <span aria-live="polite" className="font-mono text-faint">
              {save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "error" ? "Not saved" : revisionId ? "Draft saved" : "No changes"}
            </span>
          </div>
          <div>
            <label htmlFor="title" className="field-label">
              Title
            </label>
            <input
              id="title"
              className="input text-[17px]"
              value={title}
              maxLength={MAX_TITLE_CHARS}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave();
              }}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="text" className="field-label">
              Notice text
            </label>
            <textarea
              id="text"
              className="input min-h-[260px] resize-y leading-[1.65]"
              value={text}
              maxLength={MAX_NOTICE_CHARS}
              onChange={(e) => {
                setText(e.target.value);
                scheduleSave();
              }}
              disabled={busy}
            />
            <p className="field-hint">Listeners hear exactly this text, read aloud after the title.</p>
          </div>
          {props.noticeState === "draft" ? (
            <div>
              <label htmlFor="source" className="field-label">
                Source link <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="source"
                type="url"
                className="input"
                value={sourceUrl}
                onChange={(e) => {
                  setSourceUrl(e.target.value);
                  scheduleSave();
                }}
                placeholder="https://"
                disabled={busy}
              />
            </div>
          ) : null}
          <FactsPanel text={text} changedValues={changes.map((c) => c.currentValue ?? "")} />

          {isCorrection ? (
            <section aria-labelledby="diff-heading" className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="diff-heading" className="text-[15px] font-medium">
                  Changes from version {base!.revisionNumber}
                </h3>
                {changes.length > 0 ? (
                  <span className="text-[13px] text-muted">
                    {changes.map((c) => `${c.kind}: ${c.previousValue ?? "—"} → ${c.currentValue ?? "removed"}`).join(" · ")}
                  </span>
                ) : null}
              </div>
              <DiffView before={base!.displayText} after={text} />
              <div className="border-t border-line pt-4">
                <label htmlFor="preface" className="field-label">
                  Update note <span className="font-normal text-muted">(optional, spoken first)</span>
                </label>
                <input
                  id="preface"
                  className="input"
                  value={preface}
                  maxLength={300}
                  onChange={(e) => {
                    setPreface(e.target.value);
                    scheduleSave();
                  }}
                  placeholder="e.g. Update: Pickup is now at 4:00 PM."
                  disabled={busy}
                />
                {suggestion && suggestion !== preface ? (
                  <button
                    type="button"
                    className="mt-2 text-left text-[13.5px] text-signal underline-offset-4 hover:underline"
                    onClick={() => {
                      setPreface(suggestion);
                      scheduleSave();
                    }}
                    disabled={busy}
                  >
                    Use suggestion: “{suggestion}”
                  </button>
                ) : null}
                <p className="field-hint">Only what you write here is spoken. AfterSend never adds a reason for the change.</p>
              </div>
            </section>
          ) : null}
        </div>

        {/* Spoken output */}
        <aside ref={spokenRef} aria-labelledby="spoken-heading" className="min-w-0 scroll-mt-20 lg:sticky lg:top-24 lg:self-start">
          <div className="card space-y-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 id="spoken-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]">
                <Wave className="size-[18px] text-signal" /> Spoken output
              </h2>
              {status?.audio?.providerKind === "test" ? <TestAudioBadge /> : null}
            </div>

            <div>
              <label htmlFor="voice" className="field-label">
                Voice
              </label>
              <select
                id="voice"
                className="input"
                value={voiceId}
                onChange={(e) => {
                  setVoiceId(e.target.value);
                  scheduleSave();
                }}
                disabled={busy || props.voices.length === 0}
              >
                {props.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-line bg-ink-2 p-4">
              <p role="status" aria-live="polite" className="flex items-center gap-2 text-[13.5px] text-muted">
                {busy ? <Spinner className="size-3.5" /> : <span className={`size-2 rounded-full ${ready ? "bg-signal" : status?.status === "failed" ? "bg-danger" : "bg-line-strong"}`} aria-hidden />}
                {phaseLabel}
              </p>
              <AnimatePresence mode="wait" initial={false}>
                {ready && status?.previewUrl ? (
                  <motion.div key={status.previewUrl} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="mt-3">
                    <AudioPlayer key={status.previewUrl} src={status.previewUrl} label="audio preview" durationHintMs={status.audio?.durationMs} onListened={() => setListened(true)} compact />
                    <p className="mt-3 font-mono text-[11.5px] leading-5 text-faint">
                      {formatDuration(status.audio?.durationMs)} · generated in {status.audio?.providerLatencyMs != null ? `${(status.audio.providerLatencyMs / 1000).toFixed(1)}s` : "–"} ·{" "}
                      {lastAttempt?.modelId ?? "model n/a"} · sha256 {status.audio?.sha256.slice(0, 10)}…
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {status?.status === "failed" && lastAttempt?.errorMessage && phase === "idle" ? (
                <p className="mt-3 text-[13.5px] leading-5 text-danger">{lastAttempt.errorMessage}</p>
              ) : null}
            </div>

            <details className="group rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13.5px] text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                Exact spoken script
                <span aria-hidden className="transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="border-t border-line px-4 py-3 text-[13.5px] leading-6 text-muted">{speechScript}</p>
            </details>

            {error ? (
              <p role="alert" className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[14px] leading-5 text-fg">
                <Alert className="mt-0.5 size-4 shrink-0 text-danger" /> {error}
              </p>
            ) : null}

            <label className={`flex items-start gap-3 rounded-lg p-1 text-[14px] leading-5 ${ready && listened ? "text-fg" : "text-faint"}`}>
              <input
                type="checkbox"
                className="mt-0.5 size-[18px] shrink-0 accent-[var(--color-signal)]"
                checked={confirmed}
                disabled={!ready || !listened || busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I listened to the preview and checked the dates, times, places and contact details.
            </label>

            <div className="hidden gap-2 sm:flex lg:flex">
              <ActionButtons
                generate={generate}
                approve={approve}
                busy={busy}
                ready={ready}
                generateBlocker={generateBlocker}
                approveBlocker={approveBlocker}
                approveLabel={approveLabel}
                phase={phase}
              />
            </div>
            <p className="text-[13px] leading-5 text-faint" id="approve-help">
              {approveBlocker ?? (isCorrection ? "Approving makes this the version everyone hears at the existing link." : "Approving publishes the notice at a new shareable link.")}
            </p>
            {isCorrection ? (
              <Link href={props.publicPath} target="_blank" className="btn-ghost btn-sm -ml-3">
                <External /> Open current listener page
              </Link>
            ) : null}
          </div>
        </aside>
      </div>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 p-3 backdrop-blur-xl sm:hidden">
        <div className="flex gap-2">
          <ActionButtons
            generate={generate}
            approve={approve}
            busy={busy}
            ready={ready}
            generateBlocker={generateBlocker}
            approveBlocker={approveBlocker}
            approveLabel={isCorrection ? "Approve" : "Publish"}
            phase={phase}
          />
        </div>
      </div>

      <AnimatePresence>
        {conflict ? (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="conflict-title"
              aria-describedby="conflict-body"
              className="card w-full max-w-md p-6"
              initial={{ y: 16, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 8, opacity: 0 }}
            >
              <h2 id="conflict-title" className="text-[19px] font-semibold tracking-[-0.02em]">
                A newer version was published
              </h2>
              <p id="conflict-body" className="mt-2 text-[15px] leading-6 text-muted">
                {conflict} Your draft was not published, and nothing was overwritten.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setConflict(null)}>
                  Keep my draft
                </button>
                <Link href={`/app/notices/${props.noticeId}`} className="btn-primary btn-sm" autoFocus>
                  Review latest version
                </Link>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ActionButtons(p: {
  generate: () => void;
  approve: () => void;
  busy: boolean;
  ready: boolean;
  generateBlocker: string | null;
  approveBlocker: string | null;
  approveLabel: string;
  phase: Phase;
}) {
  return (
    <>
      <button
        type="button"
        onClick={p.generate}
        disabled={p.busy || !!p.generateBlocker}
        title={p.generateBlocker ?? undefined}
        className={`${p.ready ? "btn-secondary" : "btn-primary"} h-12 flex-1`}
      >
        {p.phase === "synthesizing" || p.phase === "preparing" ? <Spinner /> : null}
        {p.ready ? "Regenerate" : "Generate preview"}
      </button>
      <button
        type="button"
        onClick={p.approve}
        disabled={p.busy || !!p.approveBlocker}
        aria-describedby="approve-help"
        className={`${p.ready ? "btn-primary" : "btn-secondary"} h-12 flex-1`}
      >
        {p.phase === "publishing" ? <Spinner /> : <Check />}
        {p.approveLabel}
      </button>
    </>
  );
}
