CREATE TABLE "ddl"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rechnungsdatum" date NOT NULL,
	"bezahlt_am" date NOT NULL,
	"lieferant" text NOT NULL,
	"rechnungsnummer" text,
	"kategorie" text NOT NULL,
	"beschreibung" text,
	"netto_cent" integer NOT NULL,
	"mwst_satz" smallint,
	"mwst_cent" integer NOT NULL,
	"brutto_cent" integer NOT NULL,
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
	"geloescht_von_label" text,
	CONSTRAINT "expenses_beleg_key_unique" UNIQUE("beleg_key"),
	CONSTRAINT "expenses_betraege" CHECK ("ddl"."expenses"."netto_cent" > 0 and "ddl"."expenses"."mwst_cent" >= 0 and "ddl"."expenses"."brutto_cent" = "ddl"."expenses"."netto_cent" + "ddl"."expenses"."mwst_cent"),
	CONSTRAINT "expenses_mwst_satz" CHECK ("ddl"."expenses"."mwst_satz" is null or "ddl"."expenses"."mwst_satz" in (0, 10, 13, 20)),
	CONSTRAINT "expenses_beleg" CHECK (("ddl"."expenses"."beleg_key" is null) = ("ddl"."expenses"."beleg_sha256" is null))
);
--> statement-breakpoint
CREATE INDEX "expenses_bezahlt_idx" ON "ddl"."expenses" USING btree ("bezahlt_am");--> statement-breakpoint
-- Beleg هر Ausgabe مدرک مالیاتی است (BAO § 132، ۷ سال): وقتی ثبت شد، عوض نمی‌شود؛ Ausgabeِ حذف‌شده دیگر
-- تغییر نمی‌کند و هیچ ردیفی پاک نمی‌شود. فقط پاک‌کردن آزمون‌ها با `set local ddl.ausgaben_loeschen = 'qa'`.
CREATE FUNCTION "ddl"."ausgaben_schutz"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ddl.ausgaben_loeschen', true) = 'qa' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Ausgaben werden nicht gelöscht, nur als gelöscht markiert.';
  END IF;
  IF OLD.geloescht_am IS NOT NULL THEN
    RAISE EXCEPTION 'Gelöschte Ausgaben sind unveränderlich.';
  END IF;
  IF OLD.beleg_key IS NOT NULL AND (NEW.beleg_key, NEW.beleg_sha256, NEW.beleg_groesse, NEW.beleg_typ, NEW.beleg_name, NEW.beleg_am)
      IS DISTINCT FROM (OLD.beleg_key, OLD.beleg_sha256, OLD.beleg_groesse, OLD.beleg_typ, OLD.beleg_name, OLD.beleg_am) THEN
    RAISE EXCEPTION 'Der Beleg einer Ausgabe ist unveränderlich.';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "expenses_schutz" BEFORE UPDATE OR DELETE ON "ddl"."expenses" FOR EACH ROW EXECUTE FUNCTION "ddl"."ausgaben_schutz"();
