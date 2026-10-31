import { scoreClient } from '../src/lib/risk';
import { proposeTerms } from '../src/lib/terms';
import { getDb, closeDb } from '../src/lib/db';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(message);
  }
}

async function runTests() {
  console.log('🧪 Running Task 3 Unit Tests (Risk & Terms Engines)...\n');

  // =========================================================================
  // TEST SUITE 1: Pure Function Unit Tests
  // =========================================================================
  console.log('--- Test Suite 1: Pure Functions (Direct Mock History) ---');

  // 1a. Reliable Client Mock
  const mockReliableHistory = [
    { amount: '1500.00', dueDate: '2026-05-15', paidDate: '2026-05-14' }, // on time
    { amount: '2200.00', dueDate: '2026-06-15', paidDate: '2026-06-15' }, // on time
    { amount: '1800.00', dueDate: '2026-07-15', paidDate: '2026-07-13' }, // on time
    { amount: '3100.00', dueDate: '2026-08-15', paidDate: '2026-08-15' }, // on time
  ];
  const reliableScore = scoreClient(mockReliableHistory, '1200.00');
  console.log(`Reliable Score: ${reliableScore.score}, Level: ${reliableScore.level}`);
  assert(reliableScore.level === 'low', `Expected reliable client level "low", got "${reliableScore.level}"`);
  assert(reliableScore.score <= 35, `Expected low score <= 35, got ${reliableScore.score}`);

  const reliableTerms = proposeTerms(reliableScore.level, '1200.00');
  console.log(`Reliable Terms: ${reliableTerms.summary}, Total: ${reliableTerms.totalAmount}`);
  assert(reliableTerms.termType === 'NET_14', `Expected NET_14, got ${reliableTerms.termType}`);
  assert(reliableTerms.totalAmount === '1200.00', `Expected totalAmount "1200.00", got "${reliableTerms.totalAmount}"`);
  console.log('✅ 1a: Reliable mock client passed (low -> Net-14).\n');

  // 1b. Chronically Late Client Mock
  const mockLateHistory = [
    { amount: '1200.00', dueDate: '2026-05-15', paidDate: '2026-05-15' }, // on time
    { amount: '2500.00', dueDate: '2026-06-15', paidDate: '2026-07-03' }, // 18 days late
    { amount: '1750.00', dueDate: '2026-07-15', paidDate: '2026-08-04' }, // 20 days late
    { amount: '3000.00', dueDate: '2026-08-15', paidDate: '2026-09-03' }, // 19 days late
  ];
  const lateScore = scoreClient(mockLateHistory, '1200.00');
  console.log(`Late Score: ${lateScore.score}, Level: ${lateScore.level}`);
  console.log(`Late Reasons: ${JSON.stringify(lateScore.reasons)}`);
  assert(lateScore.level === 'high', `Expected chronically late client level "high", got "${lateScore.level}"`);
  assert(lateScore.score >= 70, `Expected high score >= 70, got ${lateScore.score}`);
  assert(
    lateScore.reasons.some((r) => r.includes('Paid late on 3 of the last 4 invoices')),
    'Expected reason "Paid late on 3 of the last 4 invoices"'
  );
  assert(
    lateScore.reasons.some((r) => r.includes('Average 19 days late')),
    'Expected reason "Average 19 days late"'
  );

  const lateTerms = proposeTerms(lateScore.level, '1200.00');
  console.log(`Late Terms: ${lateTerms.summary}, Deposit: ${lateTerms.depositAmount}, Delivery: ${lateTerms.deliveryAmount}`);
  assert(lateTerms.termType === 'DEPOSIT_AND_DELIVERY', `Expected DEPOSIT_AND_DELIVERY, got ${lateTerms.termType}`);
  assert(lateTerms.depositAmount === '480.00', `Expected depositAmount "480.00" (40%), got "${lateTerms.depositAmount}"`);
  assert(lateTerms.deliveryAmount === '720.00', `Expected deliveryAmount "720.00" (60%), got "${lateTerms.deliveryAmount}"`);
  assert(lateTerms.totalAmount === '1200.00', `Expected totalAmount "1200.00", got "${lateTerms.totalAmount}"`);
  console.log('✅ 1b: Chronically late mock client passed (high -> 40% deposit / 60% on delivery).\n');

  // 1c. New Client Mock
  const mockNewHistory: any[] = [];
  const newScore = scoreClient(mockNewHistory, '1200.00');
  console.log(`New Client Score: ${newScore.score}, Level: ${newScore.level}`);
  console.log(`New Client Reasons: ${JSON.stringify(newScore.reasons)}`);
  assert(newScore.level === 'medium', `Expected new client level "medium", got "${newScore.level}"`);
  assert(newScore.score === 50, `Expected new client score 50, got ${newScore.score}`);
  assert(
    newScore.reasons.includes('New client, no payment history'),
    'Expected reason "New client, no payment history"'
  );

  const newTerms = proposeTerms(newScore.level, '1200.00');
  console.log(`New Client Terms: ${newTerms.summary}, Discounted: ${newTerms.discountedAmount}`);
  assert(newTerms.termType === 'NET_7', `Expected NET_7, got ${newTerms.termType}`);
  assert(newTerms.discountPercentage === 2, `Expected 2% discount, got ${newTerms.discountPercentage}`);
  assert(newTerms.discountAmount === '24.00', `Expected discountAmount "24.00", got "${newTerms.discountAmount}"`);
  assert(newTerms.discountedAmount === '1176.00', `Expected discountedAmount "1176.00", got "${newTerms.discountedAmount}"`);
  assert(newTerms.totalAmount === '1200.00', `Expected totalAmount "1200.00", got "${newTerms.totalAmount}"`);
  console.log('✅ 1c: New client mock passed (medium -> Net-7 + 2% discount).\n');

  // =========================================================================
  // TEST SUITE 2: Seeded SQLite Database Clients Integration Test
  // =========================================================================
  console.log('--- Test Suite 2: Seeded Database Clients Evaluation ---');
  const db = getDb();

  const getClientHistory = (clientId: string) => {
    return db.prepare(`
      SELECT 
        i.amount,
        i.due_date as dueDate,
        p.payment_date as paidDate,
        i.status
      FROM invoices i
      LEFT JOIN payments p ON i.id = p.invoice_id
      WHERE i.client_id = ?
      ORDER BY i.issue_date ASC
    `).all(clientId) as any[];
  };

  // 2a. Database: Reliable Corp (client_reliable_01)
  const dbReliableHistory = getClientHistory('client_reliable_01');
  const dbReliableScore = scoreClient(dbReliableHistory, 1200);
  console.log(`[DB] Reliable Client: ${dbReliableHistory.length} invoices, Level: ${dbReliableScore.level}`);
  assert(dbReliableScore.level === 'low', `DB Reliable should be "low", got "${dbReliableScore.level}"`);
  const dbReliableTerms = proposeTerms(dbReliableScore.level, 1200);
  assert(dbReliableTerms.summary === 'Net-14', `Expected Net-14 summary`);
  console.log('✅ 2a: Database reliable client passed.\n');

  // 2b. Database: Chronically Late Inc (client_late_02)
  const dbLateHistory = getClientHistory('client_late_02');
  const dbLateScore = scoreClient(dbLateHistory, 1200);
  console.log(`[DB] Late Client: ${dbLateHistory.length} invoices, Level: ${dbLateScore.level}, Reasons: ${dbLateScore.reasons.join('; ')}`);
  assert(dbLateScore.level === 'high', `DB Late client should be "high", got "${dbLateScore.level}"`);
  assert(
    dbLateScore.reasons.some((r) => r.includes('Paid late on 3 of the last 4 invoices')),
    'DB Late client must report "Paid late on 3 of the last 4 invoices"'
  );
  assert(
    dbLateScore.reasons.some((r) => r.includes('Average 19 days late')),
    'DB Late client must report "Average 19 days late"'
  );
  const dbLateTerms = proposeTerms(dbLateScore.level, 1200);
  assert(dbLateTerms.depositAmount === '480.00', 'Deposit must be 480.00');
  assert(dbLateTerms.deliveryAmount === '720.00', 'Delivery balance must be 720.00');
  console.log('✅ 2b: Database chronically late client passed.\n');

  // 2c. Database: New Horizons Ltd (client_new_03)
  const dbNewHistory = getClientHistory('client_new_03');
  const dbNewScore = scoreClient(dbNewHistory, 1200);
  console.log(`[DB] New Client: ${dbNewHistory.length} invoices, Level: ${dbNewScore.level}, Reasons: ${dbNewScore.reasons.join('; ')}`);
  assert(dbNewScore.level === 'medium', `DB New client should be "medium", got "${dbNewScore.level}"`);
  assert(
    dbNewScore.reasons.includes('New client, no payment history'),
    'DB New client must report "New client, no payment history"'
  );
  const dbNewTerms = proposeTerms(dbNewScore.level, 1200);
  assert(dbNewTerms.discountAmount === '24.00', 'Discount must be 24.00');
  assert(dbNewTerms.discountedAmount === '1176.00', 'Discounted amount must be 1176.00');
  console.log('✅ 2c: Database new client passed.\n');

  closeDb();
  console.log('🎉 All Task 3 unit and integration tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
