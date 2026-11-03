ALTER TABLE "notice_revisions" ADD COLUMN "source_url" text;--> statement-breakpoint
-- Existing revisions publish with their notice's current source link, so nothing changes for notices already in use.
UPDATE "notice_revisions" SET "source_url" = (SELECT "notices"."source_url" FROM "notices" WHERE "notices"."id" = "notice_revisions"."notice_id");
