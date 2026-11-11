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
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Zap,
  Clock,
  ClipboardList,
  ShieldAlert,
  BarChart2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';

interface DemoEvents {
  draftCreated: boolean;
  termsApproved: boolean;
  guardAllowed: boolean;
  guardBlocked: boolean;
  userApproval: boolean;
  paymentRecorded: boolean;
}

interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  company: string | null;
  amount: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: string;
  terms: string | null;
  notes: string | null;
  paypalInvoiceId: string | null;
  projectId: string | null;
  daysOverdue: number;
  linkedInvoice?: {
    id: string;
    invoiceNumber: string;
    amount: string;
    status: string;
    type: string;
  } | null;
}

interface ApprovalItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  amount: string;
  tool: string;
  tone: string;
  subject: string;
  message: string;
  ruleBlocked: string;
  proposedLateFeePercent?: number;
  source?: string;
  status?: string;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  action: string;
  timestamp: string;
  realTime?: string;
  simulatedTime?: string;
  daysOverdue?: number | null;
  decision: 'allowed' | 'blocked' | 'queued_review';
  tool: string;
  summaryText: string;
  source?: string;
  providerUsed?: string;
  details?: any;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [simulatedDate, setSimulatedDate] = useState<string>('');
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<ApprovalItem[]>([]);
  const [agentActivity, setAgentActivity] = useState<ActivityItem[]>([]);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
    retry?: () => void;
  } | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [userSelectedStep, setUserSelectedStep] = useState<number | null>(null);
  const [demoEvents, setDemoEvents] = useState<DemoEvents>({
    draftCreated: false,
    termsApproved: false,
    guardAllowed: false,
    guardBlocked: false,
    userApproval: false,
    paymentRecorded: false,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/dashboard/data');
      if (!res.ok) throw new Error('Failed to load dashboard data');
      const data = await res.json();
      setSimulatedDate(data.simulatedDate);
      const invs: InvoiceItem[] = data.invoices || [];
      setInvoices(invs);
      setApprovalQueue(data.approvalQueue || []);
      setAgentActivity(data.agentActivity || []);
      if (data.demoEvents) {
        setDemoEvents(data.demoEvents);
      }

      const openInvs = invs.filter((i) =>
        ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status.toUpperCase())
      );
      if (openInvs.length > 0) {
        setSelectedInvoiceId((prev) => {
          if (prev && openInvs.some((i) => i.id === prev)) return prev;
          return openInvs[0].id;
        });
      } else {
        setSelectedInvoiceId('');
      }
    } catch (err: any) {
      const msg = err.message || 'Error loading dashboard';
      toast.error(msg);
      setNotification({
        type: 'error',
        message: msg,
        retry: () => fetchData(),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdvance = async (days: number) => {
    try {
      setActionLoading(`+${days}d`);
      setNotification(null);
      const res = await fetch('/api/agent/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to advance time');

      const decisionsCount = data.agentResult?.decisions?.length || 0;
      const msg = `Advanced +${days} days to ${data.simulatedDate}. Agent evaluated open invoices (${decisionsCount} actions).`;
      toast.success(msg);
      setNotification({
        type: 'success',
        message: msg,
      });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to advance time');
      setNotification({
        type: 'error',
        message: err.message,
        retry: () => handleAdvance(days),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRelativeAdvance = async (invoiceId: string, relativeDays: number) => {
    try {
      setActionLoading(`rel-${relativeDays}`);
      setNotification(null);
      const res = await fetch('/api/agent/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, relativeDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to jump clock');

      const decisionsCount = data.agentResult?.decisions?.length || 0;
      const msg = `${data.description}: ${data.selectedInvoiceNumber} is now ${data.resultingDaysOverdue} days overdue (${data.simulatedDate}). Agent ran ${decisionsCount} actions.`;
      toast.success(msg);
      setNotification({
        type: 'success',
        message: msg,
      });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to jump clock');
      setNotification({
        type: 'error',
        message: err.message,
        retry: () => handleRelativeAdvance(invoiceId, relativeDays),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetDemo = async () => {
    if (!confirm('Reset demo data to initial seed state? This restores seed clients and resets the clock.')) {
      return;
    }
    try {
      setActionLoading('reset');
      setNotification(null);
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset demo');
      toast.success('Demo reset. Seed data restored and clock reset.');
      setNotification({ type: 'success', message: 'Demo reset. Seed data restored and clock reset.' });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset demo');
      setNotification({ type: 'error', message: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkAsPaid = async (invoiceId: string, invoiceNumber: string) => {
    try {
      setActionLoading(`pay-${invoiceId}`);
      setNotification(null);
      const res = await fetch('/api/invoices/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');
      const msg = `${invoiceNumber} marked as paid and recorded via PayPal.`;
      toast.success(msg);
      setNotification({
        type: 'success',
        message: msg,
      });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to record payment');
      setNotification({
        type: 'error',
        message: err.message,
        retry: () => handleMarkAsPaid(invoiceId, invoiceNumber),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveQueue = async (queueId: string) => {
    try {
      setActionLoading(`approve-${queueId}`);
      setNotification(null);
      const res = await fetch('/api/agent/queue/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve message');
      toast.success('Approved and sent via PayPal. Recorded in audit log.');
      setNotification({
        type: 'success',
        message: 'Approved and sent via PayPal. Recorded in audit log.',
      });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve message');
      setNotification({
        type: 'error',
        message: err.message,
        retry: () => handleApproveQueue(queueId),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectQueue = async (queueId: string) => {
    try {
      setActionLoading(`reject-${queueId}`);
      setNotification(null);
      const res = await fetch('/api/agent/queue/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject message');
      toast.success('Queued item rejected.');
      setNotification({ type: 'success', message: 'Queued item rejected.' });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject message');
      setNotification({
        type: 'error',
        message: err.message,
        retry: () => handleRejectQueue(queueId),
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Demo step state — driven strictly from real audit events
  const isStep1Done = Boolean(demoEvents.draftCreated);
  const isStep2Done = Boolean(demoEvents.termsApproved);
  const isStep3Done = Boolean(demoEvents.guardAllowed);
  const isStep4Done = Boolean(demoEvents.guardBlocked);
  const isStep5Done = Boolean(demoEvents.userApproval);
  const isStep6Done = Boolean(demoEvents.paymentRecorded);

  const computeAutoStep = (): number => {
    if (!isStep1Done) return 1;
    if (!isStep2Done) return 2;
    if (!isStep3Done) return 3;
    if (!isStep4Done) return 4;
    if (!isStep5Done) return 5;
    if (!isStep6Done) return 6;
    return 6;
  };

  const activeDemoStep = userSelectedStep !== null ? userSelectedStep : computeAutoStep();

  const DEMO_STEPS = [
    { num: 1, title: 'Paste client email', desc: 'Paste a client email on Home to extract terms and risk score', link: '/', isDone: isStep1Done },
    { num: 2, title: 'Approve terms', desc: 'Approve proposed terms (Net-14 or 40/60 split) to send invoice', link: '/', isDone: isStep2Done },
    { num: 3, title: 'Advance +5 days', desc: 'Agent auto-sends a friendly or nudge reminder via PayPal', isDone: isStep3Done },
    { num: 4, title: 'Advance +15 days', desc: 'Agent tries a firm reminder — blocked by mandate guard and queued', isDone: isStep4Done },
    { num: 5, title: 'Approve queue item', desc: 'Review and approve the intercepted firm reminder', isDone: isStep5Done },
    { num: 6, title: 'Mark invoice paid', desc: 'Record a PayPal payment and inspect the audit log', isDone: isStep6Done },
  ];

  const openInvoices = invoices.filter((inv) =>
    ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(inv.status.toUpperCase())
  );
  const selectedInvoice =
    openInvoices.find((inv) => inv.id === selectedInvoiceId) ||
    (openInvoices.length > 0 ? openInvoices[0] : null);
  const selectedDaysOverdue = selectedInvoice ? selectedInvoice.daysOverdue : 0;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Sticky Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
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
                className="px-3 py-1.5 rounded-md text-foreground bg-secondary shadow-xs transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/audit"
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
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

        {/* Inline Notification Banner with Retry */}
        {notification && (
          <div
            className={`px-4 py-3 rounded-xl border flex items-center justify-between text-sm gap-3 shadow-xs transition-all ${
              notification.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {notification.type === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle size={16} className="text-rose-400 shrink-0" />
              )}
              <span>{notification.message}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {notification.retry && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const fn = notification.retry;
                    setNotification(null);
                    fn?.();
                  }}
                  className="h-7 text-xs bg-rose-900/40 border-rose-800 text-rose-200 hover:bg-rose-900/60 hover:text-rose-100"
                >
                  Retry
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNotification(null)}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              >
                ×
              </Button>
            </div>
          </div>
        )}

        {/* Clock Card with Time Travel */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Clock size={14} className="text-primary" />
                  <span>Simulated clock & environment</span>
                </div>
                <div className="flex items-baseline gap-3">
                  {loading && !simulatedDate ? (
                    <Skeleton className="h-8 w-36" />
                  ) : (
                    <span className="text-2xl font-bold font-mono tracking-tight text-foreground tabular-nums">
                      {simulatedDate || '—'}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Days overdue computed relative to this date
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[5, 15, 30].map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    onClick={() => handleAdvance(d)}
                    disabled={actionLoading !== null}
                    className="font-medium text-xs shadow-xs"
                  >
                    {actionLoading === `+${d}d` ? 'Running…' : `+${d} days`}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleResetDemo}
                  disabled={actionLoading !== null}
                  className="font-medium text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40"
                >
                  <RefreshCw size={13} className={actionLoading === 'reset' ? 'animate-spin' : ''} />
                  {actionLoading === 'reset' ? 'Resetting…' : 'Reset demo'}
                </Button>
              </div>
            </div>
          </CardHeader>

          <Separator className="opacity-50" />

          {/* Relative jumps row */}
          <CardContent className="pt-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-muted-foreground font-medium">Jump relative to due date:</span>
              <div className="relative">
                <select
                  value={selectedInvoice?.id || ''}
                  onChange={(e) => setSelectedInvoiceId(e.target.value)}
                  disabled={openInvoices.length === 0}
                  className="h-8 bg-secondary/80 hover:bg-secondary border border-input text-foreground rounded-lg px-2.5 pr-7 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-40 appearance-none cursor-pointer"
                >
                  {openInvoices.length === 0 ? (
                    <option value="">No open invoices</option>
                  ) : (
                    openInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} · {inv.clientName} (due {inv.dueDate})
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown size={13} className="absolute right-2 top-2.5 pointer-events-none text-muted-foreground" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {openInvoices.length === 0 ? (
                <span className="flex items-center gap-1.5 text-muted-foreground text-xs py-1">
                  <AlertTriangle size={13} className="text-amber-500" />
                  No open invoices for time travel
                </span>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectedInvoice && handleRelativeAdvance(selectedInvoice.id, -2)}
                    disabled={actionLoading !== null || !selectedInvoice}
                    className="h-8 text-xs font-medium"
                  >
                    {actionLoading === 'rel--2' ? 'Jumping…' : '2 days before due'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectedInvoice && handleRelativeAdvance(selectedInvoice.id, 5)}
                    disabled={actionLoading !== null || !selectedInvoice}
                    className="h-8 text-xs font-medium border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                  >
                    {actionLoading === 'rel-5' ? 'Jumping…' : '5 days overdue'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectedInvoice && handleRelativeAdvance(selectedInvoice.id, 15)}
                    disabled={actionLoading !== null || !selectedInvoice}
                    className="h-8 text-xs font-medium border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  >
                    {actionLoading === 'rel-15' ? 'Jumping…' : '15 days overdue'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectedInvoice && handleRelativeAdvance(selectedInvoice.id, 30)}
                    disabled={actionLoading !== null || !selectedInvoice}
                    className="h-8 text-xs font-medium border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                  >
                    {actionLoading === 'rel-30' ? 'Jumping…' : '30 days overdue'}
                  </Button>

                  {selectedInvoice && (
                    <Badge variant="outline" className="h-8 px-2.5 font-mono text-xs gap-1.5 bg-secondary/50">
                      <span>{selectedInvoice.invoiceNumber}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span
                        className={
                          selectedDaysOverdue > 0
                            ? 'text-rose-400 font-semibold'
                            : selectedDaysOverdue === 0
                            ? 'text-amber-400 font-semibold'
                            : 'text-muted-foreground'
                        }
                      >
                        {selectedDaysOverdue > 0
                          ? `+${selectedDaysOverdue}d overdue`
                          : selectedDaysOverdue === 0
                          ? 'Due today'
                          : `${Math.abs(selectedDaysOverdue)}d before due`}
                      </span>
                    </Badge>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Guided Demo Checklist */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-primary" />
                <CardTitle className="text-sm font-semibold">Guided demo</CardTitle>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                Step {activeDemoStep} of 6
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Interactive 6-step walkthrough driven strictly by verified backend audit events
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {DEMO_STEPS.map((step) => {
                const isDone = Boolean(step.isDone);
                const isCurrent = step.num === activeDemoStep && !isDone;

                return (
                  <div
                    key={step.num}
                    onClick={() => setUserSelectedStep(step.num)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 text-xs ${
                      isDone
                        ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                        : isCurrent
                        ? 'bg-primary/10 border-primary/50 ring-1 ring-primary/40 shadow-xs'
                        : 'bg-card border-border/60 hover:border-border hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {String(step.num).padStart(2, '0')}
                      </span>
                      {isDone ? (
                        <CheckCircle2 size={15} className="text-emerald-400" />
                      ) : isCurrent ? (
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      ) : (
                        <Circle size={15} className="text-muted-foreground/40" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className={`font-semibold ${isDone ? 'text-emerald-400' : isCurrent ? 'text-foreground' : 'text-foreground/80'}`}>
                        {step.title}
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {step.desc}
                      </p>
                    </div>

                    {step.link && !isDone ? (
                      <Link
                        href={step.link}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline pt-1"
                      >
                        Open page <ArrowRight size={12} />
                      </Link>
                    ) : (
                      <div className="h-4" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Approval Queue */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-amber-500" />
                <CardTitle className="text-sm font-semibold">Approval queue</CardTitle>
                {approvalQueue.length > 0 && (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono text-xs">
                    {approvalQueue.length} pending
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Firm and formal tones intercepted by mandate guard
              </span>
            </div>
            <CardDescription className="text-xs">
              Actions requiring explicit human review before outgoing PayPal communication
            </CardDescription>
          </CardHeader>

          <CardContent>
            {loading && approvalQueue.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full rounded-xl" />
                <Skeleton className="h-28 w-full rounded-xl" />
              </div>
            ) : approvalQueue.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border/80 rounded-xl text-muted-foreground text-xs space-y-1">
                <p className="font-medium text-foreground/70">No pending communications in queue</p>
                <p>Automatic reminders sent within mandate limits do not require intervention.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {approvalQueue.map((item) => (
                  <div
                    key={item.id}
                    className="bg-card border border-amber-800/40 rounded-xl p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 shadow-xs"
                  >
                    <div className="space-y-2.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">{item.clientName}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {item.invoiceNumber}
                        </Badge>
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs">
                          {item.tone}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {item.tool}
                        </Badge>
                        {item.source && (
                          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary font-mono text-xs">
                            {item.source}
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs font-semibold text-foreground/90">{item.subject}</p>
                      <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-lg border border-border/50 whitespace-pre-wrap leading-relaxed font-sans">
                        {item.message}
                      </div>
                      <p className="text-xs font-medium text-amber-400/90 flex items-center gap-1.5">
                        <ShieldAlert size={13} className="shrink-0 text-amber-500" />
                        <span>Blocked by rule: {item.ruleBlocked}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-start shrink-0 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleApproveQueue(item.id)}
                        disabled={actionLoading !== null}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-xs"
                      >
                        {actionLoading === `approve-${item.id}` ? 'Sending…' : 'Approve & send'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectQueue(item.id)}
                        disabled={actionLoading !== null}
                        className="text-xs font-medium"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoice Portfolio */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Invoice portfolio</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  All active and historical invoices across clients
                </CardDescription>
              </div>
              <Link
                href="/"
                className={buttonVariants({ variant: 'outline', size: 'sm', className: 'text-xs font-medium' })}
              >
                New invoice
              </Link>
            </div>
          </CardHeader>

          <CardContent>
            {loading && invoices.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : invoices.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border/80 rounded-xl text-muted-foreground text-xs space-y-1">
                <p className="font-medium text-foreground/70">No invoices generated yet</p>
                <p>Generate your first invoice from the New invoice tab.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="border-border/50">
                      <TableHead className="font-semibold text-xs">Invoice</TableHead>
                      <TableHead className="font-semibold text-xs">Client</TableHead>
                      <TableHead className="font-semibold text-xs">Amount</TableHead>
                      <TableHead className="font-semibold text-xs">Due date</TableHead>
                      <TableHead className="font-semibold text-xs">Days overdue</TableHead>
                      <TableHead className="font-semibold text-xs">Linked</TableHead>
                      <TableHead className="font-semibold text-xs">Status</TableHead>
                      <TableHead className="font-semibold text-xs text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => {
                      const isPaid = inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID';
                      return (
                        <TableRow key={inv.id} className="border-border/40 hover:bg-muted/30">
                          <TableCell className="font-mono text-xs font-semibold text-foreground">
                            {inv.invoiceNumber}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium text-foreground">{inv.clientName}</div>
                            {inv.company && <div className="text-[11px] text-muted-foreground">{inv.company}</div>}
                          </TableCell>
                          <TableCell className="font-mono font-semibold text-xs tabular-nums text-foreground">
                            ${inv.amount} {inv.currency}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                            {inv.dueDate}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {isPaid ? (
                              <span className="text-muted-foreground">—</span>
                            ) : inv.daysOverdue > 0 ? (
                              <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-400 font-mono text-xs">
                                +{inv.daysOverdue}d
                              </Badge>
                            ) : inv.daysOverdue === 0 ? (
                              <span className="text-amber-400 font-medium">Due today</span>
                            ) : (
                              <span className="text-muted-foreground">In {Math.abs(inv.daysOverdue)}d</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {inv.linkedInvoice ? (
                              <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-indigo-400 font-mono text-[11px]">
                                {inv.linkedInvoice.type}: ${inv.linkedInvoice.amount}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant="outline"
                              className={`text-xs font-medium ${
                                isPaid
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                  : inv.daysOverdue > 0
                                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                                  : 'border-border/60 bg-secondary text-secondary-foreground'
                              }`}
                            >
                              {inv.status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {!isPaid && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleMarkAsPaid(inv.id, inv.invoiceNumber)}
                                disabled={actionLoading !== null}
                                className="h-7 text-xs font-medium hover:border-emerald-600/50 hover:bg-emerald-600/10 hover:text-emerald-300"
                              >
                                {actionLoading === `pay-${inv.id}` ? 'Saving…' : 'Mark as paid'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agent Activity Feed */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart2 size={16} className="text-primary" />
                <div>
                  <CardTitle className="text-sm font-semibold">Agent activity</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Mandate guard decisions and PayPal execution events
                  </CardDescription>
                </div>
              </div>
              <Link
                href="/audit"
                className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
              >
                Full audit log <ArrowRight size={12} />
              </Link>
            </div>
          </CardHeader>

          <CardContent>
            {loading && agentActivity.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : agentActivity.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border/80 rounded-xl text-muted-foreground text-xs space-y-1">
                <p className="font-medium text-foreground/70">No recent agent activity</p>
                <p>Advance days with the time travel buttons to trigger the follow-up agent.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {agentActivity.slice(0, 10).map((act) => {
                  const isAllowed = act.decision === 'allowed' || act.action === 'GUARD_ALLOWED';
                  const isBlocked = act.decision === 'blocked' || act.action === 'GUARD_BLOCKED';
                  const isQueued = act.decision === 'queued_review' || act.action === 'GUARD_QUEUED';

                  const realTimeStr = act.realTime
                    ? act.realTime.replace('T', ' ').substring(0, 19)
                    : act.timestamp.replace('T', ' ').substring(0, 19);

                  const daysOverdueNum = typeof act.daysOverdue === 'number' ? act.daysOverdue : null;
                  const simDateText = act.simulatedTime ? act.simulatedTime.substring(0, 10) : null;

                  let cleanSummary = act.summaryText;
                  if (!cleanSummary || (typeof cleanSummary === 'string' && cleanSummary.trim().startsWith('{'))) {
                    cleanSummary = act.details?.summaryText || `Activity: ${act.action}`;
                  }

                  return (
                    <div
                      key={act.id}
                      className="bg-card border border-border/60 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs shadow-2xs hover:border-border transition-colors"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        {/* Mandate Guard Decision Badge */}
                        <div className="shrink-0 mt-0.5">
                          {isAllowed && (
                            act.details?.sendFailed === true || act.details?.execution === 'FAILED' || (act.details?.executed === false && act.details?.error) ? (
                              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400 font-semibold text-xs">
                                ALLOWED · SEND FAILED
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold text-xs">
                                Allowed
                              </Badge>
                            )
                          )}
                          {isBlocked && (
                            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-400 font-semibold text-xs">
                              Blocked
                            </Badge>
                          )}
                          {isQueued && (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 font-semibold text-xs">
                              Queued
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-foreground text-xs leading-relaxed font-medium">{cleanSummary}</p>
                            {act.source && (
                              <Badge variant="outline" className="font-mono text-[11px] border-primary/30 bg-primary/10 text-primary">
                                {act.source}
                              </Badge>
                            )}
                            {act.providerUsed && (
                              <Badge variant="outline" className="font-mono text-[11px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                                {act.providerUsed === 'sandbox' ? 'PayPal sandbox' : 'MockPayPal'}
                              </Badge>
                            )}
                          </div>
                          {act.details?.ruleApplied && (
                            <p className="text-xs text-amber-400/90 font-mono flex items-center gap-1.5">
                              <span>Rule: {act.details.ruleApplied}</span>
                            </p>
                          )}
                          {act.details && (
                            <details className="mt-1 text-muted-foreground group">
                              <summary className="cursor-pointer text-primary hover:underline select-none text-xs transition-colors list-none flex items-center gap-1">
                                <span>View details</span>
                                <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
                              </summary>
                              {act.details?.error && (
                                <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
                                  Error: {act.details.error}
                                </div>
                              )}
                              <pre className="mt-2 p-3 rounded-lg bg-muted/60 border border-border/50 text-muted-foreground font-mono overflow-x-auto text-xs leading-relaxed">
                                {typeof act.details === 'string' ? act.details : JSON.stringify(act.details, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>

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
