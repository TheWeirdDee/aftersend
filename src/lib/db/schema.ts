import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["workspace", "demo"] }).notNull(),
  displayName: text("display_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token is never stored.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const notices = pgTable(
  "notices",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicToken: text("public_token").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    timezone: text("timezone").notNull().default("Africa/Lagos"),
    currentRevisionId: text("current_revision_id"),
    state: text("state", { enum: ["draft", "published", "withdrawn"] }).notNull().default("draft"),
    isDemo: boolean("is_demo").notNull().default(false),
    withdrawnAt: ts("withdrawn_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notices_public_token_idx").on(t.publicToken), index("notices_owner_idx").on(t.ownerId)],
);

export type UpdateSummary = {
  changedField: string;
  previousValue: string | null;
  currentValue: string;
};

export const noticeRevisions = pgTable(
  "notice_revisions",
  {
    id: text("id").primaryKey(),
    noticeId: text("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    // Assigned only when the revision is published, so published numbers stay contiguous.
    revisionNumber: integer("revision_number"),
    // The revision that was current when this draft was started; used for compare-and-swap on approval.
    baseRevisionId: text("base_revision_id"),
    title: text("title").notNull(),
    displayText: text("display_text").notNull(),
    speechText: text("speech_text").notNull(),
    updatePreface: text("update_preface"),
    updateSummary: jsonb("update_summary").$type<UpdateSummary[]>(),
    confirmedCriticalFacts: boolean("confirmed_critical_facts").notNull().default(false),
    voiceId: text("voice_id").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id"),
    requestId: text("request_id"),
    audioAssetId: text("audio_asset_id"),
    // SHA-256 over provider + model + voice + speech text: the idempotency key for synthesis.
    synthesisKey: text("synthesis_key").notNull(),
    status: text("status", {
      enum: ["draft", "queued", "synthesizing", "preview_ready", "failed", "published", "superseded", "discarded"],
    })
      .notNull()
      .default("draft"),
    generatedAt: ts("generated_at"),
    publishedAt: ts("published_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("revisions_notice_idx").on(t.noticeId),
    uniqueIndex("revisions_notice_number_idx")
      .on(t.noticeId, t.revisionNumber)
      .where(sql`${t.revisionNumber} is not null`),
  ],
);

export const audioAssets = pgTable(
  "audio_assets",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => noticeRevisions.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: ["staging", "published"] }).notNull(),
    objectKey: text("object_key").notNull(),
    // 'assemblyai' for real sponsor output; 'test' only for explicitly labelled automated-test audio.
    providerKind: text("provider_kind").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    durationMs: integer("duration_ms"),
    providerLatencyMs: integer("provider_latency_ms"),
    contentReady: boolean("content_ready").notNull().default(false),
    deletedAt: ts("deleted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audio_assets_revision_idx").on(t.revisionId)],
);

export const synthesisAttempts = pgTable(
  "synthesis_attempts",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => noticeRevisions.id, { onDelete: "cascade" }),
    synthesisKey: text("synthesis_key").notNull(),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    modelId: text("model_id"),
    voiceId: text("voice_id").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    firstAudioAt: ts("first_audio_at"),
    completedAt: ts("completed_at"),
    outcome: text("outcome", { enum: ["in_progress", "success", "failed", "cancelled"] }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retries: integer("retries").notNull().default(0),
  },
  (t) => [index("attempts_revision_idx").on(t.revisionId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export type User = typeof users.$inferSelect;
export type Notice = typeof notices.$inferSelect;
export type NoticeRevision = typeof noticeRevisions.$inferSelect;
export type AudioAsset = typeof audioAssets.$inferSelect;
export type SynthesisAttempt = typeof synthesisAttempts.$inferSelect;
