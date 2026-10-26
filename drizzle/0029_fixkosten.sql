CREATE TABLE "ddl"."fixkosten_laeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vorlage_id" uuid NOT NULL,
	"periode" text NOT NULL,
	"faellig_am" date NOT NULL,
	"status" text NOT NULL,
	"expense_id" uuid,
	"privat_buchung_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erledigt_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ddl"."fixkosten_vorlagen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bereich" text NOT NULL,
	"art" text DEFAULT 'ausgabe' NOT NULL,
	"titel" text NOT NULL,
	"gegenpartei" text,
	"kategorie" text NOT NULL,
	"betrag_cent" integer NOT NULL,
	"mwst_satz" smallint,
	"rhythmus" text NOT NULL,
	"ab" date NOT NULL,
	"tag" smallint NOT NULL,
	"bis" date,
	"aktiv" boolean DEFAULT true NOT NULL,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von_label" text NOT NULL,
	"geaendert_am" timestamp with time zone,
	CONSTRAINT "fixkosten_vorlagen_betrag" CHECK ("ddl"."fixkosten_vorlagen"."betrag_cent" > 0),
	CONSTRAINT "fixkosten_vorlagen_tag" CHECK ("ddl"."fixkosten_vorlagen"."tag" between 1 and 31),
	CONSTRAINT "fixkosten_vorlagen_ddl" CHECK ("ddl"."fixkosten_vorlagen"."bereich" = 'privat' or ("ddl"."fixkosten_vorlagen"."art" = 'ausgabe' and "ddl"."fixkosten_vorlagen"."mwst_satz" is not null))
);
--> statement-breakpoint
ALTER TABLE "ddl"."fixkosten_laeufe" ADD CONSTRAINT "fixkosten_laeufe_vorlage_id_fixkosten_vorlagen_id_fk" FOREIGN KEY ("vorlage_id") REFERENCES "ddl"."fixkosten_vorlagen"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."fixkosten_laeufe" ADD CONSTRAINT "fixkosten_laeufe_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "ddl"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."fixkosten_laeufe" ADD CONSTRAINT "fixkosten_laeufe_privat_buchung_id_privat_buchungen_id_fk" FOREIGN KEY ("privat_buchung_id") REFERENCES "ddl"."privat_buchungen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixkosten_laeufe_einmal" ON "ddl"."fixkosten_laeufe" USING btree ("vorlage_id","periode");--> statement-breakpoint
CREATE INDEX "fixkosten_laeufe_status_idx" ON "ddl"."fixkosten_laeufe" USING btree ("status");