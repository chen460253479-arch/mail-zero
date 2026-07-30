ALTER TABLE "auth"."user_account" ALTER COLUMN "role" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "auth"."user_account" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "auth"."user_account" ADD COLUMN "display_username" text;--> statement-breakpoint
ALTER TABLE "auth"."user_account" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."user_account" ADD CONSTRAINT "user_account_username_unique" UNIQUE("username");