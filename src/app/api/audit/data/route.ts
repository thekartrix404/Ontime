import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMandateRules } from '@/lib/mandate';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT *
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT 100
    `).all() as any[];

    const logs = rows.map((r) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(r.details);
      } catch {
        parsed = { summaryText: r.details };
      }

      return {
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        createdAt: r.created_at,
        details: parsed,
        summaryText: parsed.summaryText || r.details,
        decision: parsed.decision || (r.action === 'GUARD_ALLOWED' ? 'allowed' : r.action === 'GUARD_BLOCKED' ? 'blocked' : undefined),
        ruleApplied: parsed.ruleApplied,
        approvedBy: parsed.approvedBy,
        source: parsed.source || (r.action === 'FALLBACK_USED' ? 'rule-fallback' : undefined),
        providerUsed: parsed.providerUsed,
      };
    });

    return NextResponse.json({
      rules: getMandateRules(),
      logs,
    });
  } catch (err: any) {
    console.error('Failed to get audit log data:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch audit data' }, { status: 500 });
  }
}

