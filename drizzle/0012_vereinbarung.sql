CREATE TABLE "ddl"."practice_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"version" text NOT NULL,
	"inhalt" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"accepted_by_id" uuid NOT NULL,
	"accepted_by_name" text NOT NULL,
	"accepted_by_email" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "ddl"."practice_agreements" ADD CONSTRAINT "practice_agreements_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."practice_agreements" ADD CONSTRAINT "practice_agreements_accepted_by_id_practice_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "ddl"."practice_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_agreements_practice_version_uq" ON "ddl"."practice_agreements" USING btree ("practice_id","version");--> statement-breakpoint
-- پذیرش Vereinbarung مدرک است: نه تغییر می‌کند، نه پاک می‌شود. فقط آزمون‌ها و پاک‌کردن دادهٔ نمایشی
-- (دیتابیس آزمون) با `set local ddl.vereinbarung_loeschen = 'qa'` پاک می‌کنند. برنامه هرگز این را نمی‌گوید.
CREATE FUNCTION "ddl"."vereinbarung_unveraenderlich"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ddl.vereinbarung_loeschen', true) = 'qa' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Angenommene Vereinbarungen sind unveränderlich (%).', TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "practice_agreements_unveraenderlich" BEFORE UPDATE OR DELETE ON "ddl"."practice_agreements" FOR EACH ROW EXECUTE FUNCTION "ddl"."vereinbarung_unveraenderlich"();
