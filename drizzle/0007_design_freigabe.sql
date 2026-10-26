CREATE TABLE "ddl"."design_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"note" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_name" text,
	"decided_ip" text,
	"change_message_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ddl"."order_feedback" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddl"."design_revisions" ADD CONSTRAINT "design_revisions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_feedback" ADD CONSTRAINT "order_feedback_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_revisions_order_revision_uq" ON "ddl"."design_revisions" USING btree ("order_id","revision");