-- EPA's UV Alert, carried into city_now when the forecasts are rebuilt, so
-- the /us/ table can show it without reading `daily` on a page view.
ALTER TABLE city_now ADD COLUMN alerts_json TEXT;
