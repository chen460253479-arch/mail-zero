CREATE TABLE "mail"."notification_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"mail_account_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mail_notification_kind_chk" CHECK ("mail"."notification_outbox"."kind" IN ('received', 'sent')),
	CONSTRAINT "mail_notification_status_chk" CHECK ("mail"."notification_outbox"."status" IN ('ready', 'running', 'retry', 'dead')),
	CONSTRAINT "mail_notification_attempts_chk" CHECK ("mail"."notification_outbox"."attempts" >= 0 AND "mail"."notification_outbox"."max_attempts" = 10),
	CONSTRAINT "mail_notification_lease_chk" CHECK ((
        "mail"."notification_outbox"."status" = 'running'
        AND "mail"."notification_outbox"."lease_owner" IS NOT NULL
        AND "mail"."notification_outbox"."lease_expires_at" IS NOT NULL
      ) OR (
        "mail"."notification_outbox"."status" <> 'running'
        AND "mail"."notification_outbox"."lease_owner" IS NULL
        AND "mail"."notification_outbox"."lease_expires_at" IS NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD CONSTRAINT "notification_outbox_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD CONSTRAINT "mail_notification_email_account_fk" FOREIGN KEY ("message_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_notification_due_idx" ON "mail"."notification_outbox" USING btree ("status","run_at","event_id") WHERE "mail"."notification_outbox"."status" IN ('ready', 'retry');--> statement-breakpoint
CREATE INDEX "mail_notification_lease_idx" ON "mail"."notification_outbox" USING btree ("lease_expires_at","event_id") WHERE "mail"."notification_outbox"."status" = 'running';--> statement-breakpoint
CREATE INDEX "mail_notification_dead_idx" ON "mail"."notification_outbox" USING btree ("completed_at","event_id") WHERE "mail"."notification_outbox"."status" = 'dead';--> statement-breakpoint
CREATE INDEX "mail_notification_message_idx" ON "mail"."notification_outbox" USING btree ("mail_account_id","message_id");