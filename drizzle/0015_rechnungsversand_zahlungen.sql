CREATE TABLE "ddl"."invoice_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"an" text NOT NULL,
	"job_id" uuid,
	"angefordert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"angefordert_von" uuid,
	"angefordert_von_label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"practice_id" uuid NOT NULL,
	"betrag_cent" integer NOT NULL,
	"eingegangen_am" date NOT NULL,
	"art" text DEFAULT 'ueberweisung' NOT NULL,
	"notiz" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erfasst_von" uuid,
	"erfasst_von_label" text NOT NULL,
	CONSTRAINT "payments_betrag_positiv" CHECK ("ddl"."payments"."betrag_cent" > 0)
);
--> statement-breakpoint
ALTER TABLE "ddl"."practices" ADD COLUMN "billing_email" text;--> statement-breakpoint
ALTER TABLE "ddl"."invoice_dispatches" ADD CONSTRAINT "invoice_dispatches_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "ddl"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."invoice_dispatches" ADD CONSTRAINT "invoice_dispatches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "ddl"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "ddl"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."payments" ADD CONSTRAINT "payments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_dispatches_invoice_idx" ON "ddl"."invoice_dispatches" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "ddl"."payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_practice_idx" ON "ddl"."payments" USING btree ("practice_id");