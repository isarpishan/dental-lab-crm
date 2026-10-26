-- Implantatkrone: «Gegenkiefer-Scan» statt «Unterkiefer-Scan» (bei Implantaten im UK ist der Gegenkiefer der OK).
-- Nur ändern, wenn der Inhaber die Liste nicht schon selbst angepasst hat.
UPDATE "ddl"."work_types" SET "required_files" = '{scanbody,gegenkiefer,biss}' WHERE "key" = 'implantatkrone' AND "required_files" = '{scanbody,uk,biss}';
