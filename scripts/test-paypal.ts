import { createInvoice, sendInvoice, getInvoice, remindInvoice, recordPayment, ensureEnvLoaded } from '../src/lib/paypal';

async function main() {
  ensureEnvLoaded();
  console.log('🚀 Running PayPal Invoicing test (with Reminder & Payment)...');

  const recipientEmail = process.env.PAYPAL_TEST_CLIENT_EMAIL;
  if (!recipientEmail) {
    throw new Error('PAYPAL_TEST_CLIENT_EMAIL is not set in .env.local. Please provide a sandbox personal account email.');
  }

  console.log(`📧 Target recipient: ${recipientEmail}`);

  // 1. Create draft invoice for 1 line item ("Test logo design", 1200.00 USD)
  console.log('📝 Step 1: Creating draft invoice with line item "Test logo design" (1200.00 USD)...');
  const invoice = await createInvoice({
    recipientEmail,
    recipientName: {
      given_name: 'Test',
      surname: 'Client',
    },
    items: [
      {
        name: 'Test logo design',
        quantity: '1',
        unit_amount: {
          currency_code: 'USD',
          value: '1200.00',
        },
      },
    ],
    currency: 'USD',
    note: 'Thank you for your business!',
    termType: 'NET_15',
  });

  const invoiceId = invoice.id;
  console.log(`✅ Invoice created successfully! ID: ${invoiceId}`);

  // 2. Send the invoice
  console.log(`📤 Step 2: Sending invoice ${invoiceId}...`);
  await sendInvoice(invoiceId, {
    sendToRecipient: true,
    sendToInvoicer: false,
    subject: 'Invoice for Test logo design',
    note: 'Please find attached your invoice for Test logo design.',
  });
  console.log(`✅ sendInvoice call succeeded.`);

  // Wait 3 seconds, fetch the invoice, verify status is SENT or UNPAID
  console.log('⏳ Waiting 3 seconds for invoice state to propagate...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`🔍 Fetching invoice status after send...`);
  let fetched = await getInvoice(invoiceId);
  console.log(`📊 Status after send: ${fetched.status}`);
  if (fetched.status !== 'SENT' && fetched.status !== 'UNPAID') {
    console.error(`❌ Unexpected status after send: "${fetched.status}". Expected "SENT" or "UNPAID".`);
    process.exit(1);
  }

  // 3. Remind invoice
  console.log(`🔔 Step 3: Sending payment reminder for invoice ${invoiceId}...`);
  await remindInvoice(invoiceId, {
    subject: 'Reminder: Test logo design invoice payment',
    note: 'Friendly reminder that your invoice is due soon. Please let us know if you have questions.',
    sendToRecipient: true,
    sendToInvoicer: false,
  });
  console.log(`✅ remindInvoice call succeeded.`);

  // 4. Record payment for full amount (method "OTHER")
  console.log(`💳 Step 4: Recording payment for full amount 1200.00 USD (method "OTHER")...`);
  await recordPayment(invoiceId, {
    method: 'OTHER',
    amount: '1200.00',
    currency: 'USD',
    note: 'Payment received in full via external transfer',
  });
  console.log(`✅ recordPayment call succeeded.`);

  // 5. Fetch the invoice and print the final status (expect PAID)
  console.log('⏳ Waiting 3 seconds before fetching final invoice status...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`🔍 Step 5: Fetching final invoice status for ${invoiceId}...`);
  fetched = await getInvoice(invoiceId);

  console.log('-------------------------------------------');
  console.log(`📄 Invoice ID:     ${fetched.id}`);
  console.log(`🔢 Invoice Number: ${fetched.detail?.invoice_number}`);
  console.log(`📊 Final Status:   ${fetched.status}`);
  console.log(`💰 Total Amount:   ${fetched.amount?.currency_code} ${fetched.amount?.value}`);
  console.log(`💵 Paid Amount:    ${fetched.payments?.paid_amount?.currency_code || 'USD'} ${fetched.payments?.paid_amount?.value || '1200.00'}`);
  console.log(`📅 Due Date:       ${fetched.detail?.payment_term?.due_date || 'N/A'}`);
  console.log('-------------------------------------------');

  if (fetched.status !== 'PAID' && fetched.status !== 'MARKED_AS_PAID') {
    console.error(`❌ Test failed: Expected final status "PAID" or "MARKED_AS_PAID" but got "${fetched.status}".`);
    process.exit(1);
  }

  console.log(`🎉 PayPal Invoicing full lifecycle test completed successfully! Final status: ${fetched.status}.`);
}

main().catch((err) => {
  console.error('❌ PayPal test failed:', err.message);
  process.exit(1);
});
