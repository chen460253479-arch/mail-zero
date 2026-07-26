CREATE TABLE "mail0_thread_reference" (
	"mail_account_id" text NOT NULL,
	"normalized_subject_hash" text NOT NULL,
	"message_id_hash" text NOT NULL,
	"email_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_reference_pk" PRIMARY KEY("mail_account_id","normalized_subject_hash","message_id_hash","email_id")
);
--> statement-breakpoint
ALTER TABLE "mail0_thread_reference" ADD CONSTRAINT "mail0_thread_reference_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_thread_reference" ADD CONSTRAINT "thread_reference_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_thread_reference" ADD CONSTRAINT "thread_reference_thread_account_fk" FOREIGN KEY ("thread_id","mail_account_id") REFERENCES "public"."mail0_thread"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_reference_account_subject_message_idx" ON "mail0_thread_reference" USING btree ("mail_account_id","normalized_subject_hash","message_id_hash");--> statement-breakpoint
CREATE INDEX "thread_reference_account_thread_idx" ON "mail0_thread_reference" USING btree ("mail_account_id","thread_id");--> statement-breakpoint
CREATE INDEX "thread_reference_account_email_idx" ON "mail0_thread_reference" USING btree ("mail_account_id","email_id");