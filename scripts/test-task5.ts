import { getDb } from '../src/lib/db';
import { extractInvoice } from '../src/lib/extract';
import { scoreClient } from '../src/lib/risk';
import { proposeTerms } from '../src/lib/terms';
import { explainRecommendation } from '../src/lib/explain';
import { getPaymentProvider, ensureEnvLoaded } from '../src/lib/paypal';

ensureEnvLoaded();

async function runTask5Verification() {
  console.log('====================================================');
  console.log('Testing Task 5: Paste Page and Approval Flow Logic');
  console.log('====================================================\n');

  const db = getDb();

  // Clean up any previously generated test invoices so seeded history is clean
  db.exec(`
    DELETE FROM invoices WHERE id NOT IN ('inv_rel_01', 'inv_rel_02', 'inv_rel_03', 'inv_rel_04', 'inv_late_01', 'inv_late_02', 'inv_late_03', 'inv_late_04');
  `);

  // Test 1: Reliable client draft flow
  console.log('--- TEST 1: Reliable Client Flow (Alice Vance) ---');
  const reliableEmail = `Hi Alex,
Thanks for completing the quarterly web maintenance.
Please invoice Reliable Solutions LLC, attention Alice Vance (alice@reliablecorp.com) for "Quarterly Web Maintenance", 1 unit at $1,800.00 USD.
Thanks, Alice`;

  const ext1 = await extractInvoice(reliableEmail);
  console.log('Extracted Company:', ext1.data?.company);
  console.log('Extracted Client Name:', ext1.data?.client_name);
  console.log('Extracted Email:', ext1.data?.client_email);

  const client1 = db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get('alice@reliablecorp.com') as any;
  const history1 = db.prepare(`
    SELECT i.amount, i.due_date as dueDate, p.payment_date as paidDate, i.status
    FROM invoices i
    LEFT JOIN payments p ON p.invoice_id = i.id
    WHERE i.client_id = ?
  `).all(client1.id) as any[];

  const risk1 = scoreClient(history1, '1800.00');
  const terms1 = proposeTerms(risk1.level, '1800.00');
  const explain1 = await explainRecommendation(risk1.score, risk1.level, risk1.reasons, terms1, risk1.metrics);

  console.log('Risk Level:', risk1.level, '| Score:', risk1.score);
  console.log('Proposed Terms:', terms1.summary);
  console.log('AI Explanation:', explain1);

  if (risk1.level !== 'low') throw new Error(`Expected low risk for reliable client, got ${risk1.level}`);
  console.log('✅ Test 1 Passed!\n');

  // Test 2: Chronically Late client draft flow (High Risk -> 40/60 Split)
  console.log('--- TEST 2: Chronically Late Client Flow (Bob Slow) ---');
  const lateEmail = `Hey Alex,
Please invoice Lagging Dynamics Inc for Bob Slow (bob@lateinc.com) for "Q3 Campaign Strategy" ($2,500.00).
Thanks, Bob`;

  const ext2 = await extractInvoice(lateEmail);
  const client2 = db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get('bob@lateinc.com') as any;
  const history2 = db.prepare(`
    SELECT i.amount, i.due_date as dueDate, p.payment_date as paidDate, i.status
    FROM invoices i
    LEFT JOIN payments p ON p.invoice_id = i.id
    WHERE i.client_id = ?
  `).all(client2.id) as any[];

  const risk2 = scoreClient(history2, '2500.00');
  const terms2 = proposeTerms(risk2.level, '2500.00');
  const explain2 = await explainRecommendation(risk2.score, risk2.level, risk2.reasons, terms2, risk2.metrics);

  console.log('Risk Level:', risk2.level, '| Score:', risk2.score);
  console.log('Proposed Terms:', terms2.summary);
  console.log('Deposit (40%):', terms2.depositAmount);
  console.log('Delivery (60%):', terms2.deliveryAmount);
  console.log('AI Explanation:', explain2);

  if (risk2.level !== 'high') throw new Error(`Expected high risk for late client, got ${risk2.level}`);
  if (terms2.depositAmount !== '1000.00' || terms2.deliveryAmount !== '1500.00') {
    throw new Error(`Expected 1000.00 deposit and 1500.00 balance, got ${terms2.depositAmount} / ${terms2.deliveryAmount}`);
  }
  console.log('✅ Test 2 Passed!\n');

  // Test 3: New client draft flow (Medium Risk -> Net-7 + 2% discount)
  console.log('--- TEST 3: New Client Flow (Claire Startup) ---');
  const newEmail = `Hi Alex,
Please bill New Horizons Ltd, attention Claire Startup (claire@newhorizons.io) for "Brand Identity" at $1,500.00 USD.
Cheers, Claire`;

  const ext3 = await extractInvoice(newEmail);
  const client3 = db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get('claire@newhorizons.io') as any;
  const history3 = db.prepare(`
    SELECT i.amount, i.due_date as dueDate, p.payment_date as paidDate, i.status
    FROM invoices i
    LEFT JOIN payments p ON p.invoice_id = i.id
    WHERE i.client_id = ?
  `).all(client3.id) as any[];

  const risk3 = scoreClient(history3, '1500.00');
  const terms3 = proposeTerms(risk3.level, '1500.00');
  const explain3 = await explainRecommendation(risk3.score, risk3.level, risk3.reasons, terms3, risk3.metrics);

  console.log('Risk Level:', risk3.level, '| Score:', risk3.score);
  console.log('Proposed Terms:', terms3.summary);
  console.log('Discount (2%):', terms3.discountAmount, '| Net Payable:', terms3.discountedAmount);
  console.log('AI Explanation:', explain3);

  if (risk3.level !== 'medium') throw new Error(`Expected medium risk for new client, got ${risk3.level}`);
  if (terms3.discountAmount !== '30.00' || terms3.discountedAmount !== '1470.00') {
    throw new Error(`Expected 30.00 discount and 1470.00 discounted amount`);
  }
  console.log('✅ Test 3 Passed!\n');

  // Test 4: POST /api/approve (Low Risk Net-14)
  console.log('--- TEST 4: POST /api/approve (Low Risk Net-14) ---');
  const { POST: approvePost } = await import('../src/app/api/approve/route');
  const req4 = new Request('http://localhost/api/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Alice Vance',
      company: 'Reliable Solutions LLC',
      client_email: 'alice@reliablecorp.com',
      currency: 'USD',
      project_type: 'Web Maintenance',
      line_items: [{ description: 'Web Maintenance', quantity: 1, unit_price: 1800 }],
      terms_mode: 'PROPOSED',
      risk_level: 'low',
    }),
  });

  const res4 = await approvePost(req4 as any);
  const data4 = await res4.json();
  console.log('Approve response status:', res4.status);
  console.log('Invoices created:', data4.invoices?.length);
  console.log('Payer View URL:', data4.invoices?.[0]?.payer_view_url);

  if (!data4.success || data4.invoices.length !== 1 || data4.invoices[0].status !== 'SENT') {
    throw new Error('Test 4 Failed: Expected 1 SENT invoice');
  }
  console.log('✅ Test 4 Passed!\n');

  // Test 5: POST /api/approve (High Risk 40/60 Split)
  console.log('--- TEST 5: POST /api/approve (High Risk 40/60 Split) ---');
  const req5 = new Request('http://localhost/api/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Bob Slow',
      company: 'Lagging Dynamics Inc',
      client_email: 'bob@lateinc.com',
      currency: 'USD',
      project_type: 'Marketing Campaign',
      line_items: [{ description: 'Marketing Campaign', quantity: 1, unit_price: 2500 }],
      terms_mode: 'PROPOSED',
      risk_level: 'high',
    }),
  });

  const res5 = await approvePost(req5 as any);
  const data5 = await res5.json();
  console.log('High risk invoices created:', data5.invoices?.length);
  const depInv = data5.invoices.find((i: any) => i.is_deposit);
  const balInv = data5.invoices.find((i: any) => i.is_delivery);

  console.log(`Deposit invoice: ${depInv?.invoice_number} | Status: ${depInv?.status} | Amount: $${depInv?.amount}`);
  console.log(`Balance invoice: ${balInv?.invoice_number} | Status: ${balInv?.status} | Amount: $${balInv?.amount}`);
  console.log(`Project ID: ${depInv?.project_id}`);

  if (depInv?.status !== 'SENT' || balInv?.status !== 'DRAFT') {
    throw new Error('Test 5 Failed: Expected deposit SENT and balance DRAFT');
  }
  if (!depInv?.project_id || depInv.project_id !== balInv?.project_id) {
    throw new Error('Test 5 Failed: Invoices must be linked by project_id');
  }
  console.log('✅ Test 5 Passed!\n');

  // Test 6: POST /api/deliver (Mark Delivered)
  console.log('--- TEST 6: POST /api/deliver (Mark Delivered) ---');
  const { POST: deliverPost } = await import('../src/app/api/deliver/route');
  const req6 = new Request('http://localhost/api/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId: balInv.id,
    }),
  });

  const res6 = await deliverPost(req6 as any);
  const data6 = await res6.json();
  console.log('Deliver response status:', res6.status);
  console.log('Balance invoice new status:', data6.invoice?.status);
  console.log('Balance invoice payer view URL:', data6.invoice?.payer_view_url);

  if (!data6.success || data6.invoice?.status !== 'SENT') {
    throw new Error('Test 6 Failed: Expected balance invoice status to transition to SENT');
  }
  console.log('✅ Test 6 Passed!\n');

  // Check audit log
  const auditEntries = db.prepare('SELECT action, details FROM audit_log ORDER BY created_at DESC LIMIT 5').all() as any[];
  console.log('Recent Audit Log Entries:');
  auditEntries.forEach((e) => console.log(`  [${e.action}] ${e.details}`));

  console.log('\n====================================================');
  console.log('All Task 5 verification tests passed successfully!');
  console.log('====================================================');
}

runTask5Verification().catch((err) => {
  console.error('\n❌ Task 5 verification failed:', err);
  process.exit(1);
});

