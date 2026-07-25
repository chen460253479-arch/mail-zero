CREATE TABLE "mail0_mail_account" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"state_version" bigint DEFAULT 0 NOT NULL,
	"oldest_retained_state" bigint DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"storage_quota_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_mail_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"reply_to" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "mail_identity_id_account_uidx" UNIQUE("id","mail_account_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_blob" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"object_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "blob_id_account_uidx" UNIQUE("id","mail_account_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_mail_change" (
	"mail_account_id" text NOT NULL,
	"state_version" bigint NOT NULL,
	"collection" text NOT NULL,
	"entity_id" text NOT NULL,
	"change_type" text NOT NULL,
	"changed_properties" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_change_pk" PRIMARY KEY("mail_account_id","state_version","collection","entity_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_email" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"identity_id" text,
	"thread_id" text NOT NULL,
	"blob_id" text,
	"message_id_header" text,
	"reply_to_email_id" text,
	"in_reply_to" text[],
	"references" text[],
	"subject" text,
	"preview" text,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"size_bytes" bigint NOT NULL,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"lifecycle" text NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destroyed_at" timestamp with time zone,
	CONSTRAINT "email_id_account_uidx" UNIQUE("id","mail_account_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_search" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"document" tsvector NOT NULL,
	CONSTRAINT "email_search_pk" PRIMARY KEY("mail_account_id","email_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_address" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"name" text,
	"email" text NOT NULL,
	CONSTRAINT "email_address_pk" PRIMARY KEY("mail_account_id","email_id","kind","position")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_content" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"parser_version" integer NOT NULL,
	"text_blob_id" text,
	"html_blob_id" text,
	"preview" text,
	"parse_warnings" text[],
	"parsed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_content_pk" PRIMARY KEY("mail_account_id","email_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_keyword" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"keyword" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "email_keyword_pk" PRIMARY KEY("email_id","keyword"),
	CONSTRAINT "email_keyword_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_mailbox" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "email_mailbox_pk" PRIMARY KEY("email_id","mailbox_id"),
	CONSTRAINT "email_mailbox_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_part" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"position" integer NOT NULL,
	"parent_part_id" text,
	"part_path" text NOT NULL,
	"content_type" text NOT NULL,
	"charset" text,
	"disposition" text,
	"filename" text,
	"content_id" text,
	"blob_id" text,
	"size_bytes" bigint NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "email_part_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "email_part_id_email_account_uidx" UNIQUE("id","email_id","mail_account_id"),
	CONSTRAINT "email_part_account_email_path_uidx" UNIQUE("mail_account_id","email_id","part_path"),
	CONSTRAINT "email_part_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_trash_restore" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "email_trash_restore_pk" PRIMARY KEY("email_id","mailbox_id"),
	CONSTRAINT "email_trash_restore_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position")
);
--> statement-breakpoint
CREATE TABLE "mail0_remote_email" (
	"mail_account_id" text NOT NULL,
	"provider" text NOT NULL,
	"remote_email_id" text NOT NULL,
	"remote_thread_id" text,
	"email_id" text NOT NULL,
	"content_fingerprint" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_mailbox" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"kind" text NOT NULL,
	"role" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_subscribed" boolean DEFAULT true NOT NULL,
	"total_emails" integer DEFAULT 0 NOT NULL,
	"unread_emails" integer DEFAULT 0 NOT NULL,
	"total_threads" integer DEFAULT 0 NOT NULL,
	"unread_threads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "mailbox_id_account_uidx" UNIQUE("id","mail_account_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_email_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"status" text NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"draft_revision" integer NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_submission_id_account_uidx" UNIQUE("id","mail_account_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_submission_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"provider_code" text,
	"safe_response" text,
	"retry_at" timestamp with time zone,
	CONSTRAINT "submission_attempt_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "submission_attempt_account_submission_number_uidx" UNIQUE("mail_account_id","submission_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "mail0_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"normalized_subject" text NOT NULL,
	"latest_received_at" timestamp with time zone NOT NULL,
	"email_count" integer DEFAULT 0 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"participant_summary" text,
	"preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_id_account_uidx" UNIQUE("id","mail_account_id")
);
--> statement-breakpoint
ALTER TABLE "mail0_mail_account" ADD CONSTRAINT "mail_account_status_check" CHECK ("status" IN ('active', 'suspended', 'deleting'));--> statement-breakpoint
ALTER TABLE "mail0_mail_account" ADD CONSTRAINT "mail_account_state_nonnegative_check" CHECK ("state_version" >= 0 AND "oldest_retained_state" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_mail_account" ADD CONSTRAINT "mail_account_retention_floor_check" CHECK ("oldest_retained_state" <= "state_version");--> statement-breakpoint
ALTER TABLE "mail0_mail_account" ADD CONSTRAINT "mail_account_quota_nonnegative_check" CHECK ("storage_quota_bytes" IS NULL OR "storage_quota_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_blob" ADD CONSTRAINT "blob_status_check" CHECK ("status" IN ('pending', 'ready', 'deleting'));--> statement-breakpoint
ALTER TABLE "mail0_blob" ADD CONSTRAINT "blob_size_nonnegative_check" CHECK ("size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_blob" ADD CONSTRAINT "blob_lifecycle_check" CHECK (("status" = 'pending' AND "ready_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'ready' AND "ready_at" IS NOT NULL AND "deleted_at" IS NULL) OR ("status" = 'deleting' AND "ready_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_lifecycle_check" CHECK ("lifecycle" IN ('draft', 'received', 'sent'));--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_size_nonnegative_check" CHECK ("size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_draft_revision_nonnegative_check" CHECK ("draft_revision" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_address" ADD CONSTRAINT "email_address_kind_check" CHECK ("kind" IN ('sender', 'from', 'to', 'cc', 'bcc', 'reply_to'));--> statement-breakpoint
ALTER TABLE "mail0_email_address" ADD CONSTRAINT "email_address_position_nonnegative_check" CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_mailbox" ADD CONSTRAINT "email_mailbox_position_nonnegative_check" CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_trash_restore" ADD CONSTRAINT "email_trash_restore_position_nonnegative_check" CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_keyword" ADD CONSTRAINT "email_keyword_position_nonnegative_check" CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_content" ADD CONSTRAINT "email_content_parser_version_positive_check" CHECK ("parser_version" > 0);--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_position_nonnegative_check" CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_size_nonnegative_check" CHECK ("size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_disposition_check" CHECK ("disposition" IS NULL OR "disposition" IN ('inline', 'attachment'));--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_kind_check" CHECK ("kind" IN ('body', 'inline', 'attachment'));--> statement-breakpoint
ALTER TABLE "mail0_mailbox" ADD CONSTRAINT "mailbox_kind_check" CHECK ("kind" IN ('system', 'folder', 'label'));--> statement-breakpoint
ALTER TABLE "mail0_mailbox" ADD CONSTRAINT "mailbox_role_check" CHECK ("role" IS NULL OR "role" IN ('inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'outbox', 'scheduled'));--> statement-breakpoint
ALTER TABLE "mail0_mailbox" ADD CONSTRAINT "mailbox_counters_nonnegative_check" CHECK ("total_emails" >= 0 AND "unread_emails" >= 0 AND "total_threads" >= 0 AND "unread_threads" >= 0 AND "unread_emails" <= "total_emails" AND "unread_threads" <= "total_threads");--> statement-breakpoint
ALTER TABLE "mail0_thread" ADD CONSTRAINT "thread_counters_nonnegative_check" CHECK ("email_count" >= 0 AND "unread_count" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_thread" ADD CONSTRAINT "thread_unread_within_total_check" CHECK ("unread_count" <= "email_count");--> statement-breakpoint
ALTER TABLE "mail0_email_submission" ADD CONSTRAINT "email_submission_status_check" CHECK ("status" IN ('scheduled', 'queued', 'sending', 'retry_wait', 'sent', 'failed', 'canceled'));--> statement-breakpoint
ALTER TABLE "mail0_email_submission" ADD CONSTRAINT "email_submission_counters_nonnegative_check" CHECK ("draft_revision" >= 0 AND "attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "mail0_submission_attempt" ADD CONSTRAINT "submission_attempt_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('sent', 'transient_failure', 'permanent_failure'));--> statement-breakpoint
ALTER TABLE "mail0_submission_attempt" ADD CONSTRAINT "submission_attempt_number_positive_check" CHECK ("attempt_number" > 0);--> statement-breakpoint
ALTER TABLE "mail0_submission_attempt" ADD CONSTRAINT "submission_attempt_lifecycle_check" CHECK (("finished_at" IS NULL AND "outcome" IS NULL) OR ("finished_at" IS NOT NULL AND "outcome" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "mail0_mail_change" ADD CONSTRAINT "mail_change_collection_check" CHECK ("collection" IN ('mailbox', 'email', 'thread', 'identity', 'email_submission'));--> statement-breakpoint
ALTER TABLE "mail0_mail_change" ADD CONSTRAINT "mail_change_type_check" CHECK ("change_type" IN ('created', 'updated', 'destroyed'));--> statement-breakpoint
ALTER TABLE "mail0_mail_change" ADD CONSTRAINT "mail_change_state_positive_check" CHECK ("state_version" > 0);--> statement-breakpoint
ALTER TABLE "mail0_mail_account" ADD CONSTRAINT "mail0_mail_account_connection_id_mail0_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail0_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mail_account" ADD CONSTRAINT "mail0_mail_account_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mail_identity" ADD CONSTRAINT "mail0_mail_identity_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_blob" ADD CONSTRAINT "mail0_blob_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mail_change" ADD CONSTRAINT "mail0_mail_change_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "mail0_email_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_identity_account_fk" FOREIGN KEY ("identity_id","mail_account_id") REFERENCES "public"."mail0_mail_identity"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_thread_account_fk" FOREIGN KEY ("thread_id","mail_account_id") REFERENCES "public"."mail0_thread"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_reply_account_fk" FOREIGN KEY ("reply_to_email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "email_blob_account_fk" FOREIGN KEY ("blob_id","mail_account_id") REFERENCES "public"."mail0_blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_search" ADD CONSTRAINT "mail0_email_search_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_search" ADD CONSTRAINT "email_search_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_address" ADD CONSTRAINT "mail0_email_address_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_address" ADD CONSTRAINT "email_address_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_content" ADD CONSTRAINT "mail0_email_content_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_content" ADD CONSTRAINT "email_content_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_content" ADD CONSTRAINT "email_content_text_blob_account_fk" FOREIGN KEY ("text_blob_id","mail_account_id") REFERENCES "public"."mail0_blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_content" ADD CONSTRAINT "email_content_html_blob_account_fk" FOREIGN KEY ("html_blob_id","mail_account_id") REFERENCES "public"."mail0_blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_keyword" ADD CONSTRAINT "mail0_email_keyword_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_keyword" ADD CONSTRAINT "email_keyword_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_mailbox" ADD CONSTRAINT "mail0_email_mailbox_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_mailbox" ADD CONSTRAINT "email_mailbox_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_mailbox" ADD CONSTRAINT "email_mailbox_mailbox_account_fk" FOREIGN KEY ("mailbox_id","mail_account_id") REFERENCES "public"."mail0_mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "mail0_email_part_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_parent_account_fk" FOREIGN KEY ("parent_part_id","email_id","mail_account_id") REFERENCES "public"."mail0_email_part"("id","email_id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_part" ADD CONSTRAINT "email_part_blob_account_fk" FOREIGN KEY ("blob_id","mail_account_id") REFERENCES "public"."mail0_blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_trash_restore" ADD CONSTRAINT "mail0_email_trash_restore_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_trash_restore" ADD CONSTRAINT "email_trash_restore_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_trash_restore" ADD CONSTRAINT "email_trash_restore_mailbox_account_fk" FOREIGN KEY ("mailbox_id","mail_account_id") REFERENCES "public"."mail0_mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_remote_email" ADD CONSTRAINT "mail0_remote_email_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_remote_email" ADD CONSTRAINT "remote_email_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mailbox" ADD CONSTRAINT "mail0_mailbox_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mailbox" ADD CONSTRAINT "mailbox_parent_account_fk" FOREIGN KEY ("parent_id","mail_account_id") REFERENCES "public"."mail0_mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_submission" ADD CONSTRAINT "mail0_email_submission_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_submission" ADD CONSTRAINT "email_submission_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "public"."mail0_email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_email_submission" ADD CONSTRAINT "email_submission_identity_account_fk" FOREIGN KEY ("identity_id","mail_account_id") REFERENCES "public"."mail0_mail_identity"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_submission_attempt" ADD CONSTRAINT "mail0_submission_attempt_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_submission_attempt" ADD CONSTRAINT "submission_attempt_submission_account_fk" FOREIGN KEY ("submission_id","mail_account_id") REFERENCES "public"."mail0_email_submission"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_thread" ADD CONSTRAINT "mail0_thread_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_account_connection_id_uidx" ON "mail0_mail_account" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "mail_account_user_id_idx" ON "mail0_mail_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "blob_account_sha_size_idx" ON "mail0_blob" USING btree ("mail_account_id","sha256","size_bytes");--> statement-breakpoint
CREATE INDEX "mail_change_account_state_collection_entity_idx" ON "mail0_mail_change" USING btree ("mail_account_id","state_version","collection","entity_id");--> statement-breakpoint
CREATE INDEX "email_account_received_id_idx" ON "mail0_email" USING btree ("mail_account_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_account_thread_received_id_idx" ON "mail0_email" USING btree ("mail_account_id","thread_id","received_at","id");--> statement-breakpoint
CREATE INDEX "email_search_document_gin_idx" ON "mail0_email_search" USING gin ("document");--> statement-breakpoint
CREATE INDEX "email_keyword_account_keyword_email_idx" ON "mail0_email_keyword" USING btree ("mail_account_id","keyword","email_id");--> statement-breakpoint
CREATE INDEX "email_mailbox_account_mailbox_email_idx" ON "mail0_email_mailbox" USING btree ("mail_account_id","mailbox_id","email_id");--> statement-breakpoint
CREATE INDEX "email_trash_restore_account_email_mailbox_idx" ON "mail0_email_trash_restore" USING btree ("mail_account_id","email_id","mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "remote_email_account_provider_remote_uidx" ON "mail0_remote_email" USING btree ("mail_account_id","provider","remote_email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_account_role_active_uidx" ON "mail0_mailbox" USING btree ("mail_account_id","role") WHERE "mail0_mailbox"."role" IS NOT NULL AND "mail0_mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_active_sibling_name_uidx" ON "mail0_mailbox" USING btree ("mail_account_id","parent_id","normalized_name") WHERE "mail0_mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_active_root_name_uidx" ON "mail0_mailbox" USING btree ("mail_account_id","normalized_name") WHERE "mail0_mailbox"."parent_id" IS NULL AND "mail0_mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "email_submission_account_status_send_idx" ON "mail0_email_submission" USING btree ("mail_account_id","status","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_submission_account_idempotency_uidx" ON "mail0_email_submission" USING btree ("mail_account_id","idempotency_key");
