'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

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
  createdAt: string;
}

interface ActivityItem {
  id: string;
  action: string;
  timestamp: string;
  decision: 'allowed' | 'blocked';
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
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/dashboard/data');
      if (!res.ok) throw new Error('Failed to load dashboard data');
      const data = await res.json();
      setSimulatedDate(data.simulatedDate);
      setInvoices(data.invoices || []);
      setApprovalQueue(data.approvalQueue || []);
      setAgentActivity(data.agentActivity || []);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error loading dashboard' });
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
      setNotification({
        type: 'success',
        message: `Advanced +${days} days to ${data.simulatedDate}. Follow-up agent evaluated open invoices (${decisionsCount} tool calls evaluated).`,
      });
      await fetchData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message });
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
      setNotification({ type: 'success', message: 'Demo reset! Initial seed restored and clock reset.' });
      await fetchData();
    } catch (err: any) {
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
      setNotification({
        type: 'success',
        message: `Invoice ${invoiceNumber} marked as paid and payment recorded via PayPal.`,
      });
      await fetchData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message });
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
      setNotification({
        type: 'success',
        message: 'Message approved and sent via PayPal reminder. Recorded in audit log.',
      });
      await fetchData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message });
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
      setNotification({
        type: 'success',
        message: 'Queued item rejected.',
      });
      await fetchData();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                ⚡
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  OnTime <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 font-semibold border border-indigo-700/60 uppercase">PayPal Agent</span>
                </h1>
              </div>
            </Link>

            <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
              <Link href="/" className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors">
                New Invoice
              </Link>
              <Link href="/dashboard" className="px-3 py-1.5 rounded-lg text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 transition-colors">
                Dashboard
              </Link>
              <Link href="/audit" className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors">
                Audit Log
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/70 border border-emerald-800/70 px-3 py-1.5 rounded-full font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              PayPal Sandbox Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Simulated Clock & Time Travel Banner */}
        <section className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/60 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">
              <span>🕒 Simulated Clock Engine</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight font-mono">
                {simulatedDate || 'Loading...'}
              </span>
              <span className="text-xs text-slate-400">
                Days overdue computed in code relative to this date
              </span>
            </div>
          </div>

          {/* Time Travel & Demo Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleAdvance(5)}
              disabled={actionLoading !== null}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {actionLoading === '+5d' ? 'Running...' : '+5 days'}
            </button>
            <button
              onClick={() => handleAdvance(15)}
              disabled={actionLoading !== null}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {actionLoading === '+15d' ? 'Running...' : '+15 days'}
            </button>
            <button
              onClick={() => handleAdvance(30)}
              disabled={actionLoading !== null}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {actionLoading === '+30d' ? 'Running...' : '+30 days'}
            </button>
            <button
              onClick={handleResetDemo}
              disabled={actionLoading !== null}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/80 hover:text-rose-200 border border-slate-700 hover:border-rose-800 disabled:opacity-50 text-slate-300 font-medium text-xs transition-all cursor-pointer"
            >
              {actionLoading === 'reset' ? 'Resetting...' : 'Reset demo'}
            </button>
          </div>
        </section>

        {/* Notifications */}
        {notification && (
          <div className={`p-4 rounded-xl border flex items-center justify-between text-sm shadow-lg animate-in fade-in ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/80 border-rose-800 text-rose-200'
          }`}>
            <span>{notification.message}</span>
            <button onClick={() => setNotification(null)} className="text-lg leading-none px-2 font-bold opacity-70 hover:opacity-100">
              ×
            </button>
          </div>
        )}

        {/* Approval Queue Panel */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
              <h2 className="text-base font-bold text-white tracking-tight">
                Approval Queue ({approvalQueue.length})
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Firm/formal tones & escalations intercepted by Mandate Guard
            </span>
          </div>

          {approvalQueue.length === 0 ? (
            <div className="py-6 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
              No pending communications in the approval queue. Automatic reminders operate within mandate limits.
            </div>
          ) : (
            <div className="grid gap-3">
              {approvalQueue.map((item) => (
                <div key={item.id} className="bg-slate-950/80 border border-amber-900/50 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white text-sm">{item.clientName}</span>
                      <span className="text-xs font-mono text-slate-400">({item.invoiceNumber})</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider bg-amber-950 text-amber-300 border border-amber-700/60">
                        Tone: {item.tone}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        Tool: {item.tool}
                      </span>
                      {item.source && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full uppercase font-bold font-mono tracking-wider bg-slate-900 text-indigo-300 border border-slate-700">
                          source: {item.source}
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-medium text-slate-300">{item.subject}</p>
                    <p className="text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 whitespace-pre-wrap font-sans">
                      {item.message}
                    </p>
                    <p className="text-[11px] text-amber-400/90 italic">
                      🛡️ Blocked by rule: {item.ruleBlocked}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                    <button
                      onClick={() => handleApproveQueue(item.id)}
                      disabled={actionLoading !== null}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs shadow transition-all cursor-pointer"
                    >
                      {actionLoading === `approve-${item.id}` ? 'Sending...' : 'Approve & Send'}
                    </button>
                    <button
                      onClick={() => handleRejectQueue(item.id)}
                      disabled={actionLoading !== null}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-all cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Invoices List Table */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Invoice Portfolio</h2>
              <p className="text-xs text-slate-400">All registered invoices and status indicators</p>
            </div>
            <Link
              href="/"
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-3 py-1.5 rounded-lg transition-colors"
            >
              + Create New Invoice
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-3 px-3">Invoice</th>
                  <th className="py-3 px-3">Client</th>
                  <th className="py-3 px-3">Amount</th>
                  <th className="py-3 px-3">Due Date</th>
                  <th className="py-3 px-3">Days Overdue</th>
                  <th className="py-3 px-3">Linked Deposit/Balance</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {invoices.map((inv) => {
                  const isPaid = inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID';
                  return (
                    <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-3 font-mono font-medium text-slate-200">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-slate-200">{inv.clientName}</div>
                        <div className="text-[11px] text-slate-400">{inv.company}</div>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-semibold text-white">
                        ${inv.amount} {inv.currency}
                      </td>
                      <td className="py-3.5 px-3 text-slate-300 font-mono">
                        {inv.dueDate}
                      </td>
                      <td className="py-3.5 px-3 font-mono">
                        {isPaid ? (
                          <span className="text-slate-500">—</span>
                        ) : inv.daysOverdue > 0 ? (
                          <span className="text-rose-400 font-bold bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/60">
                            +{inv.daysOverdue} days
                          </span>
                        ) : inv.daysOverdue === 0 ? (
                          <span className="text-amber-400 font-bold">Due today</span>
                        ) : (
                          <span className="text-slate-400">
                            In {Math.abs(inv.daysOverdue)} days
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        {inv.linkedInvoice ? (
                          <div className="text-[11px] text-indigo-300 bg-indigo-950/60 border border-indigo-800/50 px-2 py-1 rounded inline-block">
                            Linked {inv.linkedInvoice.type}: <span className="font-mono font-bold">${inv.linkedInvoice.amount}</span> ({inv.linkedInvoice.status})
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase border ${
                          isPaid
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800/70'
                            : inv.daysOverdue > 0
                            ? 'bg-rose-950 text-rose-300 border-rose-800/70'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {!isPaid && (
                          <button
                            onClick={() => handleMarkAsPaid(inv.id, inv.invoiceNumber)}
                            disabled={actionLoading !== null}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-emerald-950 hover:text-emerald-200 hover:border-emerald-700 border border-slate-700 text-slate-300 font-medium text-[11px] transition-colors cursor-pointer"
                          >
                            {actionLoading === `pay-${inv.id}` ? 'Saving...' : 'Mark as paid'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Agent Activity Panel */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Agent Activity & Guard Decisions</h2>
              <p className="text-xs text-slate-400">Latest tool calls and mandate enforcement decisions (newest first)</p>
            </div>
            <Link
              href="/audit"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              View Full Audit Log →
            </Link>
          </div>

          <div className="space-y-2.5">
            {agentActivity.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                No recent agent activity recorded. Use the time travel buttons to advance days and trigger the follow-up agent.
              </div>
            ) : (
              agentActivity.slice(0, 10).map((act) => {
                const isAllowed = act.decision === 'allowed';
                return (
                  <div
                    key={act.id}
                    className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <span
                        className={`px-2 py-0.5 rounded font-black text-[10px] tracking-wider uppercase border shrink-0 mt-0.5 ${
                          isAllowed
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border-rose-800'
                        }`}
                      >
                        {isAllowed ? 'ALLOWED' : 'BLOCKED'}
                      </span>
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-slate-200 font-medium">{act.summaryText}</p>
                          {act.source && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-slate-800 text-indigo-300 border border-slate-700">
                              source: {act.source}
                            </span>
                          )}
                          {act.providerUsed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-slate-800 text-emerald-300 border border-slate-700">
                              {act.providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal'}
                            </span>
                          )}
                        </div>
                        {act.details?.ruleApplied && (
                          <p className="text-[11px] text-slate-400">
                            🛡️ {act.details.ruleApplied}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right text-[11px] text-slate-500 shrink-0 font-mono">
                      {act.timestamp.replace('T', ' ').substring(0, 19)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

