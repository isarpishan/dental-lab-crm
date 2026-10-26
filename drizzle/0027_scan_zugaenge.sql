CREATE TABLE "ddl"."scan_zugaenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "scan_zugaenge_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "ddl"."scan_zugaenge" ADD CONSTRAINT "scan_zugaenge_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "ddl"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_zugaenge_user_idx" ON "ddl"."scan_zugaenge" USING btree ("staff_user_id");