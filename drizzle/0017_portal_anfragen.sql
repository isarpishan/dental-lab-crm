CREATE TABLE "ddl"."portal_anfragen" (
	"id" uuid PRIMARY KEY NOT NULL,
	"eingegangen_am" timestamp with time zone NOT NULL,
	"vorname" text NOT NULL,
	"nachname" text NOT NULL,
	"email" text NOT NULL,
	"telefon" text,
	"website_status" text NOT NULL,
	"status" text DEFAULT 'neu' NOT NULL,
	"erledigt_am" timestamp with time zone,
	"erledigt_von" uuid,
	"erledigt_von_label" text,
	"practice_user_id" uuid,
	"abgerufen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddl"."portal_anfragen" ADD CONSTRAINT "portal_anfragen_practice_user_id_practice_users_id_fk" FOREIGN KEY ("practice_user_id") REFERENCES "ddl"."practice_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_anfragen_status_idx" ON "ddl"."portal_anfragen" USING btree ("status","eingegangen_am");--> statement-breakpoint
CREATE INDEX "portal_anfragen_email_idx" ON "ddl"."portal_anfragen" USING btree (lower("email"));