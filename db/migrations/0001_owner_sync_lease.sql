CREATE TABLE "sync_lease" (
	"owner_auth_user_id" text PRIMARY KEY NOT NULL,
	"lease_owner" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"fence_token" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_lease" ADD CONSTRAINT "sync_lease_owner_auth_user_id_owner_binding_auth_user_id_fk" FOREIGN KEY ("owner_auth_user_id") REFERENCES "public"."owner_binding"("auth_user_id") ON DELETE no action ON UPDATE no action;
