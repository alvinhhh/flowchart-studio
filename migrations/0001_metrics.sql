CREATE TABLE metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  visitors INTEGER NOT NULL DEFAULT 0,
  charts_created INTEGER NOT NULL DEFAULT 0,
  charts_shared INTEGER NOT NULL DEFAULT 0
);
INSERT INTO metrics (id) VALUES (1);

-- Random event receipts have a 48-hour retry window; subsequent writes remove expired rows.
CREATE TABLE metric_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('visit', 'chart_created')),
  day TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX metric_events_expiry ON metric_events (expires_at);

CREATE TRIGGER count_visit AFTER INSERT ON metric_events
WHEN NEW.type = 'visit'
BEGIN
  UPDATE metrics SET visitors = visitors + 1 WHERE id = 1;
END;

CREATE TRIGGER count_chart AFTER INSERT ON metric_events
WHEN NEW.type = 'chart_created'
BEGIN
  UPDATE metrics SET charts_created = charts_created + 1 WHERE id = 1;
END;
