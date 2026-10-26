ALTER TABLE "ddl"."work_types" ADD COLUMN "express_label" text;--> statement-breakpoint
ALTER TABLE "ddl"."work_types" ADD COLUMN "express_surcharge" jsonb DEFAULT '{"betrag":null,"einheit":"Auftrag"}'::jsonb NOT NULL;--> statement-breakpoint
-- دادهٔ ردیف‌های موجود (تصمیم کاربر، ۱ اکتبر ۲۰۲۶): زمان Express جدا از زمان عادی،
-- Prothese «< 1 Woche» و بقیه «< 24 Stunden». برچسب «Express» حذف می‌شود، چون Express برای همه هست.
UPDATE "ddl"."work_types" SET "turnaround_label" = split_part("turnaround_label", ' · Express ', 1);--> statement-breakpoint
UPDATE "ddl"."work_types" SET "express_label" = CASE WHEN "group_key" = 'prothese' OR "key" = 'hybridprothese' THEN '< 1 Woche' ELSE '< 24 Stunden' END WHERE "express_label" IS NULL;--> statement-breakpoint
UPDATE "ddl"."work_types" SET "badges" = array_remove("badges", 'Express');
