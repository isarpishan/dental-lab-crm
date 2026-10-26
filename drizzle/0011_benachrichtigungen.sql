CREATE TABLE "ddl"."notification_prefs" (
	"practice_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"email_enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_practice_id_event_key_pk" PRIMARY KEY("practice_id","event_key")
);
--> statement-breakpoint
ALTER TABLE "ddl"."jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "ddl"."notification_prefs" ADD CONSTRAINT "notification_prefs_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "ddl"."jobs" USING btree ("dedupe_key","run_after");