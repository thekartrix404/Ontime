import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMandateRules } from '@/lib/mandate';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT *
      FROM audit_log
      ORDER BY COALESCE(real_time, created_at) DESC
      LIMIT 100
    `).all() as any[];

    const logs = rows.map((r) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(r.details);
      } catch {
        parsed = { summaryText: r.details };
      }

      const realTime = r.real_time || r.created_at;
      const simulatedTime = r.simulated_time || (parsed && parsed.simulatedTime) || (parsed && parsed.timestamp) || realTime;
      const daysOverdue = r.days_overdue !== null && r.days_overdue !== undefined
        ? r.days_overdue
        : (parsed && typeof parsed.daysOverdue === 'number' ? parsed.daysOverdue : null);

      let summaryText = parsed.summaryText || r.details;
      if (typeof summaryText === 'string' && summaryText.trim().startsWith('{')) {
        try {
          const inner = JSON.parse(summaryText);
          summaryText = inner.summaryText || 'Audit record logged';
        } catch {
          // ignore
        }
      }

      return {
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        createdAt: r.created_at,
        realTime,
        simulatedTime,
        daysOverdue,
        details: parsed,
        summaryText,
        decision: parsed.decision || (r.action === 'GUARD_ALLOWED' ? 'allowed' : r.action === 'GUARD_QUEUED' ? 'queued_review' : r.action === 'GUARD_BLOCKED' ? 'blocked' : undefined),
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

