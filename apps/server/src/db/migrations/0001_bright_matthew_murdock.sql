CREATE TABLE "integration"."pending_nango_mailbox_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"nango_connection_id" text NOT NULL,
	"nango_provider_config_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_nango_mailbox_binding_channel_chk" CHECK ("integration"."pending_nango_mailbox_binding"."channel_id" = 'zoho_mail')
);
--> statement-breakpoint
ALTER TABLE "integration"."pending_nango_mailbox_binding" ADD CONSTRAINT "pending_nango_mailbox_binding_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_nango_mailbox_binding_ref_uidx" ON "integration"."pending_nango_mailbox_binding" USING btree ("nango_provider_config_key","nango_connection_id");--> statement-breakpoint
CREATE INDEX "pending_nango_mailbox_binding_user_idx" ON "integration"."pending_nango_mailbox_binding" USING btree ("user_id","created_at","id");
