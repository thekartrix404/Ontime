'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { HeaderBadges } from '@/components/HeaderBadges';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Zap,
  ScrollText,
  RefreshCw,
  Shield,
  AlertTriangle,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  Activity,
  ChevronDown,
} from 'lucide-react';

interface AuditItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  realTime?: string;
  simulatedTime?: string;
  daysOverdue?: number | null;
  summaryText: string;
  decision?: 'allowed' | 'blocked' | 'queued_review';
  badgeType?: 'allowed' | 'blocked' | 'queued_review' | 'user_action' | 'event';
  ruleApplied?: string;
  approvedBy?: string;
  source?: string;
  providerUsed?: string;
  details?: any;
}

export default function AuditPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [rules, setRules] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchAuditData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/audit/data');
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      setRules(data.rules || []);
      setLogs(data.logs || []);
    } catch (err: any) {
      const msg = err.message || 'Error loading audit logs';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Sticky Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-xs transition-transform group-hover:scale-105">
                <Zap size={16} className="text-primary-foreground" strokeWidth={2.5} />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-foreground leading-tight">
                  OnTime
                </span>
                <span className="text-[11px] text-muted-foreground font-normal leading-none">
                  PayPal Autonomous Agent
                </span>
              </div>
            </Link>

            <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                New invoice
              </Link>
              <Link
                href="/dashboard"
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/audit"
                className="px-3 py-1.5 rounded-md text-foreground bg-secondary shadow-xs transition-colors"
              >
                Audit log
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <HeaderBadges />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Error notification */}
        {error && (
          <div className="px-4 py-3 rounded-xl border bg-rose-950/40 border-rose-800/60 text-rose-300 flex items-center justify-between gap-3 text-sm shadow-xs">
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={16} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchAuditData}
              className="h-7 text-xs bg-rose-900/40 border-rose-800 text-rose-200 hover:bg-rose-900/60"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Mandate Rules Panel */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ScrollText size={16} className="text-primary" />
              <CardTitle className="text-sm font-semibold">Active mandate rules</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Inviolable guardrails enforced in code before any agent action executes
            </CardDescription>
          </CardHeader>

          <CardContent>
            {loading && rules.length === 0 ? (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {rules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="bg-card border border-border/50 hover:border-border rounded-xl p-3 flex items-start gap-3 text-xs shadow-2xs transition-colors"
                  >
                    <span className="font-mono text-primary font-semibold shrink-0 text-xs mt-0.5">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    <span className="leading-relaxed text-foreground/90 font-medium">{rule}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Audit Log Timeline */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History size={16} className="text-primary" />
                <div>
                  <CardTitle className="text-sm font-semibold">System audit log</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Complete, tamper-evident log of agent executions, guard decisions, and user actions
                  </CardDescription>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchAuditData}
                disabled={loading}
                className="text-xs font-medium gap-1.5 h-8"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                <span>Refresh</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {loading && logs.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            ) : logs.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-border/80 rounded-xl text-muted-foreground text-xs space-y-1">
                <p className="font-medium text-foreground/70">No audit log entries recorded yet</p>
                <p>Actions from invoice creation, time jumps, and approvals will appear here.</p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-px before:bg-border/60">
                {logs.map((log) => {
                  const isAllowed = log.badgeType === 'allowed' || log.decision === 'allowed' || log.action === 'GUARD_ALLOWED';
                  const isBlocked = log.badgeType === 'blocked' || log.decision === 'blocked' || log.action === 'GUARD_BLOCKED';
                  const isQueued = log.badgeType === 'queued_review' || log.decision === 'queued_review' || log.action === 'GUARD_QUEUED';
                  const isUserAction = !isAllowed && !isBlocked && !isQueued && (log.badgeType === 'user_action' || log.action === 'USER_APPROVAL' || log.action === 'USER_REJECTION' || log.approvedBy === 'user');
                  const isEvent = !isAllowed && !isBlocked && !isQueued && !isUserAction;

                  const realTimeStr = log.realTime
                    ? log.realTime.replace('T', ' ').substring(0, 19)
                    : log.createdAt.replace('T', ' ').substring(0, 19);

                  const daysOverdueNum = typeof log.daysOverdue === 'number' ? log.daysOverdue : null;
                  const simDateText = log.simulatedTime ? log.simulatedTime.substring(0, 10) : null;

                  let cleanSummary = log.summaryText;
                  if (!cleanSummary || (typeof cleanSummary === 'string' && cleanSummary.trim().startsWith('{'))) {
                    cleanSummary = log.details?.summaryText || `Activity logged: ${log.action}`;
                  }

                  // Timeline dot icon selection
                  let NodeIcon = Activity;
                  let nodeColor = 'bg-muted-foreground/30 border-muted-foreground/50 text-muted-foreground';

                  if (isAllowed) {
                    NodeIcon = CheckCircle2;
                    nodeColor = 'bg-emerald-950/80 border-emerald-500 text-emerald-400';
                  } else if (isBlocked) {
                    NodeIcon = XCircle;
                    nodeColor = 'bg-rose-950/80 border-rose-500 text-rose-400';
                  } else if (isQueued) {
                    NodeIcon = Clock;
                    nodeColor = 'bg-amber-950/80 border-amber-500 text-amber-400';
                  } else if (isUserAction) {
                    NodeIcon = UserCheck;
                    nodeColor = 'bg-indigo-950/80 border-indigo-500 text-indigo-400';
                  }

                  return (
                    <div key={log.id} className="relative group">
                      {/* Timeline Node Icon */}
                      <div
                        className={`absolute -left-6 top-3 -translate-x-1/2 w-5 h-5 rounded-full border flex items-center justify-center shadow-xs transition-transform group-hover:scale-110 ${nodeColor}`}
                      >
                        <NodeIcon size={11} strokeWidth={2.5} />
                      </div>

                      {/* Timeline Card */}
                      <div className="bg-card border border-border/60 hover:border-border rounded-xl p-4 shadow-2xs transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-4 text-xs">
                        <div className="space-y-2 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isAllowed && (
                              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold text-xs">
                                ALLOWED
                              </Badge>
                            )}
                            {isBlocked && (
                              <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-400 font-semibold text-xs">
                                BLOCKED
                              </Badge>
                            )}
                            {isQueued && (
                              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 font-semibold text-xs">
                                QUEUED FOR REVIEW
                              </Badge>
                            )}
                            {isUserAction && (
                              <Badge variant="secondary" className="font-semibold text-xs">
                                USER ACTION
                              </Badge>
                            )}
                            {isEvent && (
                              <Badge variant="outline" className="text-muted-foreground border-border/60 text-xs">
                                EVENT
                              </Badge>
                            )}

                            <span className="font-mono text-muted-foreground text-xs">
                              {log.action}
                            </span>

                            {log.approvedBy && (
                              <Badge variant="outline" className="text-muted-foreground text-[11px] font-mono">
                                approved_by: {log.approvedBy}
                              </Badge>
                            )}
                            {log.source && (
                              <Badge variant="outline" className="font-mono text-[11px] border-primary/30 bg-primary/10 text-primary">
                                {log.source}
                              </Badge>
                            )}
                            {log.providerUsed && (
                              <Badge variant="outline" className="font-mono text-[11px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                                {log.providerUsed === 'sandbox' ? 'PayPal sandbox' : 'MockPayPal'}
                              </Badge>
                            )}
                          </div>

                          {/* Plain-English narrative description */}
                          <p className="text-foreground text-xs leading-relaxed font-medium">
                            {cleanSummary}
                          </p>

                          {log.ruleApplied && (
                            <p className="text-xs text-amber-400/90 inline-flex items-center gap-1.5 font-mono">
                              <Shield size={12} className="shrink-0 text-amber-500" />
                              <span>{log.ruleApplied}</span>
                            </p>
                          )}

                          {/* Collapsible raw JSON details section */}
                          {log.details && (
                            <details className="mt-1 text-muted-foreground group/details">
                              <summary className="cursor-pointer text-primary hover:underline select-none text-xs transition-colors list-none flex items-center gap-1">
                                <span>View details</span>
                                <ChevronDown size={12} className="transition-transform group-open/details:rotate-180" />
                              </summary>
                              <pre className="mt-2 p-3 rounded-lg bg-muted/60 border border-border/50 text-muted-foreground font-mono overflow-x-auto text-xs leading-relaxed">
                                {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        {/* Timestamp column */}
                        <div className="text-right text-xs text-muted-foreground shrink-0 font-mono space-y-0.5">
                          <div className="text-foreground/80">{realTimeStr}</div>
                          {(daysOverdueNum !== null || simDateText) && (
                            <div className="text-primary font-medium">
                              {daysOverdueNum !== null ? `Day ${daysOverdueNum >= 0 ? '+' + daysOverdueNum : daysOverdueNum}` : ''}
                              {simDateText ? ` (${simDateText})` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

      </main>
    </div>
  );
}
