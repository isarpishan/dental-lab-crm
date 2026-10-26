-- Formlabs در لابراتوار (Inhaber، ۲۴ اکتبر ۲۰۲۶): Permanent Crown، Denture Base، Denture Teeth و Dental LT Comfort.
-- سه تای تازه اضافه می‌شوند؛ بقیهٔ Resinهای Formlabs خاموش (در «Nicht verwendete Materialien»، با یک کلیک برمی‌گردند).
INSERT INTO "ddl"."materials" ("key", "name", "manufacturer", "indications")
SELECT v.key, v.name, 'Formlabs', v.indications
FROM (VALUES
  ('fl_permanent_crown', 'Permanent Crown Resin', ARRAY['krone', 'inlay', 'veneer']::text[]),
  ('fl_denture_base', 'Denture Base Resin', ARRAY['teilprothese', 'totalprothese']::text[]),
  ('fl_denture_teeth', 'Denture Teeth Resin', ARRAY['teilprothese', 'totalprothese']::text[])
) AS v(key, name, indications)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "ddl"."materials" SET "is_active" = false
WHERE "key" IN ('fl_premium_teeth', 'fl_lt_clear_v2', 'fl_surgical_guide', 'fl_flexible_80a', 'fl_custom_tray', 'fl_ibt_flex', 'fl_model_v3');
