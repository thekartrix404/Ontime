import http from 'http';

function fetchUrl(url: string): Promise<{ status: number; body: string; headers: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Testing browser endpoints on http://127.0.0.1:3000...');

  // 1. Verify /api/status
  const statusRes = await fetchUrl('http://127.0.0.1:3000/api/status');
  console.log(`GET /api/status -> status ${statusRes.status}`);
  const statusJson = JSON.parse(statusRes.body);
  console.log('Status payload:', statusJson);
  if (!statusJson.paypalMode || !statusJson.llmMode) {
    throw new Error('Missing paypalMode or llmMode in /api/status');
  }

  // 2. Verify / (New Invoice Page)
  const homeRes = await fetchUrl('http://127.0.0.1:3000/');
  console.log(`GET / -> status ${homeRes.status}`);
  if (homeRes.status !== 200) throw new Error('Home page returned non-200');
  console.log('Home page renders HTML successfully.');

  // 3. Verify /dashboard
  const dashRes = await fetchUrl('http://127.0.0.1:3000/dashboard');
  console.log(`GET /dashboard -> status ${dashRes.status}`);
  if (dashRes.status !== 200) throw new Error('Dashboard page returned non-200');
  console.log('Dashboard page renders HTML successfully.');

  // 4. Verify /audit
  const auditRes = await fetchUrl('http://127.0.0.1:3000/audit');
  console.log(`GET /audit -> status ${auditRes.status}`);
  if (auditRes.status !== 200) throw new Error('Audit page returned non-200');
  console.log('Audit page renders HTML successfully.');

  // 5. Verify /api/dashboard/data
  const dashDataRes = await fetchUrl('http://127.0.0.1:3000/api/dashboard/data');
  console.log(`GET /api/dashboard/data -> status ${dashDataRes.status}`);
  const dashData = JSON.parse(dashDataRes.body);
  console.log('Dashboard data open invoices count:', dashData.invoices?.filter((i: any) => ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status)).length);
  console.log('Dashboard demoEvents:', dashData.demoEvents);
  console.log('Dashboard agentActivity count:', dashData.agentActivity?.length);

  // 6. Verify /api/audit/data
  const auditDataRes = await fetchUrl('http://127.0.0.1:3000/api/audit/data');
  console.log(`GET /api/audit/data -> status ${auditDataRes.status}`);
  const auditData = JSON.parse(auditDataRes.body);
  console.log('Audit data logs count:', auditData.logs?.length);

  console.log('\n🎉 BROWSER & SERVER VERIFICATION SUCCESSFUL!');
}

main().catch((err) => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});

