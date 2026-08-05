ALTER TABLE "triage_config" ADD COLUMN "category_intent" jsonb DEFAULT '{"priority":"","review":"","new":"","archive":""}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_config" ALTER COLUMN "category_intent" DROP DEFAULT;
