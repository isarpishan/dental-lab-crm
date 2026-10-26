CREATE TABLE "ddl"."dunning_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"practice_id" uuid NOT NULL,
	"stufe" smallint NOT NULL,
	"offen_cent" integer NOT NULL,
	"frist" date NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" uuid,
	"erstellt_von_label" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"an" text,
	"job_id" uuid,
	CONSTRAINT "dunning_letters_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "dunning_letters_stufe" CHECK ("ddl"."dunning_letters"."stufe" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "ddl"."dunning_letters" ADD CONSTRAINT "dunning_letters_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "ddl"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."dunning_letters" ADD CONSTRAINT "dunning_letters_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."dunning_letters" ADD CONSTRAINT "dunning_letters_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "ddl"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_letters_invoice_stufe_uq" ON "ddl"."dunning_letters" USING btree ("invoice_id","stufe");--> statement-breakpoint
CREATE INDEX "dunning_letters_practice_idx" ON "ddl"."dunning_letters" USING btree ("practice_id");