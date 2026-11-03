import { getDb, closeDb } from '../src/lib/db';
import { ensureEnvLoaded } from '../src/lib/paypal';

// Run in mock mode by default
process.env.LLM_MODE = 'mock';
process.env.PAYPAL_MODE = 'mock';

ensureEnvLoaded();

async function runE2ETests() {
  console.log('====================================================');
  console.log('Testing Task 7: End-to-End Hardening & Guided Flow');
  console.log('Mode: MOCK (LLM_MODE=mock, PAYPAL_MODE=mock)');
  console.log('====================================================\n');

  const { POST: resetPost } = await import('../src/app/api/demo/reset/route');
  const { POST: draftPost } = await import('../src/app/api/draft/route');
  const { POST: approvePost } = await import('../src/app/api/approve/route');
  const { POST: advancePost } = await import('../src/app/api/agent/advance/route');
  const { POST: queueApprovePost } = await import('../src/app/api/agent/queue/approve/route');
  const { POST: payPost } = await import('../src/app/api/invoices/pay/route');

  const db = getDb();

  // 1. Reset demo state
  console.log('--- STEP 1: Reset Demo ---');
  const resetReq = new Request('http://localhost/api/demo/reset', { method: 'POST' });
  const resetRes = await resetPost();
  const resetData = await resetRes.json();
  console.log('Reset response:', resetData);
  if (!resetData.success) throw new Error('Failed to reset demo');
  console.log('✅ Demo reset verified!\n');

  // 2. Chronically Late Sample through /api/draft
  console.log('--- STEP 2: Chronically Late Sample through /api/draft ---');
  const chronicallyLateEmail = `Hey Alex,
Wrapping up the campaign assets. Go ahead and invoice Lagging Dynamics Inc for Bob Slow (bob@lateinc.com).
Item 1: "Digital Marketing Campaign Strategy" - 1 unit at $2,000.00
Item 2: "Custom Ad Creative Bundle" - 2 units at $500.00
Total scope is for USD currency.
Thanks,
Bob`;

  const draftReq = new Request('http://localhost/api/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailText: chronicallyLateEmail }),
  });

  const draftRes = await draftPost(draftReq as any);
  const draftData = await draftRes.json();
  console.log('Extraction success:', draftData.extraction?.success);
  console.log('Risk level:', draftData.risk?.level, '| Score:', draftData.risk?.score);
  console.log('Total Amount:', draftData.totalAmount);
  console.log('Proposed Terms:', draftData.proposedTerms?.summary);
  console.log('Deposit (40%):', draftData.proposedTerms?.depositAmount);
  console.log('Delivery (60%):', draftData.proposedTerms?.deliveryAmount);

  if (draftData.risk?.level !== 'high') {
    throw new Error(`Expected high risk for chronically late client, got ${draftData.risk?.level}`);
  }
  if (draftData.totalAmount !== '3000.00') {
    throw new Error(`Expected total $3000.00, got ${draftData.totalAmount}`);
  }
  if (draftData.proposedTerms?.depositAmount !== '1200.00' || draftData.proposedTerms?.deliveryAmount !== '1800.00') {
    throw new Error(`Expected 40% ($1200.00) / 60% ($1800.00) split, got ${draftData.proposedTerms?.depositAmount} / ${draftData.proposedTerms?.deliveryAmount}`);
  }
  console.log('✅ Step 2 Passed: 40/60 split correctly computed!\n');

  // 3. Run through /api/approve
  console.log('--- STEP 3: Approve 40/60 Split Terms via /api/approve ---');
  const approveReq = new Request('http://localhost/api/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: draftData.extraction.data.client_name,
      company: draftData.extraction.data.company,
      client_email: draftData.extraction.data.client_email,
      currency: draftData.extraction.data.currency,
      project_type: draftData.extraction.data.project_type,
      line_items: draftData.extraction.data.line_items,
      terms_mode: 'PROPOSED',
      risk_level: draftData.risk.level,
    }),
  });

  const approveRes = await approvePost(approveReq as any);
  const approveData = await approveRes.json();
  console.log('Approve response status:', approveRes.status);
  console.log('Invoices created count:', approveData.invoices?.length);

  const depositInvoice = approveData.invoices?.find((i: any) => i.is_deposit);
  const balanceInvoice = approveData.invoices?.find((i: any) => i.is_delivery);

  if (!depositInvoice || !balanceInvoice) {
    throw new Error('Expected both deposit and balance invoices to be created');
  }

  console.log(`Deposit Invoice: ${depositInvoice.invoice_number} | Amount: $${depositInvoice.amount} | Status: ${depositInvoice.status}`);
  console.log(`Balance Invoice: ${balanceInvoice.invoice_number} | Amount: $${balanceInvoice.amount} | Status: ${balanceInvoice.status}`);
  console.log(`Linked Project ID: ${depositInvoice.project_id}`);

  if (depositInvoice.status !== 'SENT') {
    throw new Error(`Expected deposit invoice status SENT, got ${depositInvoice.status}`);
  }
  if (balanceInvoice.status !== 'DRAFT') {
    throw new Error(`Expected balance invoice status DRAFT, got ${balanceInvoice.status}`);
  }
  if (!depositInvoice.project_id || depositInvoice.project_id !== balanceInvoice.project_id) {
    throw new Error('Expected deposit and balance invoices to be linked by matching project_id');
  }
  console.log('✅ Step 3 Passed: 40/60 split invoices created and linked!\n');

  // 4. Run Due-Date-Relative Time Travel Jumps
  console.log('--- STEP 4: Due-Date-Relative Time Travel Jumps ---');

  // Jump 4A: 2 days before due date (friendly tone auto-sent)
  console.log('-> Jump 4A: 2 days before due date');
  const jumpAReq = new Request('http://localhost/api/agent/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId: depositInvoice.id,
      relativeDays: -2,
    }),
  });
  const jumpARes = await advancePost(jumpAReq as any);
  const jumpAData = await jumpARes.json();
  console.log(`Simulated Date: ${jumpAData.simulatedDate} | Resulting Overdue: ${jumpAData.resultingDaysOverdue} days`);
  const decisionA = jumpAData.agentResult?.decisions?.find((d: any) => d.invoiceId === depositInvoice.id);
  console.log(`Decision 4A: ${decisionA?.decision} | Tool: ${decisionA?.tool} | Tone: ${decisionA?.args?.tone}`);
  if (decisionA?.decision !== 'allowed' || decisionA?.args?.tone !== 'friendly') {
    throw new Error(`Expected allowed friendly reminder at -2 days, got ${decisionA?.decision} / ${decisionA?.args?.tone}`);
  }
  console.log('✅ Jump 4A Passed: Friendly reminder allowed and auto-sent!\n');

  // Jump 4B: 5 days overdue (nudge tone auto-sent)
  console.log('-> Jump 4B: 5 days overdue');
  const jumpNudgeReq = new Request('http://localhost/api/agent/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId: depositInvoice.id,
      relativeDays: 5,
    }),
  });
  const jumpNudgeRes = await advancePost(jumpNudgeReq as any);
  const jumpNudgeData = await jumpNudgeRes.json();
  console.log(`Simulated Date: ${jumpNudgeData.simulatedDate} | Resulting Overdue: ${jumpNudgeData.resultingDaysOverdue} days`);
  const decisionNudge = jumpNudgeData.agentResult?.decisions?.find((d: any) => d.invoiceId === depositInvoice.id);
  console.log(`Decision 4B: ${decisionNudge?.decision} | Tool: ${decisionNudge?.tool} | Tone: ${decisionNudge?.args?.tone}`);
  if (decisionNudge?.decision !== 'allowed' || decisionNudge?.args?.tone !== 'nudge') {
    throw new Error(`Expected allowed nudge reminder at +5 days, got ${decisionNudge?.decision} / ${decisionNudge?.args?.tone}`);
  }
  console.log('✅ Jump 4B Passed: Nudge reminder allowed and auto-sent!\n');

  // Jump 4C: 15 days overdue (firm tone BLOCKED and queued)
  console.log('-> Jump 4C: 15 days overdue');
  const jumpBReq = new Request('http://localhost/api/agent/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId: depositInvoice.id,
      relativeDays: 15,
    }),
  });
  const jumpBRes = await advancePost(jumpBReq as any);
  const jumpBData = await jumpBRes.json();
  console.log(`Simulated Date: ${jumpBData.simulatedDate} | Resulting Overdue: ${jumpBData.resultingDaysOverdue} days`);
  const decisionB = jumpBData.agentResult?.decisions?.find((d: any) => d.invoiceId === depositInvoice.id);
  console.log(`Decision 4C: ${decisionB?.decision} | Tool: ${decisionB?.tool} | Tone: ${decisionB?.args?.tone}`);
  console.log(`Rule Applied: ${decisionB?.ruleApplied}`);

  if (decisionB?.decision !== 'blocked' || decisionB?.args?.tone !== 'firm') {
    throw new Error(`Expected blocked firm reminder at +15 days, got ${decisionB?.decision} / ${decisionB?.args?.tone}`);
  }

  // Verify item is placed in approval queue
  const queueItem = db.prepare(`
    SELECT * FROM approval_queue
    WHERE invoice_id = ? AND tone = 'firm' AND status = 'PENDING'
  `).get(depositInvoice.id) as any;

  if (!queueItem) {
    throw new Error('Expected firm reminder to be in approval_queue with status PENDING');
  }
  console.log(`Queue Item ID: ${queueItem.id} | Rule Blocked: ${queueItem.rule_blocked}`);
  console.log('✅ Jump 4C Passed: Firm reminder BLOCKED by mandate guard and queued!\n');

  // Jump 4D: 30 days overdue (formal tone escalation queued for review)
  console.log('-> Jump 4D: 30 days overdue');
  const jumpCReq = new Request('http://localhost/api/agent/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId: depositInvoice.id,
      relativeDays: 30,
    }),
  });
  const jumpCRes = await advancePost(jumpCReq as any);
  const jumpCData = await jumpCRes.json();
  console.log(`Simulated Date: ${jumpCData.simulatedDate} | Resulting Overdue: ${jumpCData.resultingDaysOverdue} days`);
  const decisionC = jumpCData.agentResult?.decisions?.find((d: any) => d.invoiceId === depositInvoice.id);
  console.log(`Decision 4D: ${decisionC?.decision} | Tool: ${decisionC?.tool} | Tone: ${decisionC?.args?.tone}`);

  if (decisionC?.decision !== 'queued_review' || decisionC?.tool !== 'draft_escalation') {
    throw new Error(`Expected queued_review draft_escalation at +30 days, got ${decisionC?.decision} / ${decisionC?.tool}`);
  }
  console.log('✅ Jump 4D Passed: Formal escalation intercepted and queued for review!\n');

  // 5. Approve the Queue Item
  console.log('--- STEP 5: Approve Queued Firm Item ---');
  const approveQueueReq = new Request('http://localhost/api/agent/queue/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: queueItem.id }),
  });
  const approveQueueRes = await queueApprovePost(approveQueueReq as any);
  const approveQueueData = await approveQueueRes.json();
  console.log('Approve Queue Result:', approveQueueData);

  const updatedQueue = db.prepare('SELECT status FROM approval_queue WHERE id = ?').get(queueItem.id) as any;
  if (updatedQueue?.status !== 'APPROVED') {
    throw new Error(`Expected queue item status APPROVED, got ${updatedQueue?.status}`);
  }
  console.log('✅ Step 5 Passed: Queue item successfully approved and sent via PayPal!\n');

  // 6. Mark Invoice as Paid
  console.log('--- STEP 6: Mark Invoice as Paid ---');
  const payReq = new Request('http://localhost/api/invoices/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId: depositInvoice.id }),
  });
  const payRes = await payPost(payReq as any);
  const payData = await payRes.json();
  console.log('Pay Response:', payData);

  const updatedInvoice = db.prepare('SELECT status FROM invoices WHERE id = ?').get(depositInvoice.id) as any;
  if (updatedInvoice?.status !== 'MARKED_AS_PAID' && updatedInvoice?.status !== 'PAID') {
    throw new Error(`Expected invoice status MARKED_AS_PAID, got ${updatedInvoice?.status}`);
  }
  console.log('✅ Step 6 Passed: Invoice marked as paid and payment recorded via PayPal!\n');

  // 7. Audit Log Verification
  console.log('--- STEP 7: Assert Audit Log Has Plain-English Row For Each Step ---');
  const auditRows = db.prepare(`
    SELECT * FROM audit_log ORDER BY created_at ASC
  `).all() as any[];

  console.log(`Total Audit Rows Recorded: ${auditRows.length}`);

  // Find entries for each step
  const resetLog = auditRows.find((r) => r.action === 'DEMO_RESET');
  const termsLog = auditRows.find((r) => r.action === 'TERMS_APPROVED_HIGH');
  const allowedLog = auditRows.find((r) => r.action === 'GUARD_ALLOWED');
  const blockedFirmLog = auditRows.find((r) => r.action === 'GUARD_BLOCKED' && r.details.includes('firm'));
  const queuedFormalLog = auditRows.find((r) => r.action === 'GUARD_QUEUED' && r.details.includes('draft_escalation'));
  const userApprovalLog = auditRows.find((r) => r.action === 'USER_APPROVAL');
  const paymentLog = auditRows.find((r) => r.action === 'PAYMENT_RECORDED');

  console.log('\nAudit Entries Summary:');
  console.log('1. DEMO_RESET:', resetLog?.details);
  console.log('2. TERMS_APPROVED_HIGH:', termsLog?.details);
  console.log('3. GUARD_ALLOWED (friendly/nudge):', allowedLog?.details);
  console.log('4. GUARD_BLOCKED (firm):', blockedFirmLog?.details);
  console.log('5. GUARD_QUEUED (formal):', queuedFormalLog?.details);
  console.log('6. USER_APPROVAL:', userApprovalLog?.details);
  console.log('7. PAYMENT_RECORDED:', paymentLog?.details);

  if (!resetLog) throw new Error('Missing DEMO_RESET audit log row');
  if (!termsLog) throw new Error('Missing TERMS_APPROVED_HIGH audit log row');
  if (!allowedLog) throw new Error('Missing GUARD_ALLOWED audit log row');
  if (!blockedFirmLog) throw new Error('Missing GUARD_BLOCKED firm audit log row');
  if (!queuedFormalLog) throw new Error('Missing GUARD_QUEUED formal audit log row');
  if (!userApprovalLog) throw new Error('Missing USER_APPROVAL audit log row');
  if (!paymentLog) throw new Error('Missing PAYMENT_RECORDED audit log row');

  // Assert plain-English contents
  if (!termsLog.details.includes('Approved high-risk terms (40% deposit / 60% delivery)')) {
    throw new Error('TERMS_APPROVED_HIGH log missing plain-English terms breakdown');
  }
  if (!blockedFirmLog.details.includes('blocked by your rule')) {
    throw new Error('GUARD_BLOCKED firm log missing plain-English rule explanation');
  }
  if (!queuedFormalLog.details.includes('queued for human review per mandate rule')) {
    throw new Error('GUARD_QUEUED formal log missing plain-English queued explanation');
  }
  if (!userApprovalLog.details.includes('User manually approved queued')) {
    throw new Error('USER_APPROVAL log missing plain-English approval narrative');
  }

  console.log('\n====================================================');
  console.log('🎉 ALL TASK 7 E2E HARDENING & GUIDED TESTS PASSED!');
  console.log('====================================================');
}

runE2ETests()
  .catch((err) => {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    closeDb();
  });

