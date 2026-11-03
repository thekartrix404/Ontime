'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface AuditItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  summaryText: string;
  decision?: 'allowed' | 'blocked';
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
      const res = await fetch('/api/audit/data');
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      setRules(data.rules || []);
      setLogs(data.logs || []);
    } catch (err: any) {
      setError(err.message || 'Error loading audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, []);

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
              <Link href="/dashboard" className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors">
                Dashboard
              </Link>
              <Link href="/audit" className="px-3 py-1.5 rounded-lg text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 transition-colors">
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
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-sm">
            {error}
          </div>
        )}

        {/* Mandate Rules Panel in Plain English */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📜</span>
            <h2 className="text-base font-bold text-white tracking-tight">Active Mandate Rules (Plain English)</h2>
          </div>
          <p className="text-xs text-slate-400">
            These rules act as inviolable guardrails before any tool execution occurs in the system:
          </p>
          <div className="grid gap-2 sm:grid-cols-2 pt-2">
            {rules.map((rule, idx) => (
              <div
                key={idx}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex items-start gap-2.5 text-xs text-slate-300"
              >
                <span className="text-indigo-400 font-bold font-mono">0{idx + 1}.</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Plain-English Audit Log Rows */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">System Audit Log</h2>
              <p className="text-xs text-slate-400">Complete, tamper-evident log of agent executions, guard decisions, and user actions</p>
            </div>
            <button
              onClick={fetchAuditData}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            >
              Refresh Logs
            </button>
          </div>

          <div className="space-y-3">
            {logs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                No audit log entries found.
              </div>
            ) : (
              logs.map((log) => {
                const isAllowed = log.decision === 'allowed';
                const isBlocked = log.decision === 'blocked';
                const isUserAction = log.approvedBy === 'user' || log.action.startsWith('USER_');

                return (
                  <div
                    key={log.id}
                    className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isAllowed && (
                          <span className="px-2 py-0.5 rounded font-black text-[10px] tracking-wider uppercase bg-emerald-950 text-emerald-300 border border-emerald-800">
                            ALLOWED
                          </span>
                        )}
                        {isBlocked && (
                          <span className="px-2 py-0.5 rounded font-black text-[10px] tracking-wider uppercase bg-rose-950 text-rose-300 border border-rose-800">
                            BLOCKED
                          </span>
                        )}
                        {isUserAction && (
                          <span className="px-2 py-0.5 rounded font-black text-[10px] tracking-wider uppercase bg-indigo-950 text-indigo-300 border border-indigo-800">
                            USER ACTION
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-slate-500">
                          {log.action}
                        </span>
                        {log.approvedBy && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                            approved_by: {log.approvedBy}
                          </span>
                        )}
                        {log.source && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-slate-900 text-indigo-300 border border-slate-700">
                            source: {log.source}
                          </span>
                        )}
                        {log.providerUsed && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-slate-900 text-emerald-300 border border-slate-700">
                            {log.providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal'}
                          </span>
                        )}
                      </div>

                      {/* Plain-English narrative description */}
                      <p className="text-slate-200 font-medium text-sm leading-relaxed">
                        {log.summaryText}
                      </p>

                      {log.ruleApplied && (
                        <p className="text-xs text-amber-400/90 font-mono bg-amber-950/30 px-2 py-1 rounded border border-amber-900/40 inline-block">
                          🛡️ {log.ruleApplied}
                        </p>
                      )}
                    </div>

                    <div className="text-right text-[11px] text-slate-500 shrink-0 font-mono">
                      {log.createdAt.replace('T', ' ').substring(0, 19)}
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

