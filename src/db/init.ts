/**
 * Database initialization hook for the app
 * Call this once at app startup
 */

import { db } from './sqlite';

let initPromise: Promise<void> | null = null;

export async function initializeDatabase(): Promise<void> {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      await db.initialize();
      console.log('[App] Database initialized successfully');
    } catch (error) {
      console.error('[App] Failed to initialize database:', error);
      initPromise = null; // Allow retry
      throw error;
    }
  })();
  
  return initPromise;
}

export function isDatabaseReady(): boolean {
  return db.isReady();
}