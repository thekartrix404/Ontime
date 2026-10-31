import { extractInvoice } from '../src/lib/extract';
import { explainRecommendation } from '../src/lib/explain';
import { proposeTerms } from '../src/lib/terms';

async function runTests() {
  console.log('====================================================');
  console.log('Testing Task 4: Gemini LLM Integration');
  console.log('Model: gemini-3.8-flash | Thinking: low');
  console.log('====================================================\n');

  // Sample 1: A clear, complete email
  const sample1 = `Hi Alex,
Thanks for the kickoff call yesterday! As discussed, please send the invoice to Sarah Connor at sarah.connor@cyberdyne.example.com for the "Cybersecurity Architecture Review".
The fixed scope price is $1,500.00 USD.
Best regards,
Sarah Connor`;

  console.log('--- TEST 1: Clear Sample Email ---');
  console.log('Input Email:\n', sample1.trim(), '\n');
  const res1 = await extractInvoice(sample1);
  console.log('Extraction Result 1:');
  console.log(JSON.stringify(res1, null, 2));

  if (!res1.success || !res1.data) {
    throw new Error('Test 1 failed: Expected successful extraction');
  }
  if (!res1.data.client_email || res1.data.line_items.length !== 1) {
    throw new Error('Test 1 failed: Expected client_email and 1 line item');
  }
  console.log('✅ Test 1 extraction passed!\n');

  // Sample 1 Explanation test (pre-calculated terms from code)
  console.log('Testing explainRecommendation for Test 1 (Low Risk):');
  const terms1 = proposeTerms('low', '1500.00');
  const explanation1 = await explainRecommendation(
    15,
    'low',
    ['Client has paid all 6 previous invoices on time', 'Average days late: 0'],
    terms1
  );
  console.log('Generated Explanation:');
  console.log(`"${explanation1}"`);
  console.log('✅ Test 1 explanation generated!\n');

  // Sample 2: Missing client email
  const sample2 = `Hello team,
Here is the approval for the Website Redesign milestone. You can address the invoice to Acme Corp, attention Marcus Vance.
We have 1 deliverable: "Homepage and Navigation Redesign" for $2,000 USD.
Thanks,
Marcus`;

  console.log('--- TEST 2: Email Missing Client Email ---');
  console.log('Input Email:\n', sample2.trim(), '\n');
  const res2 = await extractInvoice(sample2);
  console.log('Extraction Result 2:');
  console.log(JSON.stringify(res2, null, 2));

  if (res2.success) {
    throw new Error('Test 2 failed: Expected failure due to missing client_email');
  }
  if (!res2.missingFields.includes('client_email')) {
    throw new Error('Test 2 failed: missingFields should list client_email');
  }
  console.log('✅ Test 2 missing fields check passed! (Identified missing client_email instead of guessing)\n');

  // Sample 3: Email with two line items
  const sample3 = `Alex,
Please send over the invoice to Wayne Enterprises (finance@wayne-enterprises.example.com) attention Bruce Wayne for the recent contract deliverables:
1. Mobile App Security Audit - 1 unit at $2,400.00
2. Cloud API Integration - 2 units at $600.00 each
Currency is USD.
Thanks!`;

  console.log('--- TEST 3: Email With Two Line Items ---');
  console.log('Input Email:\n', sample3.trim(), '\n');
  const res3 = await extractInvoice(sample3);
  console.log('Extraction Result 3:');
  console.log(JSON.stringify(res3, null, 2));

  if (!res3.success || !res3.data) {
    throw new Error('Test 3 failed: Expected successful extraction');
  }
  if (res3.data.line_items.length !== 2) {
    throw new Error(`Test 3 failed: Expected 2 line items, got ${res3.data.line_items.length}`);
  }
  console.log('✅ Test 3 extraction passed! (Successfully extracted multiple line items)\n');

  // Sample 3 Explanation test (High Risk with deposit & delivery calculated in code)
  console.log('Testing explainRecommendation for Test 3 (High Risk):');
  // 1 * 2400 + 2 * 600 = 3600.00
  const totalAmount = res3.data.line_items
    .reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
    .toFixed(2);
  const terms3 = proposeTerms('high', totalAmount);
  const explanation3 = await explainRecommendation(
    78,
    'high',
    ['Paid late on 3 of the last 4 invoices', 'Average 19 days late on past invoices'],
    terms3
  );
  console.log('Generated Explanation:');
  console.log(`"${explanation3}"`);
  console.log('✅ Test 3 explanation generated!\n');

  console.log('====================================================');
  console.log('All Task 4 LLM tests passed successfully!');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
