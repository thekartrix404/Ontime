import { getDb, closeDb } from '../src/lib/db';
import { setSimulatedNow, advanceSimulatedDays, computeDaysOverdue, resetClock } from '../src/lib/clock';
import { runFollowUpAgent } from '../src/lib/agent';
import { ensureEnvLoaded, getPaymentProvider } from '../src/lib/paypal';

// Default to mock mode unless --live is explicitly passed
const isLive = process.argv.includes('--live');
if (!isLive) {
  process.env.LLM_MODE = 'mock';
  process.env.PAYPAL_MODE = 'mock';
} else {
  delete process.env.LLM_MODE;
}

ensureEnvLoaded();

async function runAgentTests() {
  console.log('====================================================');
  console.log(`Testing Task 6: Follow-up Agent, Guard, and Time-Travel`);
  console.log(`Mode: ${isLive ? 'LIVE (Gemini API)' : 'MOCK (deterministic/canned)'}`);
  console.log('====================================================\n');

  const db = getDb();

  // 1. Setup clean test invoice in SENT status
  console.log('--- STEP 1: Setting up test environment & seeded SENT invoice ---');
  db.exec(`
    DELETE FROM approval_queue;
    DELETE FROM audit_log;
    DELETE FROM followups;
    DELETE FROM payments WHERE invoice_id NOT IN ('inv_rel_01', 'inv_rel_02', 'inv_rel_03', 'inv_rel_04', 'inv_late_01', 'inv_late_02', 'inv_late_03', 'inv_late_04');
    DELETE FROM invoices WHERE id NOT IN ('inv_rel_01', 'inv_rel_02', 'inv_rel_03', 'inv_rel_04', 'inv_late_01', 'inv_late_02', 'inv_late_03', 'inv_late_04');
    DELETE FROM clients WHERE id = 'client_agent_test';
  `);

  const baseDate = new Date('2026-11-01T00:00:00.000Z');
  setSimulatedNow(baseDate);

  // Client
  db.prepare(`
    INSERT INTO clients (id, name, email, company, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'client_agent_test',
    'Acme Corporation (John Doe)',
    'john@acme-corp.example.com',
    'Acme Corporation',
    '2026-10-01 00:00:00'
  );

  // Create real mock invoice in provider so PayPal remind can succeed
  const provider = getPaymentProvider();
  let paypalInvoiceId: string | null = null;
  try {
    const draft = await provider.createInvoice({
      recipientEmail: 'john@acme-corp.example.com',
      recipientName: {
        given_name: 'John',
        surname: 'Doe',
      },
      items: [
        {
          name: 'System Consulting',
          quantity: '1',
          unit_amount: {
            currency_code: 'USD',
            value: '2000.00',
          },
        },
      ],
      currency: 'USD',
      dueDate: '2026-11-01',
    });
    paypalInvoiceId = draft.invoiceId;
  } catch (err: any) {
    console.warn('Sandbox invoice creation fallback for test:', err.message);
    paypalInvoiceId = `MOCK-TEST-INV-${Date.now()}`;
  }

  // Insert invoice with due date 2026-11-01 and status SENT
  db.prepare(`
    INSERT INTO invoices (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, paypal_invoice_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'inv_agent_test',
    'client_agent_test',
    'INV-TEST-AGENT-001',
    '2000.00',
    'USD',
    '2026-10-15',
    '2026-11-01',
    'SENT',
    paypalInvoiceId,
    '2026-10-15 00:00:00'
  );

  console.log('✅ Seeded invoice INV-TEST-AGENT-001 (SENT, due 2026-11-01, $2,000.00 USD)\n');

  // ------------------------------------------------------------------------
  // TEST A: +5 Days -> Reminder sent via PayPal
  // ------------------------------------------------------------------------
  console.log('--- TEST A: Advance +5 days (due date + 5 days -> nudge tone) ---');
  advanceSimulatedDays(5); // Now is 2026-11-06 (5 days overdue)
  const daysOverdueA = computeDaysOverdue('2026-11-01');
  console.log(`Current Days Overdue: ${daysOverdueA}`);

  const runA = await runFollowUpAgent();
  console.log(`Decisions count: ${runA.decisions.length}`);

  const decA = runA.decisions.find((d) => d.invoiceId === 'inv_agent_test');
  if (!decA) {
    throw new Error('Test A failed: Expected decision for inv_agent_test at +5 days');
  }

  console.log('Decision A:', decA.decision, '| Tool:', decA.tool, '| Tone:', decA.args.tone);
  console.log('Approved by:', decA.approvedBy, '| Rule:', decA.ruleApplied);

  if (decA.decision !== 'allowed') {
    throw new Error(`Test A failed: Expected 'allowed' decision for +5 days (nudge), got ${decA.decision}`);
  }
  if (decA.approvedBy !== 'auto') {
    throw new Error(`Test A failed: Expected approvedBy 'auto', got ${decA.approvedBy}`);
  }

  // Check followup table
  const followupA = db.prepare('SELECT * FROM followups WHERE invoice_id = ?').get('inv_agent_test') as any;
  if (!followupA || followupA.status !== 'SENT') {
    throw new Error('Test A failed: Expected followup recorded with status SENT');
  }
  console.log('✅ Test A Passed: Reminder successfully sent via PayPal!\n');

  // ------------------------------------------------------------------------
  // TEST B: Idempotence: Clicking +5 twice does not duplicate
  // ------------------------------------------------------------------------
  console.log('--- TEST B: Idempotency Check (re-running agent at +5 days) ---');
  const runB = await runFollowUpAgent();
  console.log(`Decisions count on second run: ${runB.decisions.length}`);
  console.log(`Skipped count: ${runB.skippedInvoices.length}`);

  if (runB.decisions.length > 0) {
    throw new Error(`Test B failed: Expected 0 new decisions on re-run, but got ${runB.decisions.length}`);
  }
  if (runB.skippedInvoices.length === 0) {
    throw new Error('Test B failed: Expected invoice to be skipped as idempotent');
  }
  console.log(`Skip Reason: ${runB.skippedInvoices[0].reason}`);
  console.log('✅ Test B Passed: Re-clicking did not duplicate actions!\n');

  // ------------------------------------------------------------------------
  // TEST C: Advance to +15 days -> Firm attempt BLOCKED and queued
  // ------------------------------------------------------------------------
  console.log('--- TEST C: Advance to +15 days (15 days overdue -> firm tone) ---');
  advanceSimulatedDays(10); // Now is 2026-11-16 (15 days overdue)
  const daysOverdueC = computeDaysOverdue('2026-11-01');
  console.log(`Current Days Overdue: ${daysOverdueC}`);

  const runC = await runFollowUpAgent();
  console.log(`Decisions count: ${runC.decisions.length}`);
  if (runC.decisions.length === 0) {
    throw new Error('Test C failed: Expected agent to evaluate invoice at +15 days');
  }

  const decC = runC.decisions[0];
  console.log('Decision C:', decC.decision, '| Tool:', decC.tool, '| Tone:', decC.args.tone);
  console.log('Rule Applied:', decC.ruleApplied);

  if (decC.decision !== 'blocked') {
    throw new Error(`Test C failed: Expected 'blocked' decision for firm tone at +15 days, got ${decC.decision}`);
  }

  // Check approval queue
  const queueItemC = db.prepare('SELECT * FROM approval_queue WHERE invoice_id = ? AND tone = ?').get('inv_agent_test', 'firm') as any;
  if (!queueItemC) {
    throw new Error('Test C failed: Expected firm reminder in approval_queue');
  }
  console.log('Queue Item ID:', queueItemC.id, '| Status:', queueItemC.status);
  console.log('Blocked Rule:', queueItemC.rule_blocked);
  console.log('✅ Test C Passed: Firm attempt BLOCKED by mandate guard and queued!\n');

  // ------------------------------------------------------------------------
  // TEST D: Advance to +30 days -> Nothing auto-sent, escalation options queued
  // ------------------------------------------------------------------------
  console.log('--- TEST D: Advance to +30 days (30 days overdue -> formal escalation) ---');
  advanceSimulatedDays(15); // Now is 2026-12-01 (30 days overdue)
  const daysOverdueD = computeDaysOverdue('2026-11-01');
  console.log(`Current Days Overdue: ${daysOverdueD}`);

  const runD = await runFollowUpAgent();
  console.log(`Decisions count: ${runD.decisions.length}`);

  // Assert nothing auto-sent
  const autoSentCount = runD.decisions.filter((d) => d.decision === 'allowed').length;
  if (autoSentCount > 0) {
    throw new Error(`Test D failed: Expected 0 auto-sent decisions at +30 days, got ${autoSentCount}`);
  }

  // Assert escalation queued in approval queue
  const queueItemsD = db.prepare(`
    SELECT * FROM approval_queue
    WHERE invoice_id = ? AND (tool = 'draft_escalation' OR tone = 'formal')
  `).all('inv_agent_test') as any[];

  if (queueItemsD.length === 0) {
    throw new Error('Test D failed: Expected escalation draft queued in approval queue');
  }
  console.log('Escalation Queue Item:', queueItemsD[0].tool, '| Tone:', queueItemsD[0].tone);
  console.log('Summary:', queueItemsD[0].message);
  console.log('✅ Test D Passed: Nothing auto-sent, formal escalation queued!\n');

  // Clean up
  resetClock();
  console.log('====================================================');
  console.log('🎉 ALL TASK 6 AGENT & GUARD ASSERTIONS PASSED!');
  console.log('====================================================');
  closeDb();
}

runAgentTests().catch((err) => {
  console.error('\n❌ Agent test suite failed:', err);
  process.exit(1);
});
