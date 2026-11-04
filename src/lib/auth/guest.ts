import "server-only";
import { createWorkspaceUser, startSession } from "./session";
import { createNotice } from "../notices/revision-service";
import { sampleNotice } from "../notices/samples";
import { speechProvider } from "../speech";

/**
 * Starts a guest session: a private publishing space tied to this browser, with a sample announcement already in it as an
 * unpublished draft. The sample is ordinary text that the guest can replace completely. A normal "create" guest is not
 * marked as demo data; the dedicated judge route passes `demo: true` so its sample is labelled wherever it appears. Speech
 * for the draft is prepared by the editor itself, so the guest hears real speech without pressing anything.
 */
export async function startGuestSession({ demo = false }: { demo?: boolean } = {}) {
  const userId = await createWorkspaceUser("demo", "Guest");
  await startSession(userId);
  const voice = speechProvider().listVoices()[0];
  if (!voice) return { userId, noticeId: null };
  const sample = sampleNotice();
  const { noticeId } = await createNotice(userId, { title: sample.title, text: sample.text, sourceUrl: null, voiceId: voice.id }, { isDemo: demo });
  return { userId, noticeId };
}
