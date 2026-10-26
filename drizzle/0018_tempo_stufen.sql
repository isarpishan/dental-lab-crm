ALTER TABLE "ddl"."orders" ADD COLUMN "tempo" text;--> statement-breakpoint
ALTER TABLE "ddl"."work_types" ADD COLUMN "express_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ddl"."work_types" ADD COLUMN "same_day_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ddl"."work_types" ADD COLUMN "same_day_surcharge" jsonb DEFAULT '{"betrag":null,"einheit":"Auftrag"}'::jsonb NOT NULL;--> statement-breakpoint
-- سه Service-Level جدا (خواستهٔ کاربر، ۵ اکتبر ۲۰۲۶): Standard، «Express < 24 Stunden» و «Same-Day».
-- Same-Day تا حالا فقط متن «Same Day möglich» در زمان عادی و برچسب «Same Day» بود؛ حالا گزینهٔ جدا با Zuschlag خودش.
UPDATE "ddl"."work_types" SET "same_day_available" = true WHERE "turnaround_label" ILIKE 'same%day%' OR 'Same Day' = ANY("badges");--> statement-breakpoint
UPDATE "ddl"."work_types" SET "turnaround_label" = 'nach Prüfung' WHERE "turnaround_label" ILIKE 'same%day%';--> statement-breakpoint
UPDATE "ddl"."work_types" SET "badges" = array_remove("badges", 'Same Day');--> statement-breakpoint
-- Express همیشه «< 24 Stunden» است. جایی که Express «< 1 Woche» بود (Prothese) دیگر Express ندارد (تصمیم کاربر).
UPDATE "ddl"."work_types" SET "express_available" = false WHERE "express_label" ILIKE '%woche%';--> statement-breakpoint
-- سفارش‌ها: «Express بله/خیر» ← Tempo. Zuschlag ذخیره‌شده در price_snapshot کلید «zuschlag» می‌گیرد.
UPDATE "ddl"."orders" SET "tempo" = CASE "express" WHEN true THEN 'express' WHEN false THEN 'standard' END;--> statement-breakpoint
UPDATE "ddl"."orders" SET "price_snapshot" = ("price_snapshot" - 'expressZuschlag') || jsonb_build_object('zuschlag', "price_snapshot" -> 'expressZuschlag') WHERE "price_snapshot" -> 'expressZuschlag' IS NOT NULL;
