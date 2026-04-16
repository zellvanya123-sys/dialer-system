import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Contact, ContactStatus, CallResult } from './contact.model.js';
import logger from '../../utils/logger.js';

const DB_FILE = './data/contacts.json';

interface Database {
  contacts: Contact[];
  callLogs: any[];
}

let db: Database = { contacts: [], callLogs: [] };

export function initDatabase(): void {
  const dir = './data';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  if (fs.existsSync(DB_FILE)) {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    db = JSON.parse(data);
  } else {
    save();
  }
  
  logger.info('Database initialized');
}

function save(): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export class ContactRepository {
  static create(data: Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'attemptCount' | 'status'>): Contact {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const contact: Contact = {
      id,
      phone: data.phone,
      name: data.name,
      email: data.email,
      timezone: data.timezone,
      country: data.country,
      status: ContactStatus.NEW,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      externalId: data.externalId,
      sheetRowId: data.sheetRowId,
    };
    
    db.contacts.push(contact);
    save();
    
    return contact;
  }

  static findById(id: string): Contact | null {
    return db.contacts.find(c => c.id === id) || null;
  }

  static findAll(): Contact[] {
    return db.contacts;
  }

  static findByStatus(status: ContactStatus): Contact[] {
    return db.contacts.filter(c => c.status === status);
  }

  static findDueForCall(): Contact[] {
    const now = new Date().toISOString();
    return db.contacts.filter(c => 
      c.status !== ContactStatus.LEAD &&
      c.status !== ContactStatus.REJECT &&
      c.status !== ContactStatus.DONT_CALL &&
      (!c.nextCallAt || c.nextCallAt <= now)
    );
  }

  static update(id: string, data: Partial<Contact>): Contact | null {
    const index = db.contacts.findIndex(c => c.id === id);
    if (index === -1) return null;

    const contact = db.contacts[index];
    const updated = { ...contact, ...data, updatedAt: new Date().toISOString() };
    
    db.contacts[index] = updated;
    save();
    
    return updated;
  }

  static delete(id: string): boolean {
    const index = db.contacts.findIndex(c => c.id === id);
    if (index === -1) return false;

    db.contacts.splice(index, 1);
    save();
    
    return true;
  }

  static incrementAttempt(id: string): void {
    const contact = this.findById(id);
    if (contact) {
      this.update(id, { attemptCount: contact.attemptCount + 1 });
    }
  }
}