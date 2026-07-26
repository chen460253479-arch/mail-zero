CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "integration";
--> statement-breakpoint
CREATE SCHEMA "mail";
--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration"."authorization_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"auth_source" text NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_credential_snapshot" text,
	"access_token_expires_at" timestamp with time zone,
	"credential_fetched_at" timestamp with time zone,
	"nango_connection_id" text,
	"nango_provider_config_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "authorization_binding_connection_id_unique" UNIQUE("connection_id"),
	CONSTRAINT "authorization_binding_nango_ref_uidx" UNIQUE("nango_provider_config_key","nango_connection_id"),
	CONSTRAINT "authorization_auth_source_chk" CHECK ("integration"."authorization_binding"."auth_source" IN ('zero_oauth', 'nango', 'manual')),
	CONSTRAINT "authorization_credential_type_chk" CHECK ("integration"."authorization_binding"."credential_type" IN ('oauth2', 'basic', 'custom')),
	CONSTRAINT "authorization_nango_reference_chk" CHECK ((
        "integration"."authorization_binding"."auth_source" = 'nango'
        AND "integration"."authorization_binding"."nango_connection_id" IS NOT NULL
        AND "integration"."authorization_binding"."nango_provider_config_key" IS NOT NULL
      ) OR (
        "integration"."authorization_binding"."auth_source" <> 'nango'
        AND "integration"."authorization_binding"."nango_connection_id" IS NULL
        AND "integration"."authorization_binding"."nango_provider_config_key" IS NULL
      )),
	CONSTRAINT "authorization_credential_material_chk" CHECK ((
        "integration"."authorization_binding"."auth_source" = 'nango'
      ) OR (
        "integration"."authorization_binding"."auth_source" = 'zero_oauth'
        AND "integration"."authorization_binding"."credential_type" = 'oauth2'
        AND "integration"."authorization_binding"."encrypted_credential_snapshot" IS NOT NULL
      ) OR (
        "integration"."authorization_binding"."auth_source" = 'manual'
        AND "integration"."authorization_binding"."credential_type" IN ('basic', 'custom')
        AND "integration"."authorization_binding"."encrypted_credential_snapshot" IS NOT NULL
        AND "integration"."authorization_binding"."access_token_expires_at" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "integration"."channel_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"auth_source" text NOT NULL,
	"external_integration_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_mapping_channel_auth_uidx" UNIQUE("channel_id","auth_source"),
	CONSTRAINT "channel_mapping_auth_source_chk" CHECK ("integration"."channel_mapping"."auth_source" = 'nango')
);
--> statement-breakpoint
CREATE TABLE "integration"."connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"name" text,
	"picture" text,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"disconnected_at" timestamp with time zone,
	"provider_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connection_user_channel_email_uidx" UNIQUE("user_id","channel_id","normalized_email"),
	CONSTRAINT "connection_id_user_id_uidx" UNIQUE("id","user_id"),
	CONSTRAINT "connection_status_chk" CHECK ("integration"."connection"."status" IN ('connected', 'disconnected', 'reconnect_required', 'deleting')),
	CONSTRAINT "connection_provider_key_chk" CHECK ("integration"."connection"."provider_key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "app"."early_access" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"is_early_access" boolean DEFAULT false NOT NULL,
	"has_used_ticket" text DEFAULT '',
	CONSTRAINT "early_access_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app"."email_template" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text,
	"to" jsonb,
	"cc" jsonb,
	"bcc" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_template_user_id_name_uidx" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "integration"."oauth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_key" text NOT NULL,
	"purpose" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"state_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_session_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "oauth_session_integration_key_chk" CHECK ("integration"."oauth_session"."integration_key" = 'gmail_zero_oauth'),
	CONSTRAINT "oauth_session_purpose_chk" CHECK ("integration"."oauth_session"."purpose" IN ('validate_config', 'connect_mailbox'))
);
--> statement-breakpoint
CREATE TABLE "auth"."jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."note" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"content" text NOT NULL,
	"color" text DEFAULT 'default' NOT NULL,
	"is_pinned" boolean DEFAULT false,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"client_id" text,
	"user_id" text,
	"scopes" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "oauth_access_token_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "oauth_access_token_refresh_token_unique" UNIQUE("refresh_token")
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_application" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"icon" text,
	"metadata" text,
	"client_id" text,
	"client_secret" text,
	"redirect_u_r_ls" text,
	"type" text,
	"disabled" boolean,
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "oauth_application_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"user_id" text,
	"scopes" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"consent_given" boolean
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app"."summary" (
	"message_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"connection_id" text NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"tags" text,
	"suggested_reply" text,
	CONSTRAINT "summary_pk" PRIMARY KEY("connection_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "integration"."system_config" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_key" text NOT NULL,
	"public_config" jsonb NOT NULL,
	"encrypted_secret" text NOT NULL,
	"status" text NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "system_config_integration_key_unique" UNIQUE("integration_key"),
	CONSTRAINT "system_integration_key_chk" CHECK ("integration"."system_config"."integration_key" IN ('nango', 'gmail_zero_oauth')),
	CONSTRAINT "system_integration_status_chk" CHECK ("integration"."system_config"."status" IN ('active', 'error'))
);
--> statement-breakpoint
CREATE TABLE "auth"."user_account" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"default_connection_id" text,
	"custom_prompt" text,
	"phone_number" text,
	"phone_number_verified" boolean,
	CONSTRAINT "user_account_email_unique" UNIQUE("email"),
	CONSTRAINT "user_account_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "app"."user_hotkeys" (
	"user_id" text PRIMARY KEY NOT NULL,
	"shortcuts" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."user_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"settings" jsonb DEFAULT '{"language":"en","timezone":"UTC","dynamicContent":false,"externalImages":true,"customPrompt":"","trustedSenders":[],"isOnboarded":false,"colorTheme":"system","zeroSignature":true,"autoRead":true,"defaultEmailAlias":"","categories":[{"id":"Important","name":"Important","searchValue":"IMPORTANT","order":0,"icon":"Lightning","isDefault":false},{"id":"All Mail","name":"All Mail","searchValue":"","order":1,"icon":"Mail","isDefault":true},{"id":"Unread","name":"Unread","searchValue":"UNREAD","order":5,"icon":"ScanEye","isDefault":false}],"undoSendEnabled":false,"imageCompression":"medium","animations":false}'::jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app"."writing_style_matrix" (
	"connectionId" text NOT NULL,
	"numMessages" integer NOT NULL,
	"style" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "writing_style_matrix_pk" PRIMARY KEY("connectionId")
);
--> statement-breakpoint
CREATE TABLE "mail"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"state_version" bigint DEFAULT 0 NOT NULL,
	"oldest_retained_state" bigint DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"storage_quota_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_account_id_connection_uidx" UNIQUE("id","connection_id"),
	CONSTRAINT "mail_account_status_check" CHECK ("mail"."account"."status" IN ('active', 'suspended', 'deleting')),
	CONSTRAINT "mail_account_state_nonnegative_check" CHECK ("mail"."account"."state_version" >= 0 AND "mail"."account"."oldest_retained_state" >= 0),
	CONSTRAINT "mail_account_retention_floor_check" CHECK ("mail"."account"."oldest_retained_state" <= "mail"."account"."state_version"),
	CONSTRAINT "mail_account_quota_nonnegative_check" CHECK ("mail"."account"."storage_quota_bytes" IS NULL OR "mail"."account"."storage_quota_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."identity" (
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
CREATE TABLE "mail"."blob" (
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
	CONSTRAINT "blob_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "blob_status_check" CHECK ("mail"."blob"."status" IN ('pending', 'ready', 'deleting')),
	CONSTRAINT "blob_size_nonnegative_check" CHECK ("mail"."blob"."size_bytes" >= 0),
	CONSTRAINT "blob_lifecycle_check" CHECK (("mail"."blob"."status" = 'pending' AND "mail"."blob"."ready_at" IS NULL AND "mail"."blob"."deleted_at" IS NULL)
          OR ("mail"."blob"."status" = 'ready' AND "mail"."blob"."ready_at" IS NOT NULL AND "mail"."blob"."deleted_at" IS NULL)
          OR ("mail"."blob"."status" = 'deleting' AND "mail"."blob"."ready_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mail"."change" (
	"mail_account_id" text NOT NULL,
	"state_version" bigint NOT NULL,
	"collection" text NOT NULL,
	"entity_id" text NOT NULL,
	"change_type" text NOT NULL,
	"changed_properties" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_change_pk" PRIMARY KEY("mail_account_id","state_version","collection","entity_id"),
	CONSTRAINT "mail_change_collection_check" CHECK ("mail"."change"."collection" IN ('mailbox', 'email', 'thread', 'identity', 'email_submission')),
	CONSTRAINT "mail_change_type_check" CHECK ("mail"."change"."change_type" IN ('created', 'updated', 'destroyed')),
	CONSTRAINT "mail_change_state_positive_check" CHECK ("mail"."change"."state_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."email" (
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
	"normalized_subject" text NOT NULL,
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
	CONSTRAINT "email_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "email_lifecycle_check" CHECK ("mail"."email"."lifecycle" IN ('draft', 'received', 'sent')),
	CONSTRAINT "email_size_nonnegative_check" CHECK ("mail"."email"."size_bytes" >= 0),
	CONSTRAINT "email_draft_revision_nonnegative_check" CHECK ("mail"."email"."draft_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."email_address" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	CONSTRAINT "email_address_pk" PRIMARY KEY("mail_account_id","email_id","kind","position"),
	CONSTRAINT "email_address_kind_check" CHECK ("mail"."email_address"."kind" IN ('sender', 'from', 'to', 'cc', 'bcc', 'reply_to')),
	CONSTRAINT "email_address_position_nonnegative_check" CHECK ("mail"."email_address"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."email_content" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"parser_version" integer NOT NULL,
	"text_blob_id" text,
	"html_blob_id" text,
	"preview" text,
	"parse_warnings" text[],
	"parsed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_content_pk" PRIMARY KEY("mail_account_id","email_id"),
	CONSTRAINT "email_content_parser_version_positive_check" CHECK ("mail"."email_content"."parser_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."email_keyword" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"keyword" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "email_keyword_pk" PRIMARY KEY("email_id","keyword"),
	CONSTRAINT "email_keyword_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position"),
	CONSTRAINT "email_keyword_position_nonnegative_check" CHECK ("mail"."email_keyword"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."email_mailbox" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "email_mailbox_pk" PRIMARY KEY("email_id","mailbox_id"),
	CONSTRAINT "email_mailbox_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position"),
	CONSTRAINT "email_mailbox_position_nonnegative_check" CHECK ("mail"."email_mailbox"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."email_part" (
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
	CONSTRAINT "email_part_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position"),
	CONSTRAINT "email_part_position_nonnegative_check" CHECK ("mail"."email_part"."position" >= 0),
	CONSTRAINT "email_part_size_nonnegative_check" CHECK ("mail"."email_part"."size_bytes" >= 0),
	CONSTRAINT "email_part_disposition_check" CHECK ("mail"."email_part"."disposition" IS NULL OR "mail"."email_part"."disposition" IN ('inline', 'attachment')),
	CONSTRAINT "email_part_kind_check" CHECK ("mail"."email_part"."kind" IN ('body', 'inline', 'attachment'))
);
--> statement-breakpoint
CREATE TABLE "mail"."email_search" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"document" "tsvector" NOT NULL,
	CONSTRAINT "email_search_pk" PRIMARY KEY("mail_account_id","email_id")
);
--> statement-breakpoint
CREATE TABLE "mail"."email_trash_restore" (
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "email_trash_restore_pk" PRIMARY KEY("email_id","mailbox_id"),
	CONSTRAINT "email_trash_restore_account_email_position_uidx" UNIQUE("mail_account_id","email_id","position"),
	CONSTRAINT "email_trash_restore_position_nonnegative_check" CHECK ("mail"."email_trash_restore"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integration"."remote_email" (
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
CREATE TABLE "mail"."mailbox" (
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
	CONSTRAINT "mailbox_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "mailbox_kind_check" CHECK ("mail"."mailbox"."kind" IN ('system', 'folder', 'label')),
	CONSTRAINT "mailbox_role_check" CHECK ("mail"."mailbox"."role" IS NULL OR "mail"."mailbox"."role" IN ('inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'outbox', 'scheduled')),
	CONSTRAINT "mailbox_counters_nonnegative_check" CHECK ("mail"."mailbox"."total_emails" >= 0
          AND "mail"."mailbox"."unread_emails" >= 0
          AND "mail"."mailbox"."total_threads" >= 0
          AND "mail"."mailbox"."unread_threads" >= 0
          AND "mail"."mailbox"."unread_emails" <= "mail"."mailbox"."total_emails"
          AND "mail"."mailbox"."unread_threads" <= "mail"."mailbox"."total_threads")
);
--> statement-breakpoint
CREATE TABLE "mail"."mailbox_thread" (
	"mail_account_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"email_count" integer NOT NULL,
	"unread_count" integer NOT NULL,
	CONSTRAINT "mailbox_thread_pk" PRIMARY KEY("mail_account_id","mailbox_id","thread_id"),
	CONSTRAINT "mailbox_thread_counters_positive_check" CHECK ("mail"."mailbox_thread"."email_count" > 0 AND "mail"."mailbox_thread"."unread_count" >= 0),
	CONSTRAINT "mailbox_thread_unread_within_total_check" CHECK ("mail"."mailbox_thread"."unread_count" <= "mail"."mailbox_thread"."email_count")
);
--> statement-breakpoint
CREATE TABLE "mail"."submission" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"email_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"status" text NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"draft_revision" integer NOT NULL,
	"provider_message_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_submission_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "email_submission_status_check" CHECK ("mail"."submission"."status" IN ('scheduled', 'queued', 'sent', 'failed', 'canceled')),
	CONSTRAINT "email_submission_draft_revision_nonnegative_check" CHECK ("mail"."submission"."draft_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."submission_blob" (
	"mail_account_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"blob_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"object_key" text NOT NULL,
	CONSTRAINT "submission_blob_account_submission_kind_position_uidx" UNIQUE("mail_account_id","submission_id","kind","position"),
	CONSTRAINT "submission_blob_kind_check" CHECK ("mail"."submission_blob"."kind" IN ('raw', 'text', 'html', 'part')),
	CONSTRAINT "submission_blob_position_nonnegative_check" CHECK ("mail"."submission_blob"."position" >= 0),
	CONSTRAINT "submission_blob_size_nonnegative_check" CHECK ("mail"."submission_blob"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail"."thread" (
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
	CONSTRAINT "thread_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "thread_counters_nonnegative_check" CHECK ("mail"."thread"."email_count" >= 0 AND "mail"."thread"."unread_count" >= 0),
	CONSTRAINT "thread_unread_within_total_check" CHECK ("mail"."thread"."unread_count" <= "mail"."thread"."email_count")
);
--> statement-breakpoint
CREATE TABLE "mail"."thread_reference" (
	"mail_account_id" text NOT NULL,
	"normalized_subject_hash" text NOT NULL,
	"message_id_hash" text NOT NULL,
	"email_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_reference_pk" PRIMARY KEY("mail_account_id","normalized_subject_hash","message_id_hash","email_id")
);
--> statement-breakpoint
CREATE TABLE "integration"."inbound_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"scope_key" text NOT NULL,
	"scope" jsonb NOT NULL,
	"checkpoint" jsonb,
	"status" text DEFAULT 'activating' NOT NULL,
	"subscription_expires_at" timestamp with time zone,
	"last_signal_at" timestamp with time zone,
	"last_discovered_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_sync_status_chk" CHECK ("integration"."inbound_sync"."status" IN ('activating', 'active', 'paused', 'auth_error')),
	CONSTRAINT "inbound_sync_scope_version_chk" CHECK (CASE
        WHEN jsonb_typeof("integration"."inbound_sync"."scope"->'version') = 'number'
        THEN ("integration"."inbound_sync"."scope"->>'version')::numeric >= 1
          AND mod(("integration"."inbound_sync"."scope"->>'version')::numeric, 1) = 0
        ELSE false
      END),
	CONSTRAINT "inbound_sync_checkpoint_version_chk" CHECK ("integration"."inbound_sync"."checkpoint" IS NULL OR (
        CASE
          WHEN jsonb_typeof("integration"."inbound_sync"."checkpoint"->'version') = 'number'
          THEN ("integration"."inbound_sync"."checkpoint"->>'version')::numeric >= 1
            AND mod(("integration"."inbound_sync"."checkpoint"->>'version')::numeric, 1) = 0
          ELSE false
        END
      )),
	CONSTRAINT "inbound_sync_active_checkpoint_chk" CHECK ("integration"."inbound_sync"."status" <> 'active' OR "integration"."inbound_sync"."checkpoint" IS NOT NULL),
	CONSTRAINT "inbound_sync_lease_pair_chk" CHECK (("integration"."inbound_sync"."lease_owner" IS NULL) = ("integration"."inbound_sync"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "integration"."inbound_sync_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbound_sync_attempt_outcome_chk" CHECK ("integration"."inbound_sync_attempt"."outcome" IN ('retry', 'imported', 'failed')),
	CONSTRAINT "inbound_sync_attempt_finished_chk" CHECK ("integration"."inbound_sync_attempt"."finished_at" >= "integration"."inbound_sync_attempt"."started_at")
);
--> statement-breakpoint
CREATE TABLE "integration"."inbound_sync_item" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_id" text NOT NULL,
	"remote_message_id" text NOT NULL,
	"remote_thread_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"local_email_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_sync_item_status_chk" CHECK ("integration"."inbound_sync_item"."status" IN ('pending', 'processing', 'imported', 'failed')),
	CONSTRAINT "inbound_sync_item_attempt_count_chk" CHECK ("integration"."inbound_sync_item"."attempt_count" >= 0),
	CONSTRAINT "inbound_sync_item_lease_pair_chk" CHECK (("integration"."inbound_sync_item"."lease_owner" IS NULL) = ("integration"."inbound_sync_item"."lease_expires_at" IS NULL)),
	CONSTRAINT "inbound_sync_item_processing_lease_chk" CHECK (("integration"."inbound_sync_item"."status" = 'processing') = ("integration"."inbound_sync_item"."lease_owner" IS NOT NULL)),
	CONSTRAINT "inbound_sync_item_imported_state_chk" CHECK (("integration"."inbound_sync_item"."status" = 'imported') = (
        "integration"."inbound_sync_item"."local_email_id" IS NOT NULL AND "integration"."inbound_sync_item"."imported_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "integration"."outbound_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"status" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"reconciliation_count" integer DEFAULT 0 NOT NULL,
	"uncertain_since" timestamp with time zone,
	"last_error_kind" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbound_delivery_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "outbound_delivery_account_submission_uidx" UNIQUE("mail_account_id","submission_id"),
	CONSTRAINT "outbound_delivery_id_account_submission_uidx" UNIQUE("id","mail_account_id","submission_id"),
	CONSTRAINT "outbound_delivery_status_chk" CHECK ("integration"."outbound_delivery"."status" IN ('scheduled', 'ready', 'leased', 'retry_wait', 'uncertain', 'completed', 'failed', 'canceled')),
	CONSTRAINT "outbound_delivery_counters_chk" CHECK ("integration"."outbound_delivery"."attempt_count" >= 0 AND "integration"."outbound_delivery"."reconciliation_count" >= 0),
	CONSTRAINT "outbound_delivery_lease_lifecycle_chk" CHECK ((
        "integration"."outbound_delivery"."status" = 'leased'
        AND "integration"."outbound_delivery"."lease_owner" IS NOT NULL
        AND "integration"."outbound_delivery"."lease_token" IS NOT NULL
        AND "integration"."outbound_delivery"."lease_expires_at" IS NOT NULL
      ) OR (
        "integration"."outbound_delivery"."status" <> 'leased'
        AND "integration"."outbound_delivery"."lease_owner" IS NULL
        AND "integration"."outbound_delivery"."lease_token" IS NULL
        AND "integration"."outbound_delivery"."lease_expires_at" IS NULL
      )),
	CONSTRAINT "outbound_delivery_uncertain_lifecycle_chk" CHECK (("integration"."outbound_delivery"."status" = 'uncertain' AND "integration"."outbound_delivery"."uncertain_since" IS NOT NULL)
        OR ("integration"."outbound_delivery"."status" <> 'uncertain')),
	CONSTRAINT "outbound_delivery_completed_lifecycle_chk" CHECK (("integration"."outbound_delivery"."status" = 'completed' AND "integration"."outbound_delivery"."completed_at" IS NOT NULL)
        OR ("integration"."outbound_delivery"."status" <> 'completed' AND "integration"."outbound_delivery"."completed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "integration"."send_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_account_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"kind" text NOT NULL,
	"lease_token" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"provider_code" text,
	"safe_response" text,
	"retry_at" timestamp with time zone,
	"remote_message_id" text,
	"remote_thread_id" text,
	CONSTRAINT "send_attempt_id_account_uidx" UNIQUE("id","mail_account_id"),
	CONSTRAINT "send_attempt_account_delivery_number_uidx" UNIQUE("mail_account_id","delivery_id","attempt_number"),
	CONSTRAINT "send_attempt_kind_chk" CHECK ("integration"."send_attempt"."kind" IN ('send', 'reconcile')),
	CONSTRAINT "send_attempt_outcome_chk" CHECK ("integration"."send_attempt"."outcome" IS NULL OR "integration"."send_attempt"."outcome" IN ('sent', 'transient_failure', 'permanent_failure', 'uncertain', 'not_found')),
	CONSTRAINT "send_attempt_number_positive_chk" CHECK ("integration"."send_attempt"."attempt_number" > 0),
	CONSTRAINT "send_attempt_lifecycle_chk" CHECK (("integration"."send_attempt"."finished_at" IS NULL AND "integration"."send_attempt"."outcome" IS NULL)
        OR ("integration"."send_attempt"."finished_at" IS NOT NULL AND "integration"."send_attempt"."outcome" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."authorization_binding" ADD CONSTRAINT "authorization_binding_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "integration"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."connection" ADD CONSTRAINT "connection_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_template" ADD CONSTRAINT "email_template_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."oauth_session" ADD CONSTRAINT "oauth_session_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."note" ADD CONSTRAINT "note_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."note" ADD CONSTRAINT "note_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "integration"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."summary" ADD CONSTRAINT "summary_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "integration"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."system_config" ADD CONSTRAINT "system_config_updated_by_user_account_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_hotkeys" ADD CONSTRAINT "user_hotkeys_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_settings" ADD CONSTRAINT "user_settings_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."writing_style_matrix" ADD CONSTRAINT "writing_style_matrix_connectionId_connection_id_fk" FOREIGN KEY ("connectionId") REFERENCES "integration"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."account" ADD CONSTRAINT "account_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."account" ADD CONSTRAINT "mail_account_connection_user_fk" FOREIGN KEY ("connection_id","user_id") REFERENCES "integration"."connection"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."identity" ADD CONSTRAINT "identity_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."blob" ADD CONSTRAINT "blob_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."change" ADD CONSTRAINT "change_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email" ADD CONSTRAINT "email_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email" ADD CONSTRAINT "email_identity_account_fk" FOREIGN KEY ("identity_id","mail_account_id") REFERENCES "mail"."identity"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email" ADD CONSTRAINT "email_thread_account_fk" FOREIGN KEY ("thread_id","mail_account_id") REFERENCES "mail"."thread"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email" ADD CONSTRAINT "email_reply_account_fk" FOREIGN KEY ("reply_to_email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email" ADD CONSTRAINT "email_blob_account_fk" FOREIGN KEY ("blob_id","mail_account_id") REFERENCES "mail"."blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_address" ADD CONSTRAINT "email_address_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_address" ADD CONSTRAINT "email_address_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_content" ADD CONSTRAINT "email_content_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_content" ADD CONSTRAINT "email_content_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_content" ADD CONSTRAINT "email_content_text_blob_account_fk" FOREIGN KEY ("text_blob_id","mail_account_id") REFERENCES "mail"."blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_content" ADD CONSTRAINT "email_content_html_blob_account_fk" FOREIGN KEY ("html_blob_id","mail_account_id") REFERENCES "mail"."blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_keyword" ADD CONSTRAINT "email_keyword_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_keyword" ADD CONSTRAINT "email_keyword_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_mailbox" ADD CONSTRAINT "email_mailbox_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_mailbox" ADD CONSTRAINT "email_mailbox_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_mailbox" ADD CONSTRAINT "email_mailbox_mailbox_account_fk" FOREIGN KEY ("mailbox_id","mail_account_id") REFERENCES "mail"."mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_part" ADD CONSTRAINT "email_part_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_part" ADD CONSTRAINT "email_part_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_part" ADD CONSTRAINT "email_part_parent_account_fk" FOREIGN KEY ("parent_part_id","email_id","mail_account_id") REFERENCES "mail"."email_part"("id","email_id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_part" ADD CONSTRAINT "email_part_blob_account_fk" FOREIGN KEY ("blob_id","mail_account_id") REFERENCES "mail"."blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_search" ADD CONSTRAINT "email_search_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_search" ADD CONSTRAINT "email_search_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_trash_restore" ADD CONSTRAINT "email_trash_restore_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_trash_restore" ADD CONSTRAINT "email_trash_restore_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."email_trash_restore" ADD CONSTRAINT "email_trash_restore_mailbox_account_fk" FOREIGN KEY ("mailbox_id","mail_account_id") REFERENCES "mail"."mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."remote_email" ADD CONSTRAINT "remote_email_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."remote_email" ADD CONSTRAINT "remote_email_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."mailbox" ADD CONSTRAINT "mailbox_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."mailbox" ADD CONSTRAINT "mailbox_parent_account_fk" FOREIGN KEY ("parent_id","mail_account_id") REFERENCES "mail"."mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."mailbox_thread" ADD CONSTRAINT "mailbox_thread_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."mailbox_thread" ADD CONSTRAINT "mailbox_thread_mailbox_account_fk" FOREIGN KEY ("mailbox_id","mail_account_id") REFERENCES "mail"."mailbox"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."mailbox_thread" ADD CONSTRAINT "mailbox_thread_thread_account_fk" FOREIGN KEY ("thread_id","mail_account_id") REFERENCES "mail"."thread"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."submission" ADD CONSTRAINT "submission_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."submission" ADD CONSTRAINT "email_submission_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."submission" ADD CONSTRAINT "email_submission_identity_account_fk" FOREIGN KEY ("identity_id","mail_account_id") REFERENCES "mail"."identity"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."submission_blob" ADD CONSTRAINT "submission_blob_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."submission_blob" ADD CONSTRAINT "submission_blob_submission_account_fk" FOREIGN KEY ("submission_id","mail_account_id") REFERENCES "mail"."submission"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."submission_blob" ADD CONSTRAINT "submission_blob_blob_account_fk" FOREIGN KEY ("blob_id","mail_account_id") REFERENCES "mail"."blob"("id","mail_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."thread" ADD CONSTRAINT "thread_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."thread_reference" ADD CONSTRAINT "thread_reference_mail_account_id_account_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."thread_reference" ADD CONSTRAINT "thread_reference_email_account_fk" FOREIGN KEY ("email_id","mail_account_id") REFERENCES "mail"."email"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail"."thread_reference" ADD CONSTRAINT "thread_reference_thread_account_fk" FOREIGN KEY ("thread_id","mail_account_id") REFERENCES "mail"."thread"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."inbound_sync" ADD CONSTRAINT "inbound_sync_account_fk" FOREIGN KEY ("account_id") REFERENCES "mail"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."inbound_sync_attempt" ADD CONSTRAINT "inbound_sync_attempt_item_fk" FOREIGN KEY ("item_id") REFERENCES "integration"."inbound_sync_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."inbound_sync_item" ADD CONSTRAINT "inbound_sync_item_sync_fk" FOREIGN KEY ("sync_id") REFERENCES "integration"."inbound_sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."outbound_delivery" ADD CONSTRAINT "outbound_delivery_account_connection_fk" FOREIGN KEY ("mail_account_id","connection_id") REFERENCES "mail"."account"("id","connection_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."outbound_delivery" ADD CONSTRAINT "outbound_delivery_submission_account_fk" FOREIGN KEY ("submission_id","mail_account_id") REFERENCES "mail"."submission"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."send_attempt" ADD CONSTRAINT "send_attempt_delivery_account_submission_fk" FOREIGN KEY ("delivery_id","mail_account_id","submission_id") REFERENCES "integration"."outbound_delivery"("id","mail_account_id","submission_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration"."send_attempt" ADD CONSTRAINT "send_attempt_submission_account_fk" FOREIGN KEY ("submission_id","mail_account_id") REFERENCES "mail"."submission"("id","mail_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "auth"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_user_id_idx" ON "auth"."account" USING btree ("provider_id","user_id");--> statement-breakpoint
CREATE INDEX "account_expires_at_idx" ON "auth"."account" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE INDEX "connection_provider_key_idx" ON "integration"."connection" USING btree ("provider_key");--> statement-breakpoint
CREATE INDEX "early_access_is_early_access_idx" ON "app"."early_access" USING btree ("is_early_access");--> statement-breakpoint
CREATE INDEX "email_template_user_id_idx" ON "app"."email_template" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "integration_oauth_session_expires_at_idx" ON "integration"."oauth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "integration_oauth_session_created_by_idx" ON "integration"."oauth_session" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "jwks_created_at_idx" ON "auth"."jwks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "note_connection_id_idx" ON "app"."note" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "note_user_connection_thread_idx" ON "app"."note" USING btree ("user_id","connection_id","thread_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_id_idx" ON "auth"."oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_id_idx" ON "auth"."oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_expires_at_idx" ON "auth"."oauth_access_token" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE INDEX "oauth_application_user_id_idx" ON "auth"."oauth_application" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_application_disabled_idx" ON "auth"."oauth_application" USING btree ("disabled");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_id_idx" ON "auth"."oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_id_idx" ON "auth"."oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_given_idx" ON "auth"."oauth_consent" USING btree ("consent_given");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "auth"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "auth"."session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "summary_connection_id_saved_idx" ON "app"."summary" USING btree ("connection_id","saved");--> statement-breakpoint
CREATE INDEX "user_hotkeys_shortcuts_idx" ON "app"."user_hotkeys" USING btree ("shortcuts");--> statement-breakpoint
CREATE INDEX "user_settings_settings_idx" ON "app"."user_settings" USING btree ("settings");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "auth"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "auth"."verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "writing_style_matrix_style_idx" ON "app"."writing_style_matrix" USING btree ("style");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_account_connection_id_uidx" ON "mail"."account" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "mail_account_user_id_idx" ON "mail"."account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_identity_account_default_active_uidx" ON "mail"."identity" USING btree ("mail_account_id") WHERE "mail"."identity"."is_default" = true AND "mail"."identity"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mail_identity_account_created_active_idx" ON "mail"."identity" USING btree ("mail_account_id","created_at","id") WHERE "mail"."identity"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blob_account_sha_size_uidx" ON "mail"."blob" USING btree ("mail_account_id","sha256","size_bytes");--> statement-breakpoint
CREATE INDEX "blob_account_object_key_idx" ON "mail"."blob" USING btree ("mail_account_id","object_key");--> statement-breakpoint
CREATE INDEX "blob_account_created_id_idx" ON "mail"."blob" USING btree ("mail_account_id","created_at","id");--> statement-breakpoint
CREATE INDEX "blob_account_status_content_created_idx" ON "mail"."blob" USING btree ("mail_account_id","status","content_type","created_at","id");--> statement-breakpoint
CREATE INDEX "email_account_received_id_idx" ON "mail"."email" USING btree ("mail_account_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_account_sent_id_idx" ON "mail"."email" USING btree ("mail_account_id","sent_at","id");--> statement-breakpoint
CREATE INDEX "email_account_size_id_idx" ON "mail"."email" USING btree ("mail_account_id","size_bytes","id");--> statement-breakpoint
CREATE INDEX "email_account_normalized_subject_id_idx" ON "mail"."email" USING btree ("mail_account_id","normalized_subject","id");--> statement-breakpoint
CREATE INDEX "email_blob_account_idx" ON "mail"."email" USING btree ("blob_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_identity_account_idx" ON "mail"."email" USING btree ("identity_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_reply_account_idx" ON "mail"."email" USING btree ("reply_to_email_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_account_thread_received_id_idx" ON "mail"."email" USING btree ("mail_account_id","thread_id","received_at","id");--> statement-breakpoint
CREATE INDEX "email_address_account_normalized_kind_email_idx" ON "mail"."email_address" USING btree ("mail_account_id","normalized_email","kind","email_id");--> statement-breakpoint
CREATE INDEX "email_content_text_blob_account_idx" ON "mail"."email_content" USING btree ("text_blob_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_content_html_blob_account_idx" ON "mail"."email_content" USING btree ("html_blob_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_keyword_account_keyword_email_idx" ON "mail"."email_keyword" USING btree ("mail_account_id","keyword","email_id");--> statement-breakpoint
CREATE INDEX "email_mailbox_account_mailbox_email_idx" ON "mail"."email_mailbox" USING btree ("mail_account_id","mailbox_id","email_id");--> statement-breakpoint
CREATE INDEX "email_part_parent_email_account_idx" ON "mail"."email_part" USING btree ("parent_part_id","email_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_part_blob_account_idx" ON "mail"."email_part" USING btree ("blob_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_search_document_gin_idx" ON "mail"."email_search" USING gin ("document");--> statement-breakpoint
CREATE INDEX "email_trash_restore_account_email_mailbox_idx" ON "mail"."email_trash_restore" USING btree ("mail_account_id","email_id","mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "remote_email_account_provider_remote_uidx" ON "integration"."remote_email" USING btree ("mail_account_id","provider","remote_email_id");--> statement-breakpoint
CREATE INDEX "remote_email_email_account_idx" ON "integration"."remote_email" USING btree ("email_id","mail_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_account_role_active_uidx" ON "mail"."mailbox" USING btree ("mail_account_id","role") WHERE "mail"."mailbox"."role" IS NOT NULL AND "mail"."mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_active_sibling_name_uidx" ON "mail"."mailbox" USING btree ("mail_account_id","parent_id","normalized_name") WHERE "mail"."mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_active_root_name_uidx" ON "mail"."mailbox" USING btree ("mail_account_id","normalized_name") WHERE "mail"."mailbox"."parent_id" IS NULL AND "mail"."mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mailbox_account_sort_active_idx" ON "mail"."mailbox" USING btree ("mail_account_id","sort_order","id") WHERE "mail"."mailbox"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mailbox_thread_account_thread_idx" ON "mail"."mailbox_thread" USING btree ("mail_account_id","thread_id");--> statement-breakpoint
CREATE INDEX "email_submission_account_status_send_idx" ON "mail"."submission" USING btree ("mail_account_id","status","send_at");--> statement-breakpoint
CREATE INDEX "email_submission_account_created_id_idx" ON "mail"."submission" USING btree ("mail_account_id","created_at","id");--> statement-breakpoint
CREATE INDEX "email_submission_account_identity_created_id_idx" ON "mail"."submission" USING btree ("mail_account_id","identity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "email_submission_email_account_idx" ON "mail"."submission" USING btree ("email_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "email_submission_identity_account_idx" ON "mail"."submission" USING btree ("identity_id","mail_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_submission_account_idempotency_uidx" ON "mail"."submission" USING btree ("mail_account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "submission_blob_account_blob_idx" ON "mail"."submission_blob" USING btree ("mail_account_id","blob_id");--> statement-breakpoint
CREATE INDEX "thread_account_latest_id_idx" ON "mail"."thread" USING btree ("mail_account_id","latest_received_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "thread_reference_account_thread_idx" ON "mail"."thread_reference" USING btree ("mail_account_id","thread_id");--> statement-breakpoint
CREATE INDEX "thread_reference_account_email_idx" ON "mail"."thread_reference" USING btree ("mail_account_id","email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_sync_account_provider_scope_uidx" ON "integration"."inbound_sync" USING btree ("account_id","provider","scope_key");--> statement-breakpoint
CREATE INDEX "inbound_sync_due_reconcile_idx" ON "integration"."inbound_sync" USING btree ("last_reconciled_at","id") WHERE "integration"."inbound_sync"."status" = 'active';--> statement-breakpoint
CREATE INDEX "inbound_sync_due_renewal_idx" ON "integration"."inbound_sync" USING btree ("subscription_expires_at","id") WHERE "integration"."inbound_sync"."status" = 'active' AND "integration"."inbound_sync"."subscription_expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inbound_sync_lease_idx" ON "integration"."inbound_sync" USING btree ("lease_expires_at","id") WHERE "integration"."inbound_sync"."lease_expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_sync_attempt_item_number_uidx" ON "integration"."inbound_sync_attempt" USING btree ("item_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_sync_item_remote_message_uidx" ON "integration"."inbound_sync_item" USING btree ("sync_id","remote_message_id");--> statement-breakpoint
CREATE INDEX "inbound_sync_item_pending_idx" ON "integration"."inbound_sync_item" USING btree ("sync_id","next_attempt_at","id") WHERE "integration"."inbound_sync_item"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "inbound_sync_item_due_pending_idx" ON "integration"."inbound_sync_item" USING btree ("next_attempt_at","sync_id") WHERE "integration"."inbound_sync_item"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "inbound_sync_item_lease_idx" ON "integration"."inbound_sync_item" USING btree ("lease_expires_at","id") WHERE "integration"."inbound_sync_item"."lease_expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbound_delivery_due_idx" ON "integration"."outbound_delivery" USING btree ("status","available_at","id") WHERE "integration"."outbound_delivery"."status" IN ('scheduled', 'ready', 'retry_wait', 'uncertain');--> statement-breakpoint
CREATE INDEX "outbound_delivery_expired_lease_idx" ON "integration"."outbound_delivery" USING btree ("lease_expires_at","id") WHERE "integration"."outbound_delivery"."status" = 'leased';--> statement-breakpoint
CREATE UNIQUE INDEX "send_attempt_open_delivery_uidx" ON "integration"."send_attempt" USING btree ("mail_account_id","delivery_id") WHERE "integration"."send_attempt"."finished_at" IS NULL AND "integration"."send_attempt"."kind" = 'send';