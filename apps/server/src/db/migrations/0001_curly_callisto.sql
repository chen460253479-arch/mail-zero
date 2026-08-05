DROP INDEX "integration"."inbound_sync_subscription_endpoint_token_uidx";--> statement-breakpoint
ALTER TABLE "integration"."authorization_binding" ADD COLUMN "external_data" jsonb;--> statement-breakpoint
CREATE INDEX "inbound_sync_subscription_endpoint_token_idx" ON "integration"."inbound_sync" USING btree ("subscription_endpoint_token_hash");