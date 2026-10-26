CREATE TABLE "ddl"."bank_auszuege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"datei_key" text NOT NULL,
	"datei_sha256" text NOT NULL,
	"datei_groesse" integer NOT NULL,
	"datei_name" text NOT NULL,
	"status" text NOT NULL,
	"fehler" text,
	"iban" text,
	"auszug_nummer" text,
	"auszug_datum" date,
	"alter_cent" integer,
	"neuer_cent" integer,
	"umsaetze_neu" integer DEFAULT 0 NOT NULL,
	"umsaetze_schon_da" integer DEFAULT 0 NOT NULL,
	"ki_modell" text,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"hochgeladen_von_label" text NOT NULL,
	CONSTRAINT "bank_auszuege_datei_key_unique" UNIQUE("datei_key"),
	CONSTRAINT "bank_auszuege_datei_sha256_unique" UNIQUE("datei_sha256")
);
--> statement-breakpoint
CREATE TABLE "ddl"."bank_umsaetze" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auszug_id" uuid NOT NULL,
	"fingerabdruck" text NOT NULL,
	"buchungstag" date NOT NULL,
	"valuta" date,
	"betrag_cent" integer NOT NULL,
	"gegenpartei" text,
	"iban" text,
	"text" text NOT NULL,
	"referenz" text,
	"rechnungsnummer" text,
	"bereich" text NOT NULL,
	"kategorie" text,
	"privat_kategorie" text,
	"zuordnung" text,
	"payment_id" uuid,
	"expense_id" uuid,
	"privat_buchung_id" uuid,
	"erstellt_hier" boolean DEFAULT false NOT NULL,
	"zugeordnet_am" timestamp with time zone,
	CONSTRAINT "bank_umsaetze_fingerabdruck_unique" UNIQUE("fingerabdruck"),
	CONSTRAINT "bank_umsaetze_betrag" CHECK ("ddl"."bank_umsaetze"."betrag_cent" <> 0)
);
--> statement-breakpoint
ALTER TABLE "ddl"."bank_umsaetze" ADD CONSTRAINT "bank_umsaetze_auszug_id_bank_auszuege_id_fk" FOREIGN KEY ("auszug_id") REFERENCES "ddl"."bank_auszuege"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."bank_umsaetze" ADD CONSTRAINT "bank_umsaetze_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "ddl"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."bank_umsaetze" ADD CONSTRAINT "bank_umsaetze_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "ddl"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."bank_umsaetze" ADD CONSTRAINT "bank_umsaetze_privat_buchung_id_privat_buchungen_id_fk" FOREIGN KEY ("privat_buchung_id") REFERENCES "ddl"."privat_buchungen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_umsaetze_tag_idx" ON "ddl"."bank_umsaetze" USING btree ("buchungstag");--> statement-breakpoint
CREATE INDEX "bank_umsaetze_zuordnung_idx" ON "ddl"."bank_umsaetze" USING btree ("zuordnung");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_umsaetze_expense_einmal" ON "ddl"."bank_umsaetze" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_umsaetze_privat_einmal" ON "ddl"."bank_umsaetze" USING btree ("privat_buchung_id");