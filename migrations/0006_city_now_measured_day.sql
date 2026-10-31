-- Today's measured readings, one per hour plus the day's highest, carried in
-- city_now so the /au/ strips can show measured hours and a peak that is
-- never below a reading already taken, without reading `readings` per view.
ALTER TABLE city_now ADD COLUMN measured_day_json TEXT;
