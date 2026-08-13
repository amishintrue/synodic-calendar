/**
 * SQLite Database Service for Capacitor
 * Replaces Drizzle ORM + PostgreSQL with direct SQLite operations
 */

import { SQLiteConnection, SQLiteDBConnection, CapacitorSQLite } from '@capacitor-community/sqlite';
import { SQLITE_SCHEMA, INITIAL_SETTINGS } from './sqlite-schema';

const DB_NAME = 'lunar_calendar.db';

export interface ObservationRow {
  id: number;
  date: string;
  created_at: string;
}

export interface NoteRow {
  date: string;
  comment: string;
  updated_at: string;
}

export interface ReminderRow {
  id: number;
  title: string;
  kind: 'date' | 'weekly';
  date: string | null;
  weekday: number | null;
  time: string | null;
  lastNotifiedDate: string | null;
  createdAt: string;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

class DatabaseService {
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private initialized = false;

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check if database exists
      const isDbExists = await this.sqlite.isDatabase(DB_NAME);
      
      // Create or open database
      this.db = await this.sqlite.createConnection(
        DB_NAME,
        false,  // readonly
        'no-encryption',
        1,      // version
        false   // shouldUpgrade
      );

      await this.db.open();

      // Run schema migrations
      await this.runMigrations();

      // Initialize default settings
      await this.initializeSettings();

      this.initialized = true;
      console.log('[SQLite] Database initialized successfully');
    } catch (error) {
      console.error('[SQLite] Failed to initialize database:', error);
      throw error;
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Execute schema
    const statements = SQLITE_SCHEMA.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await this.db.execute(statement.trim());
      }
    }
  }

  private async initializeSettings(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const setting of INITIAL_SETTINGS) {
      await this.db.run(
        `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
        [setting.key, setting.value]
      );
    }
  }

  // ============ Observations ============

  async getObservations(): Promise<ObservationRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM observations ORDER BY date ASC');
    return result.values as ObservationRow[];
  }

  async addObservation(date: string): Promise<ObservationRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run(
      'INSERT OR IGNORE INTO observations (date, created_at) VALUES (?, datetime(\'now\'))',
      [date]
    );
    return this.getObservations();
  }

  async deleteObservation(date: string): Promise<ObservationRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM observations WHERE date = ?', [date]);
    return this.getObservations();
  }

  // ============ Notes ============

  async getNotes(): Promise<NoteRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM notes');
    return result.values as NoteRow[];
  }

  async saveNote(date: string, comment: string): Promise<NoteRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    const trimmed = comment.trim();
    
    if (trimmed.length === 0) {
      await this.db.run('DELETE FROM notes WHERE date = ?', [date]);
    } else {
      await this.db.run(
        `INSERT INTO notes (date, comment, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(date) DO UPDATE SET comment = ?, updated_at = datetime('now')`,
        [date, trimmed, trimmed]
      );
    }
    return this.getNotes();
  }

  // ============ Reminders ============

  async getReminders(): Promise<ReminderRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      `SELECT id, title, kind, date, weekday, time, 
        last_notified_date as lastNotifiedDate, 
        created_at as createdAt
       FROM reminders ORDER BY id ASC`
    );
    return result.values as ReminderRow[];
  }

  async addReminder(
    title: string,
    kind: 'date' | 'weekly',
    date: string | null,
    weekday: number | null,
    time: string | null
  ): Promise<ReminderRow> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.log('[SQLite] Adding reminder:', { title, kind, date, weekday, time });
    
    const result = await this.db.run(
      `INSERT INTO reminders (title, kind, date, weekday, time, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [title, kind, date, weekday, time]
    );

    console.log('[SQLite] Insert result:', result);

    const id = result.changes?.lastId || 0;
    const rows = await this.db.query(
      `SELECT id, title, kind, date, weekday, time,
        last_notified_date as lastNotifiedDate,
        created_at as createdAt
       FROM reminders WHERE id = ?`,
      [id]
    );
    console.log('[SQLite] Retrieved row:', rows.values);
    if (!rows.values || rows.values.length === 0) {
      throw new Error('Failed to retrieve created reminder');
    }
    return rows.values[0] as ReminderRow;
  }

  async updateReminder(
    id: number,
    title: string,
    kind: 'date' | 'weekly',
    date: string | null,
    weekday: number | null,
    time: string | null
  ): Promise<ReminderRow | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.log('[SQLite] Updating reminder:', { id, title, kind, date, weekday, time });
    
    await this.db.run(
      `UPDATE reminders SET title = ?, kind = ?, date = ?, weekday = ?, time = ?, last_notified_date = NULL
       WHERE id = ?`,
      [title, kind, date, weekday, time, id]
    );

    const rows = await this.db.query(
      `SELECT id, title, kind, date, weekday, time,
        last_notified_date as lastNotifiedDate,
        created_at as createdAt
       FROM reminders WHERE id = ?`,
      [id]
    );
    console.log('[SQLite] Updated row:', rows.values);
    if (!rows.values || rows.values.length === 0) {
      return null;
    }
    return rows.values[0] as ReminderRow;
  }

  async deleteReminder(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM reminders WHERE id = ?', [id]);
  }

  async getReminderById(id: number): Promise<ReminderRow | null> {
    if (!this.db) throw new Error('Database not initialized');
    const rows = await this.db.query(
      `SELECT id, title, kind, date, weekday, time,
        last_notified_date as lastNotifiedDate,
        created_at as createdAt
       FROM reminders WHERE id = ?`,
      [id]
    );
    if (!rows.values || rows.values.length === 0) {
      return null;
    }
    return rows.values[0] as ReminderRow;
  }

  async updateLastNotifiedDate(id: number, date: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('UPDATE reminders SET last_notified_date = ? WHERE id = ?', [date, id]);
  }

  // ============ Settings ============

  async getSettings(): Promise<Record<string, string>> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM settings');
    const map: Record<string, string> = {};
    if (result.values) {
      for (const row of result.values) {
        map[row.key] = row.value;
      }
    }
    return map;
  }

  async setSetting(key: string, value: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, value, value]
    );
  }

  // ============ Push Subscriptions (kept for compatibility) ============

  async getPushSubscriptions(): Promise<PushSubscriptionRow[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM push_subscriptions');
    return result.values as PushSubscriptionRow[];
  }

  async savePushSubscription(endpoint: string, p256dh: string, auth: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?, auth = ?`,
      [endpoint, p256dh, auth, p256dh, auth]
    );
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  }

  // ============ Utility ============

  async close(): Promise<void> {
    if (this.db) {
      await this.sqlite.closeConnection(DB_NAME, false);
      this.db = null;
      this.initialized = false;
    }
  }

  isReady(): boolean {
    return this.initialized && this.db !== null;
  }
}

// Export singleton instance
export const db = new DatabaseService();