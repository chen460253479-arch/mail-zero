CREATE TABLE "mail0_mailbox_thread" (
	"mail_account_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"email_count" integer NOT NULL,
	"unread_count" integer NOT NULL,
	CONSTRAINT "mailbox_thread_pk" PRIMARY KEY("mail_account_id","mailbox_id","thread_id"),
	CONSTRAINT "mailbox_thread_counters_positive_check" CHECK ("mail0_mailbox_thread"."email_count" > 0 AND "mail0_mailbox_thread"."unread_count" >= 0),
	CONSTRAINT "mailbox_thread_unread_within_total_check" CHECK ("mail0_mailbox_thread"."unread_count" <= "mail0_mailbox_thread"."email_count")
);
--> statement-breakpoint
ALTER TABLE "mail0_mailbox_thread" ADD CONSTRAINT "mail0_mailbox_thread_mail_account_id_mail0_mail_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail0_mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mailbox_thread" ADD CONSTRAINT "mailbox_thread_mailbox_account_fk" FOREIGN KEY ("mailbox_id","mail_account_id") REFERENCES "public"."mail0_mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_mailbox_thread" ADD CONSTRAINT "mailbox_thread_thread_account_fk" FOREIGN KEY ("thread_id","mail_account_id") REFERENCES "public"."mail0_thread"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailbox_thread_account_thread_idx" ON "mail0_mailbox_thread" USING btree ("mail_account_id","thread_id");--> statement-breakpoint
INSERT INTO "mail0_mailbox_thread" (
	"mail_account_id",
	"mailbox_id",
	"thread_id",
	"email_count",
	"unread_count"
)
SELECT
	em."mail_account_id",
	em."mailbox_id",
	e."thread_id",
	count(*)::integer,
	count(*) FILTER (
		WHERE NOT EXISTS (
			SELECT 1
			FROM "mail0_email_keyword" ek
			WHERE ek."mail_account_id" = e."mail_account_id"
				AND ek."email_id" = e."id"
				AND ek."keyword" = '$seen'
		)
	)::integer
FROM "mail0_email_mailbox" em
INNER JOIN "mail0_email" e
	ON e."mail_account_id" = em."mail_account_id"
	AND e."id" = em."email_id"
WHERE e."destroyed_at" IS NULL
GROUP BY em."mail_account_id", em."mailbox_id", e."thread_id";
