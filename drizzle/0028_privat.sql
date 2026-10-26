CREATE TABLE "ddl"."privat_buchungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"datum" date NOT NULL,
	"betrag_cent" integer NOT NULL,
	"kategorie" text NOT NULL,
	"haendler" text,
	"notiz" text,
	"quelle" text DEFAULT 'hand' NOT NULL,
	"beleg_key" text,
	"beleg_sha256" text,
	"beleg_groesse" integer,
	"beleg_typ" text,
	"beleg_name" text,
	"beleg_am" timestamp with time zone,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erfasst_von" uuid,
	"erfasst_von_label" text NOT NULL,
	"geaendert_am" timestamp with time zone,
	"geloescht_am" timestamp with time zone,
	CONSTRAINT "privat_buchungen_beleg_key_unique" UNIQUE("beleg_key"),
	CONSTRAINT "privat_buchungen_betrag" CHECK ("ddl"."privat_buchungen"."betrag_cent" > 0),
	CONSTRAINT "privat_buchungen_beleg" CHECK (("ddl"."privat_buchungen"."beleg_key" is null) = ("ddl"."privat_buchungen"."beleg_sha256" is null))
);
--> statement-breakpoint
ALTER TABLE "ddl"."beleg_eingang" ADD COLUMN "bereich" text;--> statement-breakpoint
CREATE INDEX "privat_buchungen_datum_idx" ON "ddl"."privat_buchungen" USING btree ("datum");