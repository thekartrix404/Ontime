'use client';

import React, { useState } from 'react';

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

interface DraftData {
  extraction: {
    success: boolean;
    missingFields: string[];
    error?: string;
    data: {
      client_name: string | null;
      company: string | null;
      client_email: string | null;
      currency: string;
      project_type: string | null;
      line_items: LineItem[];
    };
  };
  client: {
    id: string | null;
    name: string | null;
    company: string | null;
    email: string | null;
    isNew: boolean;
  };
  totalAmount: string;
  risk: {
    score: number;
    level: 'low' | 'medium' | 'high';
    reasons: string[];
    metrics: {
      totalInvoices: number;
      lateInvoices: number;
      averageDaysLate: number;
      typicalInvoiceSize: number;
    };
  };
  proposedTerms: {
    level: 'low' | 'medium' | 'high';
    summary: string;
    description: string;
    termType: string;
    totalAmount: string;
    netDays?: number;
    discountPercentage?: number;
    discountAmount?: string;
    discountedAmount?: string;
    depositPercentage?: number;
    depositAmount?: string;
    deliveryPercentage?: number;
    deliveryAmount?: string;
  };
  originalTerms: {
    summary: string;
    description: string;
    netDays: number;
    totalAmount: string;
  };
  explanation: string;
}

interface InvoiceResult {
  id: string;
  invoice_number: string;
  amount: string;
  currency: string;
  status: string;
  terms: string;
  paypal_invoice_id: string;
  payer_view_url: string;
  client_email: string;
  demo_recipient_email: string;
  is_deposit?: boolean;
  is_delivery?: boolean;
  project_id?: string;
}

const SAMPLE_EMAILS = [
  {
    id: 'reliable',
    label: 'Client (a): Reliable (Alice Vance - 4/4 on time)',
    text: `Hi Alex,
Hope you're having a great week! Thanks for completing the quarterly web infrastructure maintenance.
Please send over the invoice for $1,800.00 USD to Reliable Solutions LLC, attention Alice Vance at alice@reliablecorp.com.
The line item is "Quarterly Web Infrastructure Maintenance", 1 unit at $1,800.00.
We'll process it promptly as always.
Best regards,
Alice Vance`,
  },
  {
    id: 'late',
    label: 'Client (b): Chronically Late (Bob Slow - 3/4 late, avg 19 days)',
    text: `Hey Alex,
Wrapping up the campaign assets. Go ahead and invoice Lagging Dynamics Inc for Bob Slow (bob@lateinc.com).
Item 1: "Digital Marketing Campaign Strategy" - 1 unit at $2,000.00
Item 2: "Custom Ad Creative Bundle" - 2 units at $500.00
Total scope is for USD currency.
Thanks,
Bob`,
  },
  {
    id: 'new',
    label: 'Client (c): New Client (Claire Startup - No History)',
    text: `Hi Alex!
Thrilled to kick off our work together. Please bill New Horizons Ltd, attention Claire Startup (claire@newhorizons.io) for the project:
"Brand Identity & Style Guide" - 1 unit at $1,500.00 USD.
Looking forward to getting started!
Cheers,
Claire`,
  },
];

