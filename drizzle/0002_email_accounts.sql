CREATE TABLE "auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"link_user_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "auth_challenges_email_idx" ON "auth_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email") WHERE "users"."email" is not null;