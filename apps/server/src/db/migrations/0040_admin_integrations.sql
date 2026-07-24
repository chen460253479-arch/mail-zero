CREATE TABLE "mail0_channel_integration_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"auth_source" text NOT NULL,
	"external_integration_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail0_channel_integration_mapping_channel_id_auth_source_unique" UNIQUE("channel_id","auth_source")
);
--> statement-breakpoint
CREATE TABLE "mail0_integration_oauth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_key" text NOT NULL,
	"purpose" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"state_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "mail0_integration_oauth_session_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "mail0_system_integration_config" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_key" text NOT NULL,
	"public_config" jsonb NOT NULL,
	"encrypted_secret" text NOT NULL,
	"status" text NOT NULL,
	"validated_at" timestamp NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail0_system_integration_config_integration_key_unique" UNIQUE("integration_key")
);
--> statement-breakpoint
ALTER TABLE "mail0_integration_oauth_session" ADD CONSTRAINT "mail0_integration_oauth_session_created_by_mail0_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_system_integration_config" ADD CONSTRAINT "mail0_system_integration_config_updated_by_mail0_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."mail0_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_oauth_session_expires_at_idx" ON "mail0_integration_oauth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "integration_oauth_session_created_by_idx" ON "mail0_integration_oauth_session" USING btree ("created_by");