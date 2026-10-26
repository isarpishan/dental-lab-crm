CREATE TABLE "ddl"."order_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"bezeichnung" text NOT NULL,
	"menge" integer NOT NULL,
	"einheit" text NOT NULL,
	"einzelpreis_cent" integer NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddl"."order_positions" ADD CONSTRAINT "order_positions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_positions_order_pos_uq" ON "ddl"."order_positions" USING btree ("order_id","position");