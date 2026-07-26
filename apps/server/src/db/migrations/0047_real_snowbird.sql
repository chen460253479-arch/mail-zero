ALTER TABLE "mail0_email" ADD COLUMN "normalized_subject" text;--> statement-breakpoint
UPDATE "mail0_email"
SET "normalized_subject" = lower(normalize(btrim(coalesce("subject", '')), NFC));--> statement-breakpoint
ALTER TABLE "mail0_email" ALTER COLUMN "normalized_subject" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mail0_email_address" ADD COLUMN "normalized_email" text;--> statement-breakpoint
UPDATE "mail0_email_address"
SET "normalized_email" = lower(normalize(btrim("email"), NFC));--> statement-breakpoint
ALTER TABLE "mail0_email_address" ALTER COLUMN "normalized_email" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "email_account_sent_id_idx" ON "mail0_email" USING btree ("mail_account_id","sent_at","id");--> statement-breakpoint
CREATE INDEX "email_account_size_id_idx" ON "mail0_email" USING btree ("mail_account_id","size_bytes","id");--> statement-breakpoint
CREATE INDEX "email_account_normalized_subject_id_idx" ON "mail0_email" USING btree ("mail_account_id","normalized_subject","id");--> statement-breakpoint
CREATE INDEX "email_address_account_normalized_kind_email_idx" ON "mail0_email_address" USING btree ("mail_account_id","normalized_email","kind","email_id");
