import "server-only";
import { createWorkspaceUser, startSession } from "./session";
import { createNotice } from "../notices/revision-service";
import { SAMPLE_NOTICE } from "../notices/samples";
import { speechProvider } from "../speech";

/**
 * Creates an isolated judge workspace with the labelled sample notice as an unpublished draft.
 * The draft has no audio: the judge generates it with a real synthesis request.
 */
export async function startDemoWorkspace() {
  const userId = await createWorkspaceUser("demo", "Demo workspace");
  await startSession(userId);
  const voice = speechProvider().listVoices()[0];
  if (!voice) return { userId, noticeId: null };
  const { noticeId } = await createNotice(
    userId,
    { title: SAMPLE_NOTICE.title, text: SAMPLE_NOTICE.text, sourceUrl: null, voiceId: voice.id },
    { isDemo: true },
  );
  return { userId, noticeId };
}
