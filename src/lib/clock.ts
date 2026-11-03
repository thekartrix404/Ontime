import { getDb } from './db';
import { seedDatabase } from './seed';

const SETTINGS_KEY = 'simulated_now';

/**
 * Returns the current simulated time stored in the DB.
 * Defaults to the real current time if not set.
 */
export function getSimulatedNow(): Date {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
    if (row && row.value) {
      const parsed = new Date(row.value);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch {
    // If DB is busy or not yet initialized
  }
  return new Date();
}

/**
 * Sets the simulated current time in the DB.
 */
export function setSimulatedNow(date: Date): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO system_settings (key, value)
    VALUES (?, ?)
  `).run(SETTINGS_KEY, date.toISOString());
}

/**
 * Advances the simulated clock by the specified number of days.
 */
export function advanceSimulatedDays(days: number): Date {
  const current = getSimulatedNow();
  const nextTime = new Date(current.getTime() + days * 24 * 60 * 60 * 1000);
  setSimulatedNow(nextTime);
  return nextTime;
}

/**
 * Resets the clock to the real current time.
 */
export function resetClock(): void {
  const db = getDb();
  db.prepare('DELETE FROM system_settings WHERE key = ?').run(SETTINGS_KEY);
}

/**
 * Computes days overdue in code:
 * simulated_now vs invoice due date.
 * Positive = past due (e.g. 5 days overdue).
 * Zero = due today.
 * Negative = due in the future (e.g. -2 days overdue).
 */
export function computeDaysOverdue(dueDateStr: string, simulatedNow?: Date): number {
  const now = simulatedNow || getSimulatedNow();

  // Parse YYYY-MM-DD cleanly at UTC midnight
  const [year, month, day] = dueDateStr.split('-').map(Number);
  const dueUtc = Date.UTC(year, month - 1, day);

  const nowUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  const diffMs = nowUtc - dueUtc;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Resets demo data:
 * - Restores initial seed data
 * - Cleans demo invoices, followups, approval queue, and audit log
 * - Resets the simulated clock
 */
export function resetDemo(): void {
  resetClock();
  seedDatabase();
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `audit_reset_${Date.now()}`,
    'DEMO_RESET',
    'system',
    'clock',
    'Demo reset: restored seed data, cleared demo artifacts, and reset simulated clock to current time.',
    new Date().toISOString()
  );
}

