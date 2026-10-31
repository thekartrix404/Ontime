import { getDb, closeDb } from '../src/lib/db';

function seed() {
  console.log('🌱 Starting database seed...');
  const db = getDb();

  // Clear existing data for fresh seed (in reverse dependency order)
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM followups;
    DELETE FROM payments;
    DELETE FROM invoices;
    DELETE FROM clients;
  `);

  const insertClient = db.prepare(`
    INSERT INTO clients (id, name, email, company, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, terms, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPayment = db.prepare(`
    INSERT INTO payments (id, invoice_id, amount, payment_date, payment_method, reference_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAuditLog = db.prepare(`
    INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seedTransaction = db.transaction(() => {
    // -------------------------------------------------------------
    // Client (a): Reliable - always pays on time
    // -------------------------------------------------------------
    const clientAId = 'client_reliable_01';
    insertClient.run(
      clientAId,
      'Reliable Corp (Alice Vance)',
      'alice@reliablecorp.com',
      'Reliable Solutions LLC',
      '2026-04-15 09:00:00'
    );

    const clientAInvoices = [
      {
        id: 'inv_rel_01',
        number: 'INV-REL-001',
        amount: '1500.00',
        issue: '2026-05-01',
        due: '2026-05-15',
        paid: '2026-05-14', // 1 day early (on time)
      },
      {
        id: 'inv_rel_02',
        number: 'INV-REL-002',
        amount: '2200.00',
        issue: '2026-06-01',
        due: '2026-06-15',
        paid: '2026-06-15', // On due date (on time)
      },
      {
        id: 'inv_rel_03',
        number: 'INV-REL-003',
        amount: '1800.00',
        issue: '2026-07-01',
        due: '2026-07-15',
        paid: '2026-07-13', // 2 days early (on time)
      },
      {
        id: 'inv_rel_04',
        number: 'INV-REL-004',
        amount: '3100.00',
        issue: '2026-08-01',
        due: '2026-08-15',
        paid: '2026-08-15', // On due date (on time)
      },
    ];

    for (const inv of clientAInvoices) {
      insertInvoice.run(
        inv.id,
        clientAId,
        inv.number,
        inv.amount,
        'USD',
        inv.issue,
        inv.due,
        'PAID',
        'Net-14',
        'Web development and maintenance',
        `${inv.issue} 10:00:00`
      );

      insertPayment.run(
        `pay_${inv.id}`,
        inv.id,
        inv.amount,
        inv.paid,
        'PAYPAL',
        `PP-TXN-${inv.id}`,
        `${inv.paid} 14:00:00`
      );
    }

    // -------------------------------------------------------------
    // Client (b): Chronically Late - late on 3 of last 4 invoices, ~19 days late avg
    // -------------------------------------------------------------
    const clientBId = 'client_late_02';
    insertClient.run(
      clientBId,
      'Chronically Late Inc (Bob Slow)',
      'bob@lateinc.com',
      'Lagging Dynamics Inc',
      '2026-04-20 10:30:00'
    );

    const clientBInvoices = [
      {
        id: 'inv_late_01',
        number: 'INV-LATE-001',
        amount: '1200.00',
        issue: '2026-05-01',
        due: '2026-05-15',
        paid: '2026-05-15', // 0 days late (on time)
        daysLate: 0,
      },
      {
        id: 'inv_late_02',
        number: 'INV-LATE-002',
        amount: '2500.00',
        issue: '2026-06-01',
        due: '2026-06-15',
        paid: '2026-07-03', // 18 days late (June has 30 days: 15 days in June + 3 in July = 18)
        daysLate: 18,
      },
      {
        id: 'inv_late_03',
        number: 'INV-LATE-003',
        amount: '1750.00',
        issue: '2026-07-01',
        due: '2026-07-15',
        paid: '2026-08-04', // 20 days late (July has 31 days: 16 days in July + 4 in Aug = 20)
        daysLate: 20,
      },
      {
        id: 'inv_late_04',
        number: 'INV-LATE-004',
        amount: '3000.00',
        issue: '2026-08-01',
        due: '2026-08-15',
        paid: '2026-09-03', // 19 days late (August has 31 days: 16 days in Aug + 3 in Sep = 19)
        daysLate: 19,
      },
    ];

    for (const inv of clientBInvoices) {
      insertInvoice.run(
        inv.id,
        clientBId,
        inv.number,
        inv.amount,
        'USD',
        inv.issue,
        inv.due,
        'PAID',
        'Net-14',
        `Marketing strategy package (Paid ${inv.daysLate} days late)`,
        `${inv.issue} 10:00:00`
      );

      insertPayment.run(
        `pay_${inv.id}`,
        inv.id,
        inv.amount,
        inv.paid,
        'PAYPAL',
        `PP-TXN-${inv.id}`,
        `${inv.paid} 16:30:00`
      );
    }

    // -------------------------------------------------------------
    // Client (c): New - no history
    // -------------------------------------------------------------
    const clientCId = 'client_new_03';
    insertClient.run(
      clientCId,
      'New Horizons Ltd (Claire Startup)',
      'claire@newhorizons.io',
      'New Horizons Ltd',
      '2026-10-25 11:00:00'
    );

    // Initial audit log entry
    insertAuditLog.run(
      'audit_seed_01',
      'DATABASE_SEEDED',
      'system',
      'init',
      'Seeded 3 clients: reliable (4/4 on time), chronically late (3/4 late, avg 19 days), and new (0 invoices).',
      new Date().toISOString()
    );
  });

  seedTransaction();

  // Verify and print summaries
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