export default function Home() {
  const [emailText, setEmailText] = useState(SAMPLE_EMAILS[0].text);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [approving, setApproving] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [draft, setDraft] = useState<DraftData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable draft states
  const [isEditing, setIsEditing] = useState(false);
  const [editClientName, setEditClientName] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editClientEmail, setEditClientEmail] = useState('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [editProjectType, setEditProjectType] = useState('');
  const [editLineItems, setEditLineItems] = useState<LineItem[]>([]);

  // Approval result
  const [approvedInvoices, setApprovedInvoices] = useState<InvoiceResult[] | null>(null);
  const [auditLogs, setAuditLogs] = useState<string[]>([]);

  const handleSelectSample = (sampleId: string) => {
    const found = SAMPLE_EMAILS.find((s) => s.id === sampleId);
    if (found) {
      setEmailText(found.text);
      setDraft(null);
      setApprovedInvoices(null);
      setError(null);
      setIsEditing(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!emailText.trim()) {
      setError('Please enter or select a client email first.');
      return;
    }

    setLoadingDraft(true);
    setError(null);
    setApprovedInvoices(null);

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailText }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate invoice draft');
      }

      setDraft(data);

      // Populate editable fields
      const ext = data.extraction.data;
      setEditClientName(ext.client_name || '');
      setEditCompany(ext.company || '');
      setEditClientEmail(ext.client_email || '');
      setEditCurrency(ext.currency || 'USD');
      setEditProjectType(ext.project_type || '');
      setEditLineItems(ext.line_items || []);

      // If missing fields, open edit mode automatically
      if (data.extraction.missingFields && data.extraction.missingFields.length > 0) {
        setIsEditing(true);
      } else {
        setIsEditing(false);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while generating the draft.');
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleApprove = async (termsMode: 'PROPOSED' | 'AS_IS') => {
    if (!draft) return;
    setApproving(true);
    setError(null);

    const clientEmail = isEditing ? editClientEmail : draft.extraction.data.client_email;
    const clientName = isEditing ? editClientName : draft.extraction.data.client_name;
    const company = isEditing ? editCompany : draft.extraction.data.company;
    const currency = isEditing ? editCurrency : draft.extraction.data.currency;
    const projectType = isEditing ? editProjectType : draft.extraction.data.project_type;
    const lineItems = isEditing ? editLineItems : draft.extraction.data.line_items;

    if (!clientEmail || !lineItems || lineItems.length === 0) {
      setError('Client email and at least one line item are required before approval.');
      setApproving(false);
      return;
    }

    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          company,
          client_email: clientEmail,
          currency,
          project_type: projectType,
          line_items: lineItems,
          terms_mode: termsMode,
          risk_level: draft.risk.level,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve and send invoice.');
      }

      setApprovedInvoices(data.invoices);
      setAuditLogs(data.audit || []);
    } catch (err: any) {
      setError(err.message || 'Failed to approve invoice.');
    } finally {
      setApproving(false);
    }
  };

  const handleMarkDelivered = async (invoiceId: string) => {
    setDelivering(true);
    setError(null);

    try {
      const res = await fetch('/api/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mark project delivered.');
      }

      // Update the invoice in state
      if (approvedInvoices) {
        const updated = approvedInvoices.map((inv) =>
          inv.id === invoiceId ? { ...inv, status: 'SENT', payer_view_url: data.invoice.payer_view_url } : inv
        );
        setApprovedInvoices(updated);
      }
      if (data.audit) {
        setAuditLogs((prev) => [data.audit, ...prev]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to deliver final invoice.');
    } finally {
      setDelivering(false);
    }
  };

  // Line item helpers for edit mode
  const handleItemChange = (index: number, field: keyof LineItem, value: any) => {
    const updated = [...editLineItems];
    updated[index] = { ...updated[index], [field]: value };
    setEditLineItems(updated);
  };

  const handleAddItem = () => {
    setEditLineItems([...editLineItems, { description: 'New Service', quantity: 1, unit_price: 100 }]);
  };

  const handleRemoveItem = (index: number) => {
    setEditLineItems(editLineItems.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur sticky top-0 z-20 px-6 py-4 flex items-center justify-between shadow-lg shadow-black/20">
        <div className="max-w-[900px] w-full mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center font-bold text-white shadow-indigo-500/25 shadow-lg border border-indigo-400/30 text-lg">
              ⚡
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                OnTime <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 font-semibold border border-indigo-700/60 uppercase tracking-wider">PayPal Agent</span>
              </h1>
              <p className="text-xs text-slate-400">Preventing late payments before they happen</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-2 text-emerald-400 bg-emerald-950/70 border border-emerald-800/70 px-3 py-1.5 rounded-full font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              PayPal Sandbox Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Centered Container (Max Width 900px) */}
      <main className="flex-1 max-w-[900px] w-full mx-auto px-4 py-8 space-y-8">
        {/* Error Banner */}
        {error && (
          <div className="bg-rose-950/80 border border-rose-800/90 text-rose-200 px-5 py-4 rounded-2xl flex items-start justify-between shadow-xl animate-in fade-in">
            <div className="flex items-start gap-3">
              <span className="text-rose-400 text-lg leading-none mt-0.5">⚠️</span>
              <div>
                <p className="font-bold text-sm">Action Notice</p>
                <p className="text-xs text-rose-300 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-rose-400 hover:text-rose-100 text-xl font-bold leading-none p-1"
            >
              ×
            </button>
          </div>
        )}

        {/* Step 1: Input Card */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-indigo-600/30 text-indigo-400 text-sm font-extrabold flex items-center justify-center border border-indigo-500/40">1</span>
                Paste Client Email
              </h2>
              <p className="text-xs text-slate-400 mt-1">Extract deliverables, identify client, and calculate smart guardrail terms.</p>
            </div>
            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <label htmlFor="load-sample-select" className="text-xs text-slate-400 font-semibold whitespace-nowrap">
                Load sample:
              </label>
              <select
                id="load-sample-select"
                onChange={(e) => handleSelectSample(e.target.value)}
                className="bg-slate-950 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium transition cursor-pointer"
              >
                {SAMPLE_EMAILS.map((sample) => (
                  <option key={sample.id} value={sample.id}>
                    {sample.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <textarea
              id="email-textarea"
              rows={8}
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste your client email text here (names, deliverables, rates, amounts)..."
              className="w-full min-h-[200px] bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono transition resize-y leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end pt-2">
            <button
              id="generate-invoice-btn"
              onClick={handleGenerateInvoice}
              disabled={loadingDraft}
              className="w-full sm:w-auto px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              {loadingDraft ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Extracting & Assessing Risk...</span>
                </>
              ) : (
                <>Generate Invoice Draft ➔</>
              )}
            </button>
          </div>
        </section>

        {/* Step 2: Approval Card */}
        {draft && !approvedInvoices && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-indigo-600/30 text-indigo-400 text-sm font-extrabold flex items-center justify-center border border-indigo-500/40">2</span>
                  Review Risk & Payment Terms
                </h2>
                <p className="text-xs text-slate-400 mt-1">Review AI extraction, rules-based risk assessment, and recommended terms.</p>
              </div>

              {/* Risk Badge (Green Low, Amber Medium, Red High) */}
              <div className="flex items-center gap-3">
                <div
                  className={`px-4 py-2 rounded-full border flex items-center gap-2.5 font-bold text-xs uppercase tracking-wider shadow-md ${
                    draft.risk.level === 'low'
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-emerald-950/50'
                      : draft.risk.level === 'medium'
                      ? 'bg-amber-950/80 border-amber-500 text-amber-300 shadow-amber-950/50'
                      : 'bg-rose-950/80 border-rose-500 text-rose-300 shadow-rose-950/50'
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      draft.risk.level === 'low'
                        ? 'bg-emerald-400'
                        : draft.risk.level === 'medium'
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                    }`}
                  />
                  {draft.risk.level} Risk ({draft.risk.score}/100)
                </div>
              </div>
            </div>

            {/* AI Explanation Banner */}
            <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-xl p-5 flex gap-3.5 shadow-inner">
              <span className="text-indigo-400 text-xl leading-none mt-0.5">💡</span>
              <div className="space-y-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                  AI Terms Recommendation
                </h3>
                <p className="text-sm text-slate-200 leading-relaxed italic">
                  &ldquo;{draft.explanation}&rdquo;
                </p>
              </div>
            </div>

            {/* Risk Factors */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Risk Engine Insights (From Database History)
              </h4>
              <ul className="text-xs text-slate-300 space-y-1.5">
                {draft.risk.reasons.map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-3 flex flex-wrap gap-5 text-xs text-slate-400 border-t border-slate-800/80">
                <span>Invoices on record: <strong className="text-slate-200">{draft.risk.metrics.totalInvoices}</strong></span>
                <span>Late invoices: <strong className="text-slate-200">{draft.risk.metrics.lateInvoices}</strong></span>
                <span>Avg days late: <strong className="text-slate-200">{draft.risk.metrics.averageDaysLate} d</strong></span>
              </div>
            </div>

            {/* Side-by-Side Terms Comparison in Two Columns */}
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Terms Comparison
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Column 1: Original Standard Terms */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Original Terms
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        Baseline
                      </span>
                    </div>
                    <div className="text-xl font-extrabold text-slate-200">{draft.originalTerms.summary}</div>
                    <p className="text-xs text-slate-400 leading-relaxed">{draft.originalTerms.description}</p>
                  </div>
                  <div className="pt-3 border-t border-slate-800/80 text-sm font-semibold text-slate-300">
                    Total Amount: <span className="text-white font-bold">${draft.originalTerms.totalAmount} USD</span>
                  </div>
                </div>

                {/* Column 2: Recommended Guardrail Terms */}
                <div className="bg-gradient-to-br from-indigo-950/50 to-slate-950/80 border border-indigo-700/60 rounded-xl p-5 space-y-3 flex flex-col justify-between shadow-lg shadow-indigo-950/30">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                        Recommended Terms
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 font-semibold">
                        Optimized
                      </span>
                    </div>
                    <div className="text-xl font-extrabold text-indigo-200">{draft.proposedTerms.summary}</div>
                    <p className="text-xs text-indigo-300/80 leading-relaxed">{draft.proposedTerms.description}</p>
                  </div>
                  <div className="pt-3 border-t border-indigo-800/50 text-sm font-semibold text-indigo-300">
                    Total Value: <span className="text-white font-bold">${draft.proposedTerms.totalAmount} USD</span>
                    {draft.proposedTerms.depositAmount && (
                      <span className="block text-xs text-rose-300 font-medium mt-1">
                        → 40% Deposit: ${draft.proposedTerms.depositAmount} USD upfront
                      </span>
                    )}
                    {draft.proposedTerms.discountAmount && (
                      <span className="block text-xs text-emerald-300 font-medium mt-1">
                        → Early-pay net: ${draft.proposedTerms.discountedAmount} USD (save ${draft.proposedTerms.discountAmount})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Extracted Details / Edit Section */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Extracted Invoice Details</span>
                  {draft.extraction.missingFields && draft.extraction.missingFields.length > 0 && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 font-semibold">
                      Missing: {draft.extraction.missingFields.join(', ')}
                    </span>
                  )}
                </h4>
                <button
                  id="edit-draft-btn"
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline underline-offset-2"
                >
                  {isEditing ? 'Done Editing ✓' : 'Edit Details ✎'}
                </button>
              </div>

              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2">
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Company / Organization (on invoice)</label>
                    <input
                      type="text"
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      placeholder="e.g. Reliable Solutions LLC"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Contact Person (client_name)</label>
                    <input
                      type="text"
                      value={editClientName}
                      onChange={(e) => setEditClientName(e.target.value)}
                      placeholder="e.g. Alice Vance"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Client Email (Required)</label>
                    <input
                      type="email"
                      value={editClientEmail}
                      onChange={(e) => setEditClientEmail(e.target.value)}
                      placeholder="e.g. alice@reliablecorp.com"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Currency</label>
                    <input
                      type="text"
                      value={editCurrency}
                      onChange={(e) => setEditCurrency(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Line Items Editor */}
                  <div className="sm:col-span-2 space-y-2 pt-3 border-t border-slate-800">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-300">Line Items</span>
                      <button
                        onClick={handleAddItem}
                        className="text-indigo-400 text-xs font-semibold hover:text-indigo-300 cursor-pointer"
                      >
                        + Add Item
                      </button>
                    </div>
                    {editLineItems.map((item, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                          placeholder="Description"
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
                        />
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                          placeholder="Qty"
                          className="w-16 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
                        />
                        <input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => handleItemChange(idx, 'unit_price', Number(e.target.value))}
                          placeholder="Price"
                          className="w-24 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
                        />
                        <button
                          onClick={() => handleRemoveItem(idx)}
                          className="text-rose-400 hover:text-rose-300 px-2 font-bold cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-300">
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-slate-500 block mb-0.5">Company:</span>
                      <span className="font-semibold text-slate-200">{draft.extraction.data.company || '—'}</span>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-slate-500 block mb-0.5">Contact:</span>
                      <span className="font-semibold text-slate-200">{draft.extraction.data.client_name || '—'}</span>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-slate-500 block mb-0.5">Client Email:</span>
                      <span className="font-semibold text-indigo-300">{draft.extraction.data.client_email || '— (Missing)'}</span>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-slate-500 block mb-0.5">Project / Curr:</span>
                      <span className="font-semibold text-slate-200">{draft.extraction.data.project_type || 'General'} ({draft.extraction.data.currency})</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <span className="text-slate-400 block mb-1.5 font-semibold">Line Items:</span>
                    <div className="space-y-1.5">
                      {draft.extraction.data.line_items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-slate-300 bg-slate-900/70 border border-slate-800/60 px-3.5 py-2 rounded-lg">
                          <span className="font-medium">{item.description} (x{item.quantity})</span>
                          <span className="font-bold text-white">${(item.quantity * item.unit_price).toFixed(2)} USD</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Demo Safety Notice */}
            <div className="text-xs text-slate-400 bg-slate-950/90 px-4 py-3 rounded-xl border border-slate-800/90 flex items-center justify-between">
              <span>
                🛡️ <strong>Demo Safety Active:</strong> PayPal API will route real test emails to your sandbox recipient, while displaying the client&apos;s real extracted email in the UI.
              </span>
            </div>

            {/* Large Clearly Separated Bottom Action Buttons */}
            <div className="border-t border-slate-800 pt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-4">
              <button
                id="send-as-is-btn"
                onClick={() => handleApprove('AS_IS')}
                disabled={approving}
                className="order-2 sm:order-1 px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition border border-slate-700 disabled:opacity-50 cursor-pointer text-center"
              >
                Send as-is
              </button>
              <button
                id="approve-proposed-btn"
                onClick={() => handleApprove('PROPOSED')}
                disabled={approving}
                className="order-1 sm:order-2 px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-extrabold transition shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2.5 disabled:opacity-50 cursor-pointer text-center"
              >
                {approving ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Creating & Sending PayPal Invoice...</span>
                  </>
                ) : (
                  <>Approve Proposed Terms ✓</>
                )}
              </button>
            </div>
          </section>
        )}

        {/* Step 3: Approval Success & Payer View */}
        {approvedInvoices && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-5">
              <div>
                <h2 className="text-xl font-bold text-emerald-400 flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white text-sm font-extrabold flex items-center justify-center shadow-lg shadow-emerald-600/30">✓</span>
                  Invoice Created & Processed Successfully!
                </h2>
                <p className="text-xs text-slate-400 mt-1">PayPal sandbox invoice has been created and sent according to approved terms.</p>
              </div>
              <button
                onClick={() => {
                  setApprovedInvoices(null);
                  setDraft(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer self-start sm:self-auto"
              >
                + Create Another Invoice
              </button>
            </div>

            {/* Invoices List */}
            <div className="space-y-4">
              {approvedInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="bg-slate-950/90 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4 shadow-md"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-lg font-extrabold text-white">{inv.invoice_number}</span>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                            inv.status === 'SENT'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}
                        >
                          {inv.status}
                        </span>
                        {inv.is_deposit && (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 font-semibold">
                            40% Upfront Deposit
                          </span>
                        )}
                        {inv.is_delivery && (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 font-semibold">
                            60% Final Balance (Upon Delivery)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">
                        Client: <strong className="text-slate-200">{inv.client_email}</strong> | Terms: <strong className="text-slate-200">{inv.terms}</strong>
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <div className="text-2xl font-black text-white">
                        ${inv.amount} <span className="text-sm font-normal text-slate-400">{inv.currency}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">PayPal ID: {inv.paypal_invoice_id}</div>
                    </div>
                  </div>

                  {/* Actions for this invoice */}
                  <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800/80">
                    {/* PayPal Payer View Link */}
                    {inv.payer_view_url && (
                      <a
                        id={`payer-view-link-${inv.id}`}
                        href={inv.payer_view_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-lg shadow-indigo-600/25 flex items-center gap-2 cursor-pointer"
                      >
                        Open PayPal Payer-View ↗
                      </a>
                    )}

                    {/* High Risk "Mark delivered" Button */}
                    {inv.is_delivery && inv.status === 'DRAFT' && (
                      <button
                        id="mark-delivered-btn"
                        onClick={() => handleMarkDelivered(inv.id)}
                        disabled={delivering}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg shadow-emerald-600/25 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                      >
                        {delivering ? 'Sending Balance Invoice...' : 'Mark Delivered & Send 60% Balance ➔'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Audit Log Trail */}
            {auditLogs.length > 0 && (
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-2.5">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Plain-English Audit Log
                </h4>
                <div className="space-y-1.5">
                  {auditLogs.map((log, idx) => (
                    <div key={idx} className="text-xs text-slate-300 font-mono bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/50">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
