"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { factChanges, suggestUpdatePreface } from "@/lib/notices/diff";
import { createSerialSaver, type SerialSaver } from "@/lib/client/serial-saver";
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
  isDemo: boolean;
  sourceUrl: string | null;
  base: { revisionId: string; revisionNumber: number; title: string; displayText: string; voiceId: string } | null;
  draft: {
    revisionId: string;
    version: number;
    title: string;
    displayText: string;
    updatePreface: string | null;
    voiceId: string;
  } | null;
  voices: Voice[];
  provider: { ok: boolean; reason: string | null };
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type Phase = "idle" | "preparing" | "synthesizing" | "publishing";
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
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [listened, setListened] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The save loop reads these refs, not state, so a request never acts on a stale render.
  const latest = useRef<Form>(initialForm);
  const revisionIdRef = useRef(revisionId);
  const versionRef = useRef(version);
  const clientToken = useRef(newClientToken());

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
    setListened(false);
    setConfirmed(false);
    saver().submit(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saver().flush();
    }, 700);
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
      .then((s) => live && setStatus(s))
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
        .then((s) => live && setStatus(s))
        .catch(() => {});
    }, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [synthesizing, revisionId]);

  useEffect(() => {
    if (phase !== "synthesizing" && phase !== "preparing") return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

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

  const generate = async () => {
    setError(null);
    setElapsed(0);
    setPhase("preparing");
    const id = await flush();
    if (!id) {
      setPhase("idle");
      if (saver().state !== "error") {
        setError(unchanged ? "Change the notice before generating new audio." : "Save the notice first.");
      }
      return;
    }
    setPhase("synthesizing");
    setListened(false);
    setConfirmed(false);
    try {
      await api(`/api/revisions/${id}/generate`, { method: "POST" });
    } catch (e) {
      if (e instanceof ApiFailure && e.error.code === "synthesis_in_progress") {
        // Another request already owns this exact revision; the status poll follows its result.
      } else if (e instanceof ApiFailure && e.error.code === "conflict") {
        setDialog({ kind: "published", message: e.message });
      } else {
        setError(e instanceof ApiFailure ? e.message : "Audio generation failed.");
      }
    }
    await refreshStatus(id).catch(() => {});
    setPhase("idle");
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
  const spokenRef = useRef<HTMLElement>(null);
  const previewUrl = ready ? status?.previewUrl : null;

  // On narrow screens the player sits below the text; bring it into view once a preview is ready.
  useEffect(() => {
    if (previewUrl && window.matchMedia("(max-width: 1023px)").matches) {
      spokenRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [previewUrl]);
  const lastAttempt = status?.attempts[0];
  const busy = phase !== "idle" || (synthesizing && !stuck);
  // Fields stay locked for as long as a claim exists, even a stalled one: the server refuses edits until it is re-claimed.
  const locked = busy || synthesizing;

  const approveBlocker = !props.provider.ok
    ? "Speech generation is unavailable."
    : !ready
      ? "Generate the audio preview first."
      : !listened
        ? "Play the whole preview before approving."
        : !confirmed
          ? "Confirm you've checked the critical facts."
          : null;

  const generateBlocker = !props.provider.ok
    ? props.provider.reason
    : ambiguous
      ? "Resolve the highlighted date first."
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
              : synthesizing
                ? stuck
                  ? "Generation stalled"
                  : "Synthesizing audio"
                : "No audio generated yet";

  const approveLabel = isCorrection ? "Approve update" : "Approve and publish";

  return (
    <div className="pb-28 lg:pb-0">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
        <div className="min-w-0 space-y-6">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted">
              {isCorrection ? `Correcting version ${base!.revisionNumber}` : "First version"}
              {props.isDemo ? <span className="pill ml-2 border-warn/40 text-warn">Demo data</span> : null}
            </span>
            <span aria-live="polite" className="font-mono text-faint">
              {save === "saving"
                ? "Saving…"
                : save === "dirty"
                  ? "Unsaved changes"
                  : save === "error"
                    ? "Not saved"
                    : save === "conflict"
                      ? "Conflict: not saved"
                      : revisionId
                        ? "Draft saved"
                        : "No changes"}
              {save === "error" ? (
                <button type="button" className="ml-2 text-signal underline underline-offset-4" onClick={() => void saver().flush()}>
                  Retry
                </button>
              ) : null}
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
              onChange={(e) => edit({ title: e.target.value })}
              disabled={locked}
              aria-invalid={!!ambiguousBy.title}
              aria-describedby={ambiguousBy.title ? "title-problem" : undefined}
            />
            <FieldProblem id="title-problem" fact={ambiguousBy.title} />
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
              onChange={(e) => edit({ text: e.target.value })}
              disabled={locked}
              aria-invalid={!!ambiguousBy.text}
              aria-describedby={ambiguousBy.text ? "text-problem" : undefined}
            />
            <FieldProblem id="text-problem" fact={ambiguousBy.text} />
            <p className="field-hint">Listeners hear exactly this text, read aloud after the title.</p>
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
            {props.noticeState !== "draft" ? <p className="field-hint">A changed link goes live when you publish this correction, not before.</p> : null}
          </div>
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
                <p className="field-hint">Only what you write here is spoken. AfterSend never adds a reason for the change.</p>
              </div>
            </section>
          ) : null}
        </div>

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
                <p className="mt-3 text-[13.5px] leading-5 text-danger">{lastAttempt.errorMessage} Your text is safe; generate again to retry.</p>
              ) : null}
              {stuck && phase === "idle" ? (
                <p className="mt-3 text-[13.5px] leading-5 text-warn">
                  Audio generation seems to have stalled. Your text is safe; generate again to retry.
                </p>
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
