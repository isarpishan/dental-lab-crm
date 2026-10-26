CREATE SCHEMA "ddl";
--> statement-breakpoint
CREATE TABLE "ddl"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."data_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"patient_id" uuid,
	"order_id" uuid,
	"file_id" uuid,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."dentists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"title" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."devices" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'wartend' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"error" text,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ddl"."material_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_key" text NOT NULL,
	"lot_no" text NOT NULL,
	"expiry_date" date,
	"received_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."materials" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text NOT NULL,
	"indications" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."number_sequences" (
	"scope" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "number_sequences_scope_year_pk" PRIMARY KEY("scope","year")
);
--> statement-breakpoint
CREATE TABLE "ddl"."one_time_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"user_kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ddl"."patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"code" text NOT NULL,
	"first_name_enc" text NOT NULL,
	"last_name_enc" text NOT NULL,
	"birth_date_enc" text,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ddl"."portal_statuses" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"needs_action" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."practice_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ddl"."practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_no" text NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"zip" text,
	"city" text,
	"country" text DEFAULT 'AT' NOT NULL,
	"uid_number" text,
	"phone" text,
	"email" text,
	"billing_mode" text DEFAULT 'sammel' NOT NULL,
	"tour_id" uuid,
	"delivery_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practices_customer_no_unique" UNIQUE("customer_no")
);
--> statement-breakpoint
CREATE TABLE "ddl"."production_steps" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"portal_status_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ddl"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"value_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ddl"."tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"driver_id" uuid,
	"weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."work_types" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"image_key" text,
	"turnaround_label" text NOT NULL,
	"delivery_options" jsonb NOT NULL,
	"needs_freigabe" boolean DEFAULT true NOT NULL,
	"badges" text[] DEFAULT '{}'::text[] NOT NULL,
	"form_schema" jsonb NOT NULL,
	"required_files" text[] DEFAULT '{}'::text[] NOT NULL,
	"step_keys" text[] NOT NULL,
	"warranty_months" integer DEFAULT 24 NOT NULL,
	"position" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddl"."dentists" ADD CONSTRAINT "dentists_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."material_lots" ADD CONSTRAINT "material_lots_material_key_materials_key_fk" FOREIGN KEY ("material_key") REFERENCES "ddl"."materials"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."patients" ADD CONSTRAINT "patients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."practice_users" ADD CONSTRAINT "practice_users_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."practices" ADD CONSTRAINT "practices_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "ddl"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."production_steps" ADD CONSTRAINT "production_steps_portal_status_key_portal_statuses_key_fk" FOREIGN KEY ("portal_status_key") REFERENCES "ddl"."portal_statuses"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."tours" ADD CONSTRAINT "tours_driver_id_staff_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "ddl"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "ddl"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "data_access_patient_idx" ON "ddl"."data_access_log" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "dentists_practice_idx" ON "ddl"."dentists" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "ddl"."jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "patients_practice_idx" ON "ddl"."patients" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "practice_users_practice_idx" ON "ddl"."practice_users" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "ddl"."sessions" USING btree ("user_kind","user_id");