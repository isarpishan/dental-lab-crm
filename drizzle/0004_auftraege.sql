CREATE TABLE "ddl"."order_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"kind" text NOT NULL,
	"slot" text,
	"design_revision" integer,
	"storage_key" text NOT NULL,
	"filename_enc" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_kind" text NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "order_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "ddl"."order_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"design_revision" integer,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddl"."order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_kind" text NOT NULL,
	"by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ddl"."order_teeth" (
	"order_id" uuid NOT NULL,
	"fdi" smallint NOT NULL,
	"treatment" text NOT NULL,
	"span_id" text,
	CONSTRAINT "order_teeth_order_id_fdi_treatment_pk" PRIMARY KEY("order_id","fdi","treatment")
);
--> statement-breakpoint
CREATE TABLE "ddl"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" text,
	"practice_id" uuid NOT NULL,
	"dentist_id" uuid,
	"patient_id" uuid,
	"work_type_key" text,
	"delivery_kind" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_state" jsonb,
	"treatment_plan" text,
	"shade" text,
	"express" boolean,
	"price_snapshot" jsonb,
	"desired_date" date,
	"due_date" date,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"current_step_key" text,
	"source" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
ALTER TABLE "ddl"."order_files" ADD CONSTRAINT "order_files_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_messages" ADD CONSTRAINT "order_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_teeth" ADD CONSTRAINT "order_teeth_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "ddl"."dentists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "ddl"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_work_type_key_work_types_key_fk" FOREIGN KEY ("work_type_key") REFERENCES "ddl"."work_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_status_portal_statuses_key_fk" FOREIGN KEY ("status") REFERENCES "ddl"."portal_statuses"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_files_order_idx" ON "ddl"."order_files" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_messages_order_idx" ON "ddl"."order_messages" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "ddl"."order_status_history" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "orders_practice_status_idx" ON "ddl"."orders" USING btree ("practice_id","status");--> statement-breakpoint
CREATE INDEX "orders_patient_idx" ON "ddl"."orders" USING btree ("patient_id");