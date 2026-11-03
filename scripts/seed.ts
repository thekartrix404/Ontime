import { seedDatabase } from '../src/lib/seed';
import { getDb, closeDb } from '../src/lib/db';

function seed() {
  console.log('🌱 Starting database seed...');
  seedDatabase();
  const db = getDb();
  const clientsCount = (db.prepare('SELECT COUNT(*) as count FROM clients').get() as { count: number }).count;
  const invoicesCount = (db.prepare('SELECT COUNT(*) as count FROM invoices').get() as { count: number }).count;
  const paymentsCount = (db.prepare('SELECT COUNT(*) as count FROM payments').get() as { count: number }).count;
  const auditCount = (db.prepare('SELECT COUNT(*) as count FROM audit_log').get() as { count: number }).count;

  console.log(`✅ Database successfully seeded!`);
  console.log(`   - Clients:  ${clientsCount}`);
  console.log(`   - Invoices: ${invoicesCount}`);
  console.log(`   - Payments: ${paymentsCount}`);
  console.log(`   - Audit:    ${auditCount}`);
  closeDb();
}

seed();
