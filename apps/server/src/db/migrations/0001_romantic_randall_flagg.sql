CREATE TABLE "integration"."external_mail_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mail_account_id" text NOT NULL,
	"internal_connection_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_connection_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"email_id" text,
	"submission_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "external_mail_submission_status_chk" CHECK ("integration"."external_mail_submission"."status" IN ('accepted', 'preparing', 'submitted', 'failed')),
	CONSTRAINT "external_mail_submission_fingerprint_chk" CHECK ("integration"."external_mail_submission"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "external_mail_submission_link_chk" CHECK (("integration"."external_mail_submission"."status" = 'submitted' AND "integration"."external_mail_submission"."email_id" IS NOT NULL AND "integration"."external_mail_submission"."submission_id" IS NOT NULL) OR "integration"."external_mail_submission"."status" <> 'submitted')
);
--> statement-breakpoint
ALTER TABLE "mail"."task" DROP CONSTRAINT "mail_task_queue_chk";--> statement-breakpoint
ALTER TABLE "integration"."external_mail_submission" ADD CONSTRAINT "external_mail_submission_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_mail_submission" ADD CONSTRAINT "external_mail_submission_connection_user_fk" FOREIGN KEY ("internal_connection_id","user_id") REFERENCES "integration"."connection"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_mail_submission" ADD CONSTRAINT "external_mail_submission_account_connection_fk" FOREIGN KEY ("mail_account_id","internal_connection_id") REFERENCES "mail"."account"("id","connection_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_mail_submission" ADD CONSTRAINT "external_mail_submission_identity_account_fk" FOREIGN KEY ("identity_id","mail_account_id") REFERENCES "mail"."identity"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_mail_submission" ADD CONSTRAINT "external_mail_submission_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."external_mail_submission" ADD CONSTRAINT "external_mail_submission_submission_account_fk" FOREIGN KEY ("submission_id","mail_account_id") REFERENCES "mail"."submission"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_mail_submission_idempotency_uidx" ON "integration"."external_mail_submission" USING btree ("user_id","external_connection_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "external_mail_submission_account_created_idx" ON "integration"."external_mail_submission" USING btree ("mail_account_id","created_at","id");--> statement-breakpoint
CREATE INDEX "external_mail_submission_status_updated_idx" ON "integration"."external_mail_submission" USING btree ("status","updated_at","id");--> statement-breakpoint
ALTER TABLE "mail"."task" ADD CONSTRAINT "mail_task_queue_chk" CHECK ("mail"."task"."queue" IN ('ingress', 'outbound', 'external'));