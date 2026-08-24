ALTER TABLE "mail"."notification_outbox" DROP CONSTRAINT "mail_notification_kind_chk";--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ALTER COLUMN "message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD COLUMN "event_type" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD COLUMN "external_submission_id" text;--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD COLUMN "error_message" text;--> statement-breakpoint
CREATE INDEX "mail_notification_external_submission_idx" ON "mail"."notification_outbox" USING btree ("external_submission_id");--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD CONSTRAINT "mail_notification_event_type_chk" CHECK ("mail"."notification_outbox"."event_type" IN ('message', 'submission_status'));--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD CONSTRAINT "mail_notification_payload_chk" CHECK ((
        "mail"."notification_outbox"."event_type" = 'message'
        AND "mail"."notification_outbox"."message_id" IS NOT NULL
        AND "mail"."notification_outbox"."kind" IN ('received', 'sent')
        AND "mail"."notification_outbox"."external_submission_id" IS NULL
        AND "mail"."notification_outbox"."sent_at" IS NULL
        AND "mail"."notification_outbox"."error_code" IS NULL
        AND "mail"."notification_outbox"."error_message" IS NULL
      ) OR (
        "mail"."notification_outbox"."event_type" = 'submission_status'
        AND "mail"."notification_outbox"."external_submission_id" IS NOT NULL
        AND ((
            "mail"."notification_outbox"."kind" = 'sent'
            AND "mail"."notification_outbox"."message_id" IS NOT NULL
            AND "mail"."notification_outbox"."sent_at" IS NOT NULL
            AND "mail"."notification_outbox"."error_code" IS NULL
            AND "mail"."notification_outbox"."error_message" IS NULL
          ) OR (
            "mail"."notification_outbox"."kind" = 'failed'
            AND "mail"."notification_outbox"."sent_at" IS NULL
            AND "mail"."notification_outbox"."error_code" IS NOT NULL
          ))
      ));--> statement-breakpoint
ALTER TABLE "mail"."notification_outbox" ADD CONSTRAINT "mail_notification_kind_chk" CHECK ("mail"."notification_outbox"."kind" IN ('received', 'sent', 'failed'));