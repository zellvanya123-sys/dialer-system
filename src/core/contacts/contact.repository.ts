import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Contact, ContactStatus, CallResult, CallLog } from './contact.model';
import logger from '../../utils/logger';
import fs from 'fs';

const DB_DIR = './data';
const DB_FILE = './data/dialer.sqlite';
const JSON_FILE = './data/contacts.json';

let db: Database.Database;

export function initDatabase(): void {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_FILE);

  // WAL mode — быстрее и безопаснее при крашах
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Создаём таблицы
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT,
      timezone TEXT DEFAULT 'Europe/Moscow',
      country TEXT DEFAULT 'RU',
      status TEXT DEFAULT 'new',
      attempt_count INTEGER DEFAULT 0,
      last_call_at TEXT,
      last_call_result TEXT,
      last_call_duration INTEGER,
      next_call_at TEXT,
      callback_at TEXT,
      callback_reason TEXT,
      qualification TEXT,
      external_id TEXT,
      sheet_row_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      transcript TEXT,
      recording_url TEXT,
      notes TEXT,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
    CREATE INDEX IF NOT EXISTS idx_contacts_next_call ON contacts(next_call_at);
    CREATE INDEX IF NOT EXISTS idx_logs_contact ON call_logs(contact_id);
    CREATE INDEX IF NOT EXISTS idx_logs_started ON call_logs(started_at);
  `);

  // ✅ Миграция из JSON если есть старые данные
  migrateFromJson();

  const count = (db.prepare('SELECT COUNT(*) as n FROM contacts').get() as any).n;
  logger.info(`SQLite database initialized. Contacts: ${count}`);
}

function migrateFromJson(): void {
  if (!fs.existsSync(JSON_FILE)) return;

  const existing = (db.prepare('SELECT COUNT(*) as n FROM contacts').get() as any).n;
  if (existing > 0) return; // уже мигрировали

  try {
    const raw = fs.readFileSync(JSON_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const contacts: Contact[] = data.contacts || [];
    const logs: CallLog[] = data.callLogs || [];

    const insertContact = db.prepare(`
      INSERT OR IGNORE INTO contacts
      (id, phone, name, email, timezone, country, status, attempt_count,
       last_call_at, last_call_result, last_call_duration, next_call_at,
       callback_at, callback_reason, qualification, external_id, sheet_row_id,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLog = db.prepare(`
      INSERT OR IGNORE INTO call_logs
      (id, contact_id, phone, started_at, answered_at, ended_at, duration, result, transcript, recording_url, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const migrateAll = db.transaction(() => {
      for (const c of contacts) {
        insertContact.run(
          c.id, c.phone, c.name, c.email || null, c.timezone || 'Europe/Moscow',
          c.country || 'RU', c.status, c.attemptCount || 0,
          c.lastCallAt || null, c.lastCallResult || null, c.lastCallDuration || null,
          c.nextCallAt || null, (c as any).callbackAt || null, (c as any).callbackReason || null,
          c.qualification ? JSON.stringify(c.qualification) : null,
          c.externalId || null, c.sheetRowId || null,
          c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()
        );
      }
      for (const l of logs) {
        insertLog.run(
          l.id, l.contactId, l.phone, l.startedAt,
          l.answeredAt || null, l.endedAt || null, l.duration || null,
          l.result, l.transcript || null, l.recordingUrl || null, l.notes || null
        );
      }
    });

    migrateAll();

    // Бэкапим JSON после миграции
    fs.renameSync(JSON_FILE, JSON_FILE + '.migrated_' + Date.now());
    logger.info(`✅ Migrated ${contacts.length} contacts and ${logs.length} logs from JSON to SQLite`);
  } catch (err: any) {
    logger.error(`Migration error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════
// ContactRepository
// ═══════════════════════════════════════════
function rowToContact(row: any): Contact {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    timezone: row.timezone || 'Europe/Moscow',
    country: row.country || 'RU',
    status: row.status as ContactStatus,
    attemptCount: row.attempt_count || 0,
    lastCallAt: row.last_call_at,
    lastCallResult: row.last_call_result as CallResult,
    lastCallDuration: row.last_call_duration,
    nextCallAt: row.next_call_at,
    callbackAt: row.callback_at,
    callbackReason: row.callback_reason,
    qualification: row.qualification ? JSON.parse(row.qualification) : undefined,
    externalId: row.external_id,
    sheetRowId: row.sheet_row_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLog(row: any): CallLog {
  return {
    id: row.id,
    contactId: row.contact_id,
    phone: row.phone,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    duration: row.duration,
    result: row.result as CallResult,
    transcript: row.transcript,
    recordingUrl: row.recording_url,
    notes: row.notes,
  };
}

export class ContactRepository {
  static create(data: Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'attemptCount' | 'status'>): Contact {
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO contacts
      (id, phone, name, email, timezone, country, status, attempt_count,
       external_id, sheet_row_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.phone, data.name, data.email || null,
      data.timezone || 'Europe/Moscow', data.country || 'RU',
      ContactStatus.NEW, 0,
      data.externalId || null, data.sheetRowId || null,
      now, now
    );

    return this.findById(id)!;
  }

  static findById(id: string): Contact | null {
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    return row ? rowToContact(row) : null;
  }

  static findAll(): Contact[] {
    return (db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all() as any[]).map(rowToContact);
  }

  static findByStatus(status: ContactStatus): Contact[] {
    return (db.prepare('SELECT * FROM contacts WHERE status = ?').all(status) as any[]).map(rowToContact);
  }

  static findByPhone(phone: string): Contact | null {
    const clean = phone.replace(/\D/g, '');
    const row = db.prepare(
      "SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone,'+',''),'-',''),' ','') = ?"
    ).get(clean);
    return row ? rowToContact(row) : null;
  }

  static findDueForCall(): Contact[] {
    const now = new Date().toISOString();
    return (db.prepare(`
      SELECT * FROM contacts
      WHERE status NOT IN ('lead', 'reject', 'dont_call')
      AND (next_call_at IS NULL OR next_call_at <= ?)
      ORDER BY attempt_count ASC, created_at ASC
    `).all(now) as any[]).map(rowToContact);
  }

  static update(id: string, data: Partial<Contact>): Contact | null {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: any[] = [];

    const fieldMap: Record<string, string> = {
      phone: 'phone', name: 'name', email: 'email',
      timezone: 'timezone', country: 'country', status: 'status',
      attemptCount: 'attempt_count', lastCallAt: 'last_call_at',
      lastCallResult: 'last_call_result', lastCallDuration: 'last_call_duration',
      nextCallAt: 'next_call_at', callbackAt: 'callback_at',
      callbackReason: 'callback_reason', externalId: 'external_id',
      sheetRowId: 'sheet_row_id',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in data) {
        fields.push(`${col} = ?`);
        values.push((data as any)[key] ?? null);
      }
    }

    if ('qualification' in data) {
      fields.push('qualification = ?');
      values.push(data.qualification ? JSON.stringify(data.qualification) : null);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  static delete(id: string): boolean {
    const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static incrementAttempt(id: string): void {
    db.prepare('UPDATE contacts SET attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  static addCallLog(log: CallLog): void {
    db.prepare(`
      INSERT INTO call_logs
      (id, contact_id, phone, started_at, answered_at, ended_at, duration, result, transcript, recording_url, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      log.id, log.contactId, log.phone, log.startedAt,
      log.answeredAt || null, log.endedAt || null, log.duration || null,
      log.result, log.transcript || null, log.recordingUrl || null, log.notes || null
    );
    logger.info(`Call log saved: ${log.id} | contact: ${log.contactId} | result: ${log.result}`);
  }

  static findAllCallLogs(): CallLog[] {
    return (db.prepare('SELECT * FROM call_logs ORDER BY started_at DESC').all() as any[]).map(rowToLog);
  }

  static findCallLogsByContact(contactId: string): CallLog[] {
    return (db.prepare('SELECT * FROM call_logs WHERE contact_id = ? ORDER BY started_at DESC').all(contactId) as any[]).map(rowToLog);
  }

  // ✅ Статистика из SQLite — быстро и без загрузки всей базы в память
  static getStats() {
    const total = (db.prepare('SELECT COUNT(*) as n FROM contacts').get() as any).n;
    const byStatus = db.prepare('SELECT status, COUNT(*) as n FROM contacts GROUP BY status').all() as any[];
    const statusMap: Record<string, number> = {};
    for (const row of byStatus) statusMap[row.status] = row.n;

    const logStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'answered' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN duration IS NOT NULL THEN duration ELSE 0 END) as total_duration
      FROM call_logs
    `).get() as any;

    const dueCount = (db.prepare(`
      SELECT COUNT(*) as n FROM contacts
      WHERE status NOT IN ('lead', 'reject', 'dont_call')
      AND (next_call_at IS NULL OR next_call_at <= ?)
    `).get(new Date().toISOString()) as any).n;

    return { total, statusMap, logStats, dueCount };
  }
}
