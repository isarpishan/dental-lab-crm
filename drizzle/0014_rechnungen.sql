CREATE TABLE "ddl"."invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"order_id" uuid,
	"auftragsnummer" text,
	"patientencode" text,
	"leistungsdatum" date,
	"bezeichnung" text NOT NULL,
	"menge" integer NOT NULL,
	"einheit" text NOT NULL,
	"einzelpreis_cent" integer NOT NULL,
	"betrag_cent" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nummer" text NOT NULL,
	"art" text NOT NULL,
	"storno" boolean DEFAULT false NOT NULL,
	"practice_id" uuid NOT NULL,
	"bezug_id" uuid,
	"abrechnung" text NOT NULL,
	"zeitraum_von" date,
	"zeitraum_bis" date,
	"ausgestellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"faellig_am" date,
	"summe_cent" integer NOT NULL,
	"empfaenger" jsonb NOT NULL,
	"aussteller" jsonb NOT NULL,
	"grund" text,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"ausgestellt_von" uuid,
	"ausgestellt_von_label" text NOT NULL,
	CONSTRAINT "invoices_nummer_unique" UNIQUE("nummer"),
	CONSTRAINT "invoices_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "ddl"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "ddl"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."invoice_lines" ADD CONSTRAINT "invoice_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."invoices" ADD CONSTRAINT "invoices_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."invoices" ADD CONSTRAINT "invoices_bezug_id_invoices_id_fk" FOREIGN KEY ("bezug_id") REFERENCES "ddl"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_invoice_pos_uq" ON "ddl"."invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_lines_order_idx" ON "ddl"."invoice_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_practice_idx" ON "ddl"."invoices" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "invoices_bezug_idx" ON "ddl"."invoices" USING btree ("bezug_id");--> statement-breakpoint
-- Rechnung و Gutschrift صادرشده مدرک مالیاتی‌اند (BAO § 132، ۷ سال): نه تغییر، نه حذف. فقط پاک‌کردن
-- آزمون‌ها با `set local ddl.rechnungen_loeschen = 'qa'`. برنامه هرگز این را نمی‌گوید.
CREATE FUNCTION "ddl"."rechnungen_unveraenderlich"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ddl.rechnungen_loeschen', true) = 'qa' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Rechnungen sind unveränderlich (%).', TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "invoices_unveraenderlich" BEFORE UPDATE OR DELETE ON "ddl"."invoices" FOR EACH ROW EXECUTE FUNCTION "ddl"."rechnungen_unveraenderlich"();
--> statement-breakpoint
CREATE TRIGGER "invoice_lines_unveraenderlich" BEFORE UPDATE OR DELETE ON "ddl"."invoice_lines" FOR EACH ROW EXECUTE FUNCTION "ddl"."rechnungen_unveraenderlich"();
