CREATE TABLE "mail0_authorization_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"auth_source" text NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_credential_snapshot" text,
	"access_token_expires_at" timestamp,
	"credential_fetched_at" timestamp,
	"nango_connection_id" text,
	"nango_provider_config_key" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail0_authorization_binding_connection_id_unique" UNIQUE("connection_id"),
	CONSTRAINT "mail0_authorization_binding_nango_provider_config_key_nango_connection_id_unique" UNIQUE("nango_provider_config_key","nango_connection_id")
);
--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD COLUMN "normalized_email" text;--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD COLUMN "status" text DEFAULT 'connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD COLUMN "disconnected_at" timestamp;--> statement-breakpoint
UPDATE "mail0_connection"
SET
	"normalized_email" = lower(trim("email")),
	"channel_id" = CASE "provider_id"
		WHEN 'google' THEN 'gmail'
		WHEN 'microsoft' THEN 'outlook'
	END;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "mail0_connection"
		WHERE "channel_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Cannot migrate mail connections: unsupported legacy provider exists';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "mail0_connection"
		GROUP BY "user_id", "normalized_email"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot migrate mail connections: duplicate normalized mailbox exists';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "mail0_connection" ALTER COLUMN "normalized_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mail0_connection" ALTER COLUMN "channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mail0_authorization_binding" ADD CONSTRAINT "mail0_authorization_binding_connection_id_mail0_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail0_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "mail0_authorization_binding" (
	"id",
	"connection_id",
	"auth_source",
	"credential_type",
	"access_token_expires_at",
	"credential_fetched_at",
	"created_at",
	"updated_at"
)
SELECT
	"id" || ':zero_oauth',
	"id",
	'zero_oauth',
	'oauth2',
	"expires_at",
	"updated_at",
	"created_at",
	"updated_at"
FROM "mail0_connection";--> statement-breakpoint
CREATE INDEX "authorization_connection_id_idx" ON "mail0_authorization_binding" USING btree ("connection_id");--> statement-breakpoint
ALTER TABLE "mail0_connection" DROP CONSTRAINT "mail0_connection_user_id_email_unique";--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD CONSTRAINT "mail0_connection_user_id_normalized_email_unique" UNIQUE("user_id","normalized_email");
