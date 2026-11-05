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

      let decision: 'allowed' | 'blocked' | 'queued_review' | undefined = undefined;
      if (r.action === 'GUARD_ALLOWED' || (r.action.startsWith('GUARD_') && parsed.decision === 'allowed')) {
        decision = 'allowed';
      } else if (r.action === 'GUARD_QUEUED' || (r.action.startsWith('GUARD_') && parsed.decision === 'queued_review')) {
        decision = 'queued_review';
      } else if (r.action === 'GUARD_BLOCKED' || (r.action.startsWith('GUARD_') && parsed.decision === 'blocked')) {
        decision = 'blocked';
      }

      const isUserAction = r.action === 'USER_APPROVAL' || r.action === 'USER_REJECTION';
      const badgeType: 'allowed' | 'blocked' | 'queued_review' | 'user_action' | 'event' =
        decision ? decision : isUserAction ? 'user_action' : 'event';

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
        decision,
        badgeType,
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

