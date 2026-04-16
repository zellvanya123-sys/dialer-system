import Database from 'better-sqlite3';

const db = new Database('./data/dialer.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    country TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    attempt_count INTEGER DEFAULT 0,
    last_call_at TEXT,
    next_call_at TEXT,
    last_call_result TEXT,
    last_call_duration INTEGER,
    qualification_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    external_id TEXT,
    sheet_row_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    started_at TEXT NOT NULL,
    answered_at TEXT,
    ended_at TEXT,
    duration INTEGER,
    result TEXT NOT NULL,
    recording_url TEXT,
    script_id TEXT,
    notes TEXT,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
  CREATE INDEX IF NOT EXISTS idx_contacts_next_call ON contacts(next_call_at);
  CREATE INDEX IF NOT EXISTS idx_call_logs_contact ON call_logs(contact_id);
`);

console.log('Database initialized successfully');
db.close();