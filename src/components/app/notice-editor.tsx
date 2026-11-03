"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { factChanges, suggestUpdatePreface } from "@/lib/notices/diff";
import { createSerialSaver, type SerialSaver } from "@/lib/client/serial-saver";
import { createSpeechSync, type SpeechSync } from "@/lib/client/speech-sync";
import { detectCriticalFacts } from "@/lib/notices/facts";
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
  version: number;
  /** Present while synthesizing: how long the claim has been held, and when it stops being trusted. */
  synthesis: { claimedAgoMs: number; staleAfterMs: number } | null;
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
  sourceUrl: string | null;
  base: { revisionId: string; revisionNumber: number; title: string; displayText: string; voiceId: string } | null;
  draft: {
    revisionId: string;
    version: number;
    status: RevStatus;
    title: string;
    displayText: string;
    updatePreface: string | null;
    voiceId: string;
  } | null;
  voices: Voice[];
  provider: { ok: boolean; reason: string | null };
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type Phase = "idle" | "publishing";
/** How long after the last keystroke the spoken preview is refreshed. Long enough that a sentence is finished, short enough to feel automatic. */
const AUTO_SPEECH_DELAY_MS = 1800;
/** Too little text to be worth a paid speech request. */
const MIN_SPOKEN_CHARS = 8;
const formKey = (f: Form) => JSON.stringify([f.title.trim(), f.text.trim(), f.preface.trim(), f.voiceId]);
type Form = { title: string; text: string; preface: string; voiceId: string; sourceUrl: string };
type Dialog = { kind: "published" | "stale"; message: string } | null;

/** Thrown when the form cannot be saved yet (for example an empty title). Not a network failure. */
class NotSaveable extends Error {}

function newClientToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function NoticeEditor(props: EditorProps) {
  const router = useRouter();
  const { base } = props;
  const initialForm: Form = {
    title: props.draft?.title ?? base?.title ?? "",
    text: props.draft?.displayText ?? base?.displayText ?? "",
    preface: props.draft?.updatePreface ?? "",
    voiceId: props.draft?.voiceId ?? base?.voiceId ?? props.voices[0]?.id ?? "",
    sourceUrl: props.sourceUrl ?? "",
  };
  const [form, setForm] = useState<Form>(initialForm);
  const { title, text, preface, voiceId, sourceUrl } = form;
  const [revisionId, setRevisionId] = useState(props.draft?.revisionId ?? null);
  const [version, setVersion] = useState<number | null>(props.draft?.version ?? null);
  const [save, setSave] = useState<SaveState>("saved");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  // Listening and confirmation belong to one specific audio file, so a new preview starts from scratch.
  const [listenedFor, setListenedFor] = useState<string | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  // Speech: a request from this tab is running; a refresh is waiting for the pause; the last request failed.
  const [generating, setGenerating] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The save loop reads these refs, not state, so a request never acts on a stale render.
  const latest = useRef<Form>(initialForm);
  const revisionIdRef = useRef(revisionId);
  const versionRef = useRef(version);
  const clientToken = useRef(newClientToken());
  const statusRef = useRef<StatusResponse | null>(null);
  const syncRef = useRef<SpeechSync | null>(null);
  // The exact script that failed to become speech. It is not retried automatically until the text changes.
  const failedKey = useRef<string | null>(null);

  const isCorrection = !!base;
  const changes = useMemo(() => (base ? factChanges(base.displayText, text) : []), [base, text]);
  const suggestion = useMemo(() => (base ? suggestUpdatePreface(text, changes) : null), [base, text, changes]);
  const unchangedFromBase = (f: Form) =>
    !!base && f.text.trim() === base.displayText.trim() && f.title.trim() === base.title.trim() && !f.preface.trim() && f.voiceId === base.voiceId;
  const unchanged = unchangedFromBase(form);
  const speechScript = useMemo(() => toSpeechText(title || " ", text, isCorrection ? preface : null), [title, text, preface, isCorrection]);
  // Every field that is spoken is checked, so the problem is shown next to the control that has it.
  const ambiguousBy = useMemo(() => {
    const first = (v: string) => detectCriticalFacts(v).find((f) => f.ambiguous);
    return { title: first(title), preface: isCorrection ? first(preface) : undefined, text: first(text) };
  }, [title, preface, text, isCorrection]);
  const ambiguous = !!(ambiguousBy.title || ambiguousBy.preface || ambiguousBy.text);

  const refreshStatus = useCallback(async (id: string) => {
    const s = await api<StatusResponse>(`/api/revisions/${id}/status`);
    statusRef.current = s;
    setStatus(s);
    return s;
  }, []);

  const adopt = (id: string, nextVersion: number) => {
    revisionIdRef.current = id;
    versionRef.current = nextVersion;
    setRevisionId(id);
    setVersion(nextVersion);
  };

  // One request at a time, newest edit last. A correction draft is created on the first real change.
  const performSave = async (d: Form) => {
    if (!d.title.trim() || !d.text.trim()) throw new NotSaveable("Add a title and notice text to save.");
    const id = revisionIdRef.current;
    if (!id) {
      if (unchangedFromBase(d)) return;
      const res = await api<{ revisionId: string; version: number }>(`/api/notices/${props.noticeId}/revisions`, {
        method: "POST",
        // The token makes a retried create return this draft instead of starting a second one.
        body: { title: d.title, text: d.text, voiceId: d.voiceId, updatePreface: d.preface || null, sourceUrl: d.sourceUrl || null, clientToken: clientToken.current },
      });
      adopt(res.revisionId, res.version);
      await refreshStatus(res.revisionId);
      return;
    }
    const res = await api<{ version: number }>(`/api/revisions/${id}`, {
      method: "PATCH",
      body: {
        title: d.title,
        text: d.text,
        voiceId: d.voiceId,
        updatePreface: isCorrection ? d.preface || null : null,
        expectedVersion: versionRef.current ?? undefined,
        sourceUrl: d.sourceUrl || null,
      },
    });
    adopt(id, res.version);
    // "Saved" is only reported once the status shown matches what was just saved.
    await refreshStatus(id);
  };
  // The saver outlives renders but always runs the newest closure. Both are set up in effects, never during render.
  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });
  const saverRef = useRef<SerialSaver<Form> | null>(null);
  const saver = () => saverRef.current!;
  useEffect(() => {
    saverRef.current = createSerialSaver<Form>({
      save: (d) => performSaveRef.current(d),
      onState: (state, err) => {
        if (state !== "error") {
          setSave(state);
          if (state === "saved") setError(null);
          return;
        }
        if (err instanceof ApiFailure && err.error.code === "conflict") {
          const reason = err.error.details?.reason;
          setSave("conflict");
          setDialog({ kind: reason === "stale_version" ? "stale" : "published", message: err.message });
        } else if (err instanceof ApiFailure && err.error.code === "notice_withdrawn") {
          setSave("conflict");
          setDialog({ kind: "published", message: err.message });
        } else {
          setSave("error");
          setError(err instanceof NotSaveable || err instanceof ApiFailure ? (err as Error).message : "Could not save your changes.");
        }
      },
    });
  }, []);

  const edit = (patch: Partial<Form>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setForm(next);
    setConfirmedFor(null);
    saver().submit(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saver().flush();
    }, 700);
    // The spoken preview is out of date as of this keystroke. A new one is requested once typing pauses.
    syncRef.current?.touch();
  };

  /** Sends every pending edit. Resolves to the revision id once it is saved, or null if it could not be. */
  const flush = async (): Promise<string | null> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const ok = await saver().flush();
    return ok ? revisionIdRef.current : null;
  };

  useEffect(() => {
    if (!revisionId) return;
    let live = true;
    api<StatusResponse>(`/api/revisions/${revisionId}/status`)
      .then((s) => {
        if (!live) return;
        statusRef.current = s;
        setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [revisionId]);

  // Work that outlives one request (a reopened page, another tab, a request that was cut off) is followed
  // by polling rather than a single look.
  const synthesizing = status?.status === "synthesizing";
  const stuck = !!status?.synthesis && status.synthesis.claimedAgoMs >= status.synthesis.staleAfterMs;
  useEffect(() => {
    if (!synthesizing || !revisionId) return;
    let live = true;
    const t = setInterval(() => {
      api<StatusResponse>(`/api/revisions/${revisionId}/status`)
        .then((s) => {
          if (!live) return;
          statusRef.current = s;
          setStatus(s);
        })
        .catch(() => {});
    }, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [synthesizing, revisionId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving" || save === "error" || save === "conflict" || phase !== "idle") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save, phase]);

  // A save that failed because the connection dropped is retried when it comes back.
  useEffect(() => {
    const retry = () => {
      if (saver().state === "error" && !(saver().error instanceof NotSaveable)) void saver().flush();
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  /** Why no spoken preview is requested for the current text, or null when one should be. */
  const speechBlocker = (f: Form, hasRevision: boolean): string | null => {
    if (!props.provider.ok) return props.provider.reason ?? "The voice is unavailable right now.";
    if (!f.title.trim() || !f.text.trim()) return "Add a title and the announcement to hear it.";
    if (f.text.trim().length < MIN_SPOKEN_CHARS) return "Keep writing: the spoken preview starts once there is a sentence to read.";
    const first = (v: string) => detectCriticalFacts(v).find((x) => x.ambiguous);
    if (first(f.title) || first(f.text) || (isCorrection && first(f.preface))) return "Say which day or time you mean, then the voice can be prepared.";
    if (unchangedFromBase(f) && !hasRevision) return "Change the announcement and the corrected voice will be prepared for you.";
    return null;
  };

  /** One speech request: save what is typed, then ask for audio for exactly that text. Runs only through the sync controller. */
  const speak = async () => {
    const startedWith = formKey(latest.current);
    const id = await flush();
    if (!id) return; // not saveable yet, or the save failed; the save status says which
    const f = latest.current;
    if (formKey(f) !== startedWith) return; // typed while saving: the controller schedules the next request
    if (speechBlocker(f, !!revisionIdRef.current)) return;
    const current = statusRef.current;
    if (current?.status === "preview_ready" && current.version === versionRef.current) return; // this exact text already has its voice
    if (failedKey.current === formKey(f)) return; // failed for this exact text: wait for an edit or the Retry button
    const generation = syncRef.current?.generation ?? 0;
    setSpeechError(null);
    setGenerating(true);
    try {
      await api(`/api/revisions/${id}/generate`, { method: "POST" });
      failedKey.current = null;
    } catch (e) {
      const stale = (syncRef.current?.generation ?? 0) !== generation; // edited meanwhile: whatever happened to the old text no longer matters
      if (e instanceof ApiFailure && (e.error.code === "synthesis_in_progress" || e.error.details?.reason === "superseded_audio")) {
        // Another request owns this text, or the text moved on. The newer request, or the status poll, has the answer.
      } else if (stale) {
        // An old request failed; the newer text will be requested on its own.
      } else if (e instanceof ApiFailure && e.error.code === "conflict") {
        setDialog({ kind: "published", message: e.message });
      } else {
        failedKey.current = formKey(f);
        setSpeechError(e instanceof ApiFailure ? e.message : "The voice could not be prepared.");
      }
    }
    await refreshStatus(id).catch(() => {});
    setGenerating(false);
  };
  const speakRef = useRef(speak);
  useEffect(() => {
    speakRef.current = speak;
  });
  useEffect(() => {
    const sync = createSpeechSync({
      delayMs: AUTO_SPEECH_DELAY_MS,
      run: () => speakRef.current(),
      onChange: () => setWaiting(sync.pending),
    });
    syncRef.current = sync;
    // A draft that was saved but never spoken (a new announcement, or one reopened) is prepared straight away.
    let starter: ReturnType<typeof setTimeout> | null = null;
    if (props.draft?.status === "draft") starter = setTimeout(() => sync.now(), 300);
    return () => {
      if (starter) clearTimeout(starter);
      sync.cancel();
      syncRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; it always calls the newest speak() through the ref
  }, []);

  /** The Retry audio button: ask again now for the current text. */
  const retryAudio = () => {
    failedKey.current = null;
    setSpeechError(null);
    syncRef.current?.now();
  };

  const approve = async () => {
    if (!revisionId || version == null) return;
    setError(null);
    setPhase("publishing");
    try {
      const res = await api<{ revisionNumber: number }>(`/api/revisions/${revisionId}/approve`, {
        method: "POST",
        // Names the saved version whose audio was previewed; a newer save makes the server refuse.
        body: { confirmedCriticalFacts: true, expectedVersion: version },
      });
      router.push(`/app/notices/${props.noticeId}?published=${res.revisionNumber}`);
      router.refresh();
    } catch (e) {
      setPhase("idle");
      if (e instanceof ApiFailure && e.error.code === "conflict") {
        setDialog({ kind: e.error.details?.reason === "stale_version" ? "stale" : "published", message: e.message });
      } else setError(e instanceof ApiFailure ? e.message : "Publishing failed. The previous version is still live.");
      if (revisionId) refreshStatus(revisionId).catch(() => {});
    }
  };

  /** Keep my edits: adopt the server's current version number, then send the newest local edit over it. */
  const keepMine = async () => {
    const id = revisionIdRef.current;
    if (!id) return;
    try {
      const s = await refreshStatus(id);
      if (!["draft", "failed", "preview_ready"].includes(s.status)) {
        setDialog({ kind: "published", message: "This draft was published or discarded in another session." });
        return;
      }
      versionRef.current = s.version;
      setVersion(s.version);
      setDialog(null);
      saver().submit(latest.current);
      await saver().flush();
    } catch (e) {
      setDialog(null);
      setError(e instanceof ApiFailure ? e.message : "Could not reach AfterSend. Try again.");
    }
  };

  // Ready means: nothing unsaved, and the preview on screen belongs to exactly the version that was saved.
  const ready = status?.status === "preview_ready" && !!status.previewUrl && save === "saved" && status.version === version;
  const previewUrl = ready ? status?.previewUrl ?? null : null;
  const listened = !!previewUrl && listenedFor === previewUrl;
  const confirmed = !!previewUrl && confirmedFor === previewUrl;
  const lastAttempt = status?.attempts[0];
  const busy = phase !== "idle";
  // Text stays editable while the voice is being prepared; only publishing freezes it.
  const locked = busy;
  const blocker = speechBlocker(form, !!revisionId);
  const voiceLabel = props.voices.find((v) => v.id === voiceId)?.label ?? null;

  type Kind = "idle" | "saving" | "waiting" | "updating" | "ready" | "failed" | "blocked";
  const failedMessage =
    speechError ??
    (stuck
      ? "Preparing the voice seems to have stalled. Your text is safe."
      : status?.status === "failed"
        ? lastAttempt?.errorMessage ?? "The voice could not be prepared."
        : null);
  const kind: Kind =
    save === "dirty" || save === "saving"
      ? "saving"
      : generating || (synthesizing && !stuck)
        ? "updating"
        : ready
          ? "ready"
          : failedMessage && !blocker
            ? "failed"
            : blocker
              ? "blocked"
              : waiting || !status || status.status === "draft"
                ? "waiting"
                : "idle";

  const kindLabel: Record<Kind, string> = {
    idle: "Ready when you are",
    saving: "Saving…",
    waiting: "Voice out of date · updating when you pause",
    updating: "Updating voice…",
    ready: "Ready to listen",
    failed: "Voice update failed",
    blocked: blocker ?? "",
  };

  const approveBlocker = !props.provider.ok
    ? "The voice is unavailable right now."
    : !ready
      ? "Publishing unlocks once the spoken preview of this version is ready."
      : !listened
        ? "Listen to the whole preview to continue."
        : !confirmed
          ? "Tick the box to confirm you checked the details."
          : null;

  const approveLabel = isCorrection ? "Update announcement" : "Publish announcement";
  const saveLabel =
    save === "saving"
      ? "Saving…"
      : save === "dirty"
        ? "Unsaved changes"
        : save === "error"
          ? "Not saved"
          : save === "conflict"
            ? "Conflict: not saved"
            : revisionId
              ? "Saved"
              : "No changes yet";

  return (
    <div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
            <span className="text-muted">{isCorrection ? "Updating the live announcement" : "New announcement"}</span>
            <span aria-live="polite" className="font-mono text-faint">
              {saveLabel}
              {save === "error" ? (
                <button type="button" className="ml-2 text-signal underline underline-offset-4" onClick={() => void saver().flush()}>
                  Retry
                </button>
              ) : null}
            </span>
          </div>

          <a
            href="#preview"
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-muted lg:hidden"
            aria-hidden="true"
            tabIndex={-1}
          >
            {kind === "updating" || kind === "saving" ? <Spinner className="size-3.5" /> : <Wave className="size-3.5 text-signal" />}
            <span className="min-w-0 flex-1 truncate">{kindLabel[kind]}</span>
            <span className="text-fg">Jump to preview ↓</span>
          </a>

          <div>
            <label htmlFor="title" className="field-label">
              Title
            </label>
            <input
              id="title"
              className="input text-[17px]"
              value={title}
              maxLength={MAX_TITLE_CHARS}
              onChange={(e) => edit({ title: e.target.value })}
              disabled={locked}
              placeholder="e.g. Early pickup on Friday"
              aria-invalid={!!ambiguousBy.title}
              aria-describedby={ambiguousBy.title ? "title-problem" : undefined}
            />
            <FieldProblem id="title-problem" fact={ambiguousBy.title} />
          </div>
          <div>
            <label htmlFor="text" className="field-label">
              Announcement
            </label>
            <textarea
              id="text"
              className="input min-h-[240px] resize-y leading-[1.65]"
              value={text}
              maxLength={MAX_NOTICE_CHARS}
              onChange={(e) => edit({ text: e.target.value })}
              disabled={locked}
              aria-invalid={!!ambiguousBy.text}
              aria-describedby={ambiguousBy.text ? "text-problem" : "text-hint"}
            />
            <FieldProblem id="text-problem" fact={ambiguousBy.text} />
            <p id="text-hint" className="field-hint">
              Listeners hear exactly this text after the title. The voice updates by itself when you stop typing.
            </p>
          </div>
          <div>
            <label htmlFor="source" className="field-label">
              Source link <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="source"
              type="url"
              className="input"
              value={sourceUrl}
              onChange={(e) => edit({ sourceUrl: e.target.value })}
              placeholder="https://"
              disabled={locked}
            />
            {props.noticeState !== "draft" ? <p className="field-hint">A changed link goes live when you update the announcement, not before.</p> : null}
          </div>
          <FactsPanel text={text} changedValues={changes.map((c) => c.currentValue ?? "")} />

          {isCorrection ? (
            <section aria-labelledby="diff-heading" className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="diff-heading" className="text-[15px] font-medium">
                  What is changing
                </h3>
              </div>
              {changes.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {changes.map((c, i) => (
                    <li key={i} className="pill border-line-strong py-1 text-[13px] text-fg">
                      <span className="text-faint capitalize">{c.kind}</span>
                      <span className="text-removed line-through decoration-removed/60">{c.previousValue ?? "—"}</span>
                      <span aria-hidden>→</span>
                      <span className="sr-only">changed to</span>
                      <span className="text-signal">{c.currentValue ?? "removed"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <DiffView before={base!.displayText} after={text} />
              <div className="border-t border-line pt-4">
                <label htmlFor="preface" className="field-label">
                  Spoken correction note <span className="font-normal text-muted">(optional, read first)</span>
                </label>
                <input
                  id="preface"
                  className="input"
                  value={preface}
                  maxLength={300}
                  onChange={(e) => edit({ preface: e.target.value })}
                  placeholder="e.g. Update: Pickup is now at 4:00 PM."
                  disabled={locked}
                  aria-invalid={!!ambiguousBy.preface}
                  aria-describedby={ambiguousBy.preface ? "preface-problem" : undefined}
                />
                <FieldProblem id="preface-problem" fact={ambiguousBy.preface} />
                {suggestion && suggestion !== preface ? (
                  <button
                    type="button"
                    className="mt-2 text-left text-[13.5px] text-signal underline-offset-4 hover:underline"
                    onClick={() => edit({ preface: suggestion })}
                    disabled={locked}
                  >
                    Use suggestion: “{suggestion}”
                  </button>
                ) : null}
                <p className="field-hint">Only what you write here is read aloud. AfterSend never adds a reason for the change.</p>
              </div>
            </section>
          ) : null}
        </div>

        <aside id="preview" aria-labelledby="spoken-heading" className="min-w-0 scroll-mt-20 lg:sticky lg:top-24 lg:self-start">
          <div className="card space-y-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 id="spoken-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]">
                <Wave className="size-[18px] text-signal" /> Spoken preview
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
                onChange={(e) => edit({ voiceId: e.target.value })}
                disabled={locked || props.voices.length === 0}
              >
                {props.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-line bg-ink-2 p-4" data-speech={kind}>
              <p role="status" aria-live="polite" className="flex items-start gap-2 text-[14px] leading-5 text-muted">
                {kind === "updating" || kind === "saving" ? (
                  <Spinner className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${kind === "ready" ? "bg-signal" : kind === "failed" ? "bg-danger" : kind === "waiting" ? "bg-warn" : "bg-line-strong"}`}
                    aria-hidden
                  />
                )}
                <span>{kindLabel[kind]}</span>
              </p>
              <AnimatePresence mode="wait" initial={false}>
                {previewUrl ? (
                  <motion.div key={previewUrl} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="mt-3">
                    <AudioPlayer key={previewUrl} src={previewUrl} label="spoken preview" durationHintMs={status?.audio?.durationMs} onListened={() => setListenedFor(previewUrl)} compact />
                    <p className="mt-3 text-[12.5px] leading-5 text-faint">
                      {formatDuration(status?.audio?.durationMs)}
                      {voiceLabel ? ` · ${voiceLabel}` : ""}
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {kind === "failed" && failedMessage ? (
                <div className="mt-3 space-y-3">
                  <p className="text-[13.5px] leading-5 text-danger">{failedMessage} Your text is saved.</p>
                  <button type="button" className="btn-secondary btn-sm" onClick={retryAudio} disabled={generating}>
                    Retry audio
                  </button>
                </div>
              ) : null}
            </div>

            <details className="group rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13.5px] text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                Exactly what is read aloud
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
                onChange={(e) => setConfirmedFor(e.target.checked ? previewUrl : null)}
              />
              I listened to this preview and checked the dates, times, places and phone numbers.
            </label>

            <button
              type="button"
              onClick={approve}
              disabled={busy || !!approveBlocker}
              aria-describedby="approve-help"
              className="btn-primary h-12 w-full"
            >
              {phase === "publishing" ? <Spinner /> : <Check />}
              {approveLabel}
            </button>
            <p className="text-[13px] leading-5 text-faint" id="approve-help">
              {approveBlocker ?? (isCorrection ? "The same link will play this version for everyone." : "You get a link to share. Nothing is public until you do this.")}
            </p>
            {isCorrection ? (
              <Link href={props.publicPath} target="_blank" className="btn-ghost btn-sm -ml-3">
                <External /> Open the live announcement
              </Link>
            ) : null}
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {dialog ? <ConflictDialog dialog={dialog} noticeId={props.noticeId} onClose={() => setDialog(null)} onKeepMine={keepMine} /> : null}
      </AnimatePresence>
    </div>
  );
}

/** Names the one problem next to the control that has it. */
function FieldProblem({ id, fact }: { id: string; fact: { value: string; note?: string } | undefined }) {
  if (!fact) return null;
  return (
    <p id={id} className="mt-1.5 flex gap-1.5 text-[13.5px] leading-5 text-danger">
      <Alert className="mt-0.5 size-4 shrink-0" />
      <span>
        “{fact.value}”: {fact.note ?? "check this date."}
      </span>
    </p>
  );
}

/**
 * Modal that keeps keyboard focus inside while open, closes on Escape, and hands focus back to the control
 * that was active before it opened.
 */
function ConflictDialog({
  dialog,
  noticeId,
  onClose,
  onKeepMine,
}: {
  dialog: NonNullable<Dialog>;
  noticeId: string;
  onClose: () => void;
  onKeepMine: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusables()[focusables().length - 1]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!panel.current?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handler only needs to be installed once per open
  }, []);

  const stale = dialog.kind === "stale";
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        ref={panel}
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
          {stale ? "This draft changed somewhere else" : "A newer version was published"}
        </h2>
        <p id="conflict-body" className="mt-2 text-[15px] leading-6 text-muted">
          {dialog.message}{" "}
          {stale
            ? "Your edits here are not saved yet. Nothing has been overwritten."
            : "Your draft was not published, and nothing was overwritten."}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {stale ? (
            <button type="button" className="btn-secondary btn-sm" onClick={onKeepMine}>
              Save my edits over it
            </button>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
              Keep my draft
            </button>
          )}
          {stale ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => window.location.reload()}>
              Load the latest
            </button>
          ) : (
            <Link href={`/app/notices/${noticeId}`} className="btn-primary btn-sm">
              Review latest version
            </Link>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
