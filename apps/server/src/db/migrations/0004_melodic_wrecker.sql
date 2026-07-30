ALTER TABLE "integration"."external_browser_session" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "integration"."external_browser_session" CASCADE;--> statement-breakpoint
ALTER TABLE "integration"."external_access_grant" DROP CONSTRAINT "external_access_grant_owner_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "auth_method" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration"."external_access_grant" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "integration"."external_access_grant" ADD CONSTRAINT "external_access_grant_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_access_grant" DROP COLUMN "owner_user_id";--> statement-breakpoint
ALTER TABLE "integration"."external_access_grant" DROP COLUMN "scopes";