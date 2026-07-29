CREATE TABLE "integration"."external_access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"code_digest" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration"."external_browser_session" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"token_digest" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"active_connection_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration"."external_access_grant" ADD CONSTRAINT "external_access_grant_owner_user_id_user_account_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_browser_session" ADD CONSTRAINT "external_browser_session_owner_user_id_user_account_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_browser_session" ADD CONSTRAINT "external_browser_session_active_connection_id_connection_id_fk" FOREIGN KEY ("active_connection_id") REFERENCES "integration"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_access_grant_code_digest_uidx" ON "integration"."external_access_grant" USING btree ("code_digest");--> statement-breakpoint
CREATE INDEX "external_access_grant_expires_idx" ON "integration"."external_access_grant" USING btree ("expires_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_browser_session_token_digest_uidx" ON "integration"."external_browser_session" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "external_browser_session_expires_idx" ON "integration"."external_browser_session" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "external_browser_session_owner_idx" ON "integration"."external_browser_session" USING btree ("owner_user_id","updated_at");