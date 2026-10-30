ALTER TABLE "notice_revisions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notice_revisions" ADD COLUMN "synthesis_claim" text;--> statement-breakpoint
ALTER TABLE "notice_revisions" ADD COLUMN "client_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_notice_client_token_idx" ON "notice_revisions" USING btree ("notice_id","client_token") WHERE "notice_revisions"."client_token" is not null;