CREATE TABLE "audio_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"stage" text NOT NULL,
	"object_key" text NOT NULL,
	"provider_kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"duration_ms" integer,
	"provider_latency_ms" integer,
	"content_ready" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_id" text NOT NULL,
	"revision_number" integer,
	"base_revision_id" text,
	"title" text NOT NULL,
	"display_text" text NOT NULL,
	"speech_text" text NOT NULL,
	"update_preface" text,
	"update_summary" jsonb,
	"confirmed_critical_facts" boolean DEFAULT false NOT NULL,
	"voice_id" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text,
	"request_id" text,
	"audio_asset_id" text,
	"synthesis_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"public_token" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"timezone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"current_revision_id" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synthesis_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"synthesis_key" text NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"model_id" text,
	"voice_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_audio_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"retries" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_revision_id_notice_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."notice_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_revisions" ADD CONSTRAINT "notice_revisions_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis_attempts" ADD CONSTRAINT "synthesis_attempts_revision_id_notice_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."notice_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_assets_revision_idx" ON "audio_assets" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "revisions_notice_idx" ON "notice_revisions" USING btree ("notice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_notice_number_idx" ON "notice_revisions" USING btree ("notice_id","revision_number") WHERE "notice_revisions"."revision_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notices_public_token_idx" ON "notices" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "notices_owner_idx" ON "notices" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attempts_revision_idx" ON "synthesis_attempts" USING btree ("revision_id");