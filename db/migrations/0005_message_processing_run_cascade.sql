ALTER TABLE "message_processing" DROP CONSTRAINT "message_processing_run_id_sync_run_id_fk";--> statement-breakpoint
ALTER TABLE "message_processing" ADD CONSTRAINT "message_processing_run_id_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_run"("id") ON DELETE cascade ON UPDATE no action;
