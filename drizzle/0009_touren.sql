CREATE TABLE "ddl"."pickup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"order_id" uuid,
	"desired_date" date NOT NULL,
	"note" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"tour_id" uuid,
	"planned_date" date,
	"requested_by_kind" text NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddl"."practices" ADD COLUMN "tour_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ddl"."pickup_requests" ADD CONSTRAINT "pickup_requests_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "ddl"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."pickup_requests" ADD CONSTRAINT "pickup_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."pickup_requests" ADD CONSTRAINT "pickup_requests_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "ddl"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."pickup_requests" ADD CONSTRAINT "pickup_requests_done_by_staff_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "ddl"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickup_requests_status_idx" ON "ddl"."pickup_requests" USING btree ("status","planned_date");--> statement-breakpoint
CREATE INDEX "pickup_requests_practice_idx" ON "ddl"."pickup_requests" USING btree ("practice_id");