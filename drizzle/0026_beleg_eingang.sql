CREATE TABLE "ddl"."beleg_eingang" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beleg_key" text NOT NULL,
	"beleg_sha256" text NOT NULL,
	"beleg_groesse" integer NOT NULL,
	"beleg_typ" text NOT NULL,
	"beleg_name" text NOT NULL,
	"status" text DEFAULT 'neu' NOT NULL,
	"vorschlag" jsonb,
	"fehler" text,
	"ki_modell" text,
	"gelesen_am" timestamp with time zone,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"hochgeladen_von" uuid,
	"hochgeladen_von_label" text NOT NULL,
	CONSTRAINT "beleg_eingang_beleg_key_unique" UNIQUE("beleg_key")
);
--> statement-breakpoint
CREATE TABLE "ddl"."ki_nutzung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zweck" text NOT NULL,
	"modell" text NOT NULL,
	"eingabe_tokens" integer NOT NULL,
	"ausgabe_tokens" integer NOT NULL,
	"erfolgreich" boolean NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "beleg_eingang_sha_idx" ON "ddl"."beleg_eingang" USING btree ("beleg_sha256");--> statement-breakpoint
CREATE INDEX "ki_nutzung_am_idx" ON "ddl"."ki_nutzung" USING btree ("am");