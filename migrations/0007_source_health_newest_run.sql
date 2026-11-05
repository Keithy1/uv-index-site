-- The newest forecast run each source holds, so health can judge CAMS by its
-- publication clock rather than by age (see schema.sql).
--
-- Added to production by hand when the column arrived (28 October 2026), before
-- migrations ran from the deploy; recorded as applied on 5 November 2026.
ALTER TABLE source_health ADD COLUMN newest_run TEXT;
