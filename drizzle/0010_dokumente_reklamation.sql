CREATE TABLE "ddl"."complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complaint_no" text NOT NULL,
	"order_id" uuid NOT NULL,
	"practice_id" uuid NOT NULL,
	"reported_by_kind" text NOT NULL,
	"reported_by_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"message_id" uuid,
	"warranty_until" date,
	"warranty_valid" boolean NOT NULL,
	"decision" text DEFAULT 'offen' NOT NULL,
	"decision_note" text,
	"free_of_charge" boolean,
	"new_order_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"repaired_at" timestamp with time zone,
	"repaired_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_complaint_no_unique" UNIQUE("complaint_no")
);
--> statement-breakpoint
CREATE TABLE "ddl"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"doc_no" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"issued_by_label" text NOT NULL,
	CONSTRAINT "documents_doc_no_unique" UNIQUE("doc_no"),
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD COLUMN "remake_of_id" uuid;--> statement-breakpoint
ALTER TABLE "ddl"."complaints" ADD CONSTRAINT "complaints_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."complaints" ADD CONSTRAINT "complaints_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."complaints" ADD CONSTRAINT "complaints_message_id_order_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "ddl"."order_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."complaints" ADD CONSTRAINT "complaints_new_order_id_orders_id_fk" FOREIGN KEY ("new_order_id") REFERENCES "ddl"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."complaints" ADD CONSTRAINT "complaints_decided_by_staff_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "ddl"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."complaints" ADD CONSTRAINT "complaints_repaired_by_staff_users_id_fk" FOREIGN KEY ("repaired_by") REFERENCES "ddl"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complaints_practice_idx" ON "ddl"."complaints" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "complaints_decision_idx" ON "ddl"."complaints" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_order_offen_uq" ON "ddl"."complaints" USING btree ("order_id") WHERE "ddl"."complaints"."decision" = 'offen';--> statement-breakpoint
CREATE UNIQUE INDEX "documents_order_kind_uq" ON "ddl"."documents" USING btree ("order_id","kind");--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_remake_of_id_orders_id_fk" FOREIGN KEY ("remake_of_id") REFERENCES "ddl"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- اسناد غیرقابل‌تغییرند (CLAUDE.md، قانون ۶): هر UPDATE و DELETE روی ddl.documents رد می‌شود.
-- تنها استثنا پاک‌کردن دادهٔ آزمایشی در `pnpm qa` است: فقط DELETE، و فقط در تراکنشی که خودش
-- `set local ddl.dokumente_loeschen = 'qa'` گفته. برنامه هرگز این را نمی‌گوید.
CREATE FUNCTION "ddl"."dokumente_unveraenderlich"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ddl.dokumente_loeschen', true) = 'qa' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Dokumente sind unveränderlich (%).', TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "documents_unveraenderlich" BEFORE UPDATE OR DELETE ON "ddl"."documents" FOR EACH ROW EXECUTE FUNCTION "ddl"."dokumente_unveraenderlich"();
