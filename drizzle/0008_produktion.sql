CREATE TABLE "ddl"."order_materials" (
	"order_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_materials_order_id_lot_id_pk" PRIMARY KEY("order_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "ddl"."order_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"device_key" text,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"done_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ddl"."material_lots" ADD COLUMN "used_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "ddl"."order_materials" ADD CONSTRAINT "order_materials_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_materials" ADD CONSTRAINT "order_materials_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "ddl"."material_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_steps" ADD CONSTRAINT "order_steps_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_steps" ADD CONSTRAINT "order_steps_step_key_production_steps_key_fk" FOREIGN KEY ("step_key") REFERENCES "ddl"."production_steps"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_steps" ADD CONSTRAINT "order_steps_device_key_devices_key_fk" FOREIGN KEY ("device_key") REFERENCES "ddl"."devices"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."order_steps" ADD CONSTRAINT "order_steps_done_by_staff_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "ddl"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_steps_order_step_uq" ON "ddl"."order_steps" USING btree ("order_id","step_key");--> statement-breakpoint
ALTER TABLE "ddl"."orders" ADD CONSTRAINT "orders_assignee_id_staff_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "ddl"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_lots_material_lot_uq" ON "ddl"."material_lots" USING btree ("material_key","lot_no");