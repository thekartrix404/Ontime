import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'ontime.db');

let dbInstance: Database.Database | null = null;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  company TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  terms TEXT,
  notes TEXT,
  paypal_invoice_id TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'PAYPAL',
  reference_id TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  tone TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  source TEXT NOT NULL DEFAULT 'gemini-live',
  scheduled_date TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  tone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  proposed_late_fee_percent REAL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  rule_blocked TEXT,
  source TEXT NOT NULL DEFAULT 'gemini-live',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_followups_invoice ON followups(invoice_id);
CREATE INDEX IF NOT EXISTS idx_approval_queue_invoice ON approval_queue(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
`;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.exec(SCHEMA_SQL);

    // Migration: ensure project_id column exists on existing databases
    try {
      dbInstance.exec('ALTER TABLE invoices ADD COLUMN project_id TEXT');
    } catch {
      // Column already exists
    }

    // Migration: ensure source column exists on followups and approval_queue
    try {
      dbInstance.exec("ALTER TABLE followups ADD COLUMN source TEXT NOT NULL DEFAULT 'gemini-live'");
    } catch {
      // Column already exists
    }

    try {
      dbInstance.exec("ALTER TABLE approval_queue ADD COLUMN source TEXT NOT NULL DEFAULT 'gemini-live'");
    } catch {
      // Column already exists
    }

    try {
      dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id)');
    } catch {
      // Ignore
    }
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
