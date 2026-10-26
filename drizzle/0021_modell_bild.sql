-- «Modell» عکس می‌گیرد (عکس از Inhaber، ۶ اکتبر ۲۰۲۶؛ public/bilder/auswahl/modell.webp).
-- فقط اگر هنوز عکسی ندارد، تا عکسی که Inhaber خودش در «Preise» بالا گذاشته دست نخورد.
UPDATE "ddl"."work_types" SET "image_key" = 'modell.webp' WHERE "key" = 'modell' AND "image_key" IS NULL;
