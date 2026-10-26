ALTER TABLE "ddl"."material_lots" ADD COLUMN "shade" text;--> statement-breakpoint
ALTER TABLE "ddl"."material_lots" ADD COLUMN "quantity" integer;--> statement-breakpoint
ALTER TABLE "ddl"."material_lots" ADD COLUMN "stock" integer;--> statement-breakpoint
ALTER TABLE "ddl"."materials" ADD COLUMN "unit" text DEFAULT 'flasche' NOT NULL;--> statement-breakpoint
ALTER TABLE "ddl"."materials" ADD COLUMN "shades" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ddl"."order_materials" ADD COLUMN "quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ddl"."material_lots" ADD CONSTRAINT "material_lots_menge" CHECK (("ddl"."material_lots"."quantity" is null or "ddl"."material_lots"."quantity" > 0) and ("ddl"."material_lots"."stock" is null or "ddl"."material_lots"."stock" >= 0));--> statement-breakpoint
-- مواد MIDAS با Kapsel کار می‌کنند (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶)؛ Crown HT رنگ‌های A1، A2 و A3 دارد.
UPDATE "ddl"."materials" SET "unit" = 'kapsel' WHERE "key" IN ('sr_midas_restore', 'sr_crown_ht', 'sr_ceramic_crown');--> statement-breakpoint
UPDATE "ddl"."materials" SET "shades" = ARRAY['A1', 'A2', 'A3'] WHERE "key" = 'sr_crown_ht' AND "shades" = '{}'::text[];
