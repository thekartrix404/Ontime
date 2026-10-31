import { createInvoice, sendInvoice, getInvoice, ensureEnvLoaded } from '../src/lib/paypal';

async function main() {
  ensureEnvLoaded();
  console.log('🚀 Running PayPal Invoicing test...');

  const recipientEmail = process.env.PAYPAL_TEST_CLIENT_EMAIL;
  if (!recipientEmail) {
    throw new Error('PAYPAL_TEST_CLIENT_EMAIL is not set in .env.local. Please provide a sandbox personal account email.');
  }

  console.log(`📧 Target recipient: ${recipientEmail}`);

  // 1. Create an invoice for 1 line item ("Test logo design", 1200.00 USD)
  console.log('📝 Creating draft invoice with line item "Test logo design" (1200.00 USD)...');
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
  console.log(`📤 Sending invoice ${invoiceId}...`);
  await sendInvoice(invoiceId, {
    sendToRecipient: true,
    sendToInvoicer: false,
    subject: 'Invoice for Test logo design',
    note: 'Please find attached your invoice for Test logo design.',
  });
  console.log(`✅ sendInvoice call succeeded.`);

  // 3. Wait 3 seconds, fetch the invoice again, and print status
  console.log('⏳ Waiting 3 seconds before fetching invoice status...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`🔍 Fetching invoice status for ${invoiceId}...`);
  const fetched = await getInvoice(invoiceId);

  console.log('-------------------------------------------');
  console.log(`📄 Invoice ID:     ${fetched.id}`);
  console.log(`🔢 Invoice Number: ${fetched.detail?.invoice_number}`);
  console.log(`📊 Status:         ${fetched.status}`);
  console.log(`💰 Amount:         ${fetched.amount?.currency_code} ${fetched.amount?.value}`);
  console.log(`📅 Due Date:       ${fetched.detail?.payment_term?.due_date || 'N/A'}`);
  console.log('-------------------------------------------');

  // 4. Fail the script (non-zero exit) if final status is not SENT or UNPAID
  if (fetched.status !== 'SENT' && fetched.status !== 'UNPAID') {
    console.error(`❌ Test failed: Final status is "${fetched.status}". Expected "SENT" or "UNPAID".`);
    process.exit(1);
  }

  console.log(`🎉 PayPal Invoicing integration test completed successfully! Status is ${fetched.status}.`);
}

main().catch((err) => {
  console.error('❌ PayPal test failed:', err.message);
  process.exit(1);
});
