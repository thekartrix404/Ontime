'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { HeaderBadges } from '@/components/HeaderBadges';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  Zap,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Plus,
  Trash2,
  ArrowRight,
  ExternalLink,
  RotateCw,
  Mail,
  FileCheck2,
  FileSpreadsheet,
} from 'lucide-react';

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
    source?: string;
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
  explanationSource?: string;
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
    label: 'Reliable client',
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
    label: 'Chronically late client',
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
    label: 'New client',
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
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null);

  const handleSelectSample = (sampleId: string) => {
    const found = SAMPLE_EMAILS.find((s) => s.id === sampleId);
    if (found) {
      setEmailText(found.text);
      setDraft(null);
      setApprovedInvoices(null);
      setError(null);
      setRetryAction(null);
      setQuotaNotice(null);
      setIsEditing(false);
      toast.info(`Loaded "${found.label}" sample template`);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!emailText.trim()) {
      const msg = 'Please enter or select a client email first.';
      setError(msg);
      toast.error(msg);
      return;
    }

    setLoadingDraft(true);
    setError(null);
    setRetryAction(null);
    setApprovedInvoices(null);
    setQuotaNotice(null);

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailText }),
      });

      const data = await res.json();
      if (!res.ok) {
        const errorText = String(data.error || 'Failed to generate invoice draft');
        if (res.status === 429 || errorText.includes('429') || errorText.includes('quota') || errorText.includes('RESOURCE_EXHAUSTED')) {
          setQuotaNotice('AI quota reached, using fallback');
          toast.warning('AI quota reached, using deterministic rule fallback');
        } else {
          toast.error(errorText);
        }
        throw new Error(errorText);
      }

      setDraft(data);
      toast.success('Invoice extracted and risk scored successfully');

      const ext = data.extraction.data;
      if (ext) {
        setEditClientName(ext.client_name || '');
        setEditCompany(ext.company || '');
        setEditClientEmail(ext.client_email || '');
        setEditCurrency(ext.currency || 'USD');
        setEditProjectType(ext.project_type || '');
        setEditLineItems(ext.line_items || []);
      }

      if (
        data.extraction.error?.includes('429') ||
        data.extraction.error?.includes('quota') ||
        data.extraction.source === 'rule-fallback'
      ) {
        setQuotaNotice('AI quota reached, using fallback');
      }

      if (!data.extraction.success || (data.extraction.missingFields && data.extraction.missingFields.length > 0)) {
        setIsEditing(true);
        toast.warning('Some required invoice fields are missing. Please complete them below.');
      } else {
        setIsEditing(false);
      }
    } catch (err: any) {
      const msg = String(err.message || 'An error occurred while generating the draft.');
      if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        setError('AI quota reached, using fallback');
        setQuotaNotice('AI quota reached, using fallback');
      } else {
        setError(msg);
      }
      setRetryAction(() => () => handleGenerateInvoice());
    } finally {
      setLoadingDraft(false);
    }
  };

  const currentEmail = isEditing ? editClientEmail : draft?.extraction.data.client_email;
  const currentCurrency = isEditing ? editCurrency : draft?.extraction.data.currency;
  const currentLineItems = isEditing ? editLineItems : draft?.extraction.data.line_items;

  const isValidEmail = Boolean(currentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail.trim()));
  const isValidCurrency = Boolean(currentCurrency && currentCurrency.trim().length > 0);
  const hasValidLineItems = Boolean(
    currentLineItems &&
    currentLineItems.length > 0 &&
    currentLineItems.every(
      (item) =>
        Boolean(item.description && item.description.trim().length > 0) &&
        Number(item.unit_price) > 0 &&
        Number(item.quantity) > 0
    )
  );
  const isApproveReady = isValidEmail && isValidCurrency && hasValidLineItems;

  const handleApprove = async (termsMode: 'PROPOSED' | 'AS_IS') => {
    if (!draft) return;
    setApproving(true);
    setError(null);
    setRetryAction(null);

    const clientEmail = isEditing ? editClientEmail : draft.extraction.data.client_email;
    const clientName = isEditing ? editClientName : draft.extraction.data.client_name;
    const company = isEditing ? editCompany : draft.extraction.data.company;
    const currency = isEditing ? editCurrency : draft.extraction.data.currency;
    const projectType = isEditing ? editProjectType : draft.extraction.data.project_type;
    const lineItems = isEditing ? editLineItems : draft.extraction.data.line_items;

    if (!isApproveReady) {
      const msg = 'Approval blocked: invoice requires at least one line item with a positive unit price and real description, a valid client email, and a currency.';
      setError(msg);
      toast.error('Approval blocked: please fix missing or invalid invoice details.');
      setIsEditing(true);
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
      toast.success('Invoices created and dispatched via PayPal!');
    } catch (err: any) {
      const msg = String(err.message || 'Failed to approve invoice.');
      setError(msg);
      toast.error(msg);
      setRetryAction(() => () => handleApprove(termsMode));
    } finally {
      setApproving(false);
    }
  };

  const handleMarkDelivered = async (invoiceId: string) => {
    setDelivering(true);
    setError(null);
    setRetryAction(null);

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

      if (approvedInvoices) {
        const updated = approvedInvoices.map((inv) =>
          inv.id === invoiceId ? { ...inv, status: 'SENT', payer_view_url: data.invoice.payer_view_url } : inv
        );
        setApprovedInvoices(updated);
      }
      if (data.audit) {
        setAuditLogs((prev) => [data.audit, ...prev]);
      }
      toast.success('Project delivered! Final 60% balance invoice dispatched via PayPal.');
    } catch (err: any) {
      const msg = err.message || 'Failed to deliver final invoice.';
      setError(msg);
      toast.error(msg);
      setRetryAction(() => () => handleMarkDelivered(invoiceId));
    } finally {
      setDelivering(false);
    }
  };

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
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Sticky Header with Nav and Mode Badges */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                <Zap size={14} strokeWidth={2.2} />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold tracking-tight">OnTime</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">PayPal agent</span>
              </div>
            </Link>

            <nav className="flex items-center gap-1 text-sm font-medium">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md text-foreground bg-muted/80 transition-colors"
              >
                New invoice
              </Link>
              <Link
                href="/dashboard"
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/audit"
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
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

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Error Notice Banner */}
        {error && (
          <div className="px-4 py-3 rounded-xl border bg-destructive/15 border-destructive/30 text-destructive-foreground flex items-center justify-between text-sm gap-3 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="shrink-0 text-destructive" />
              <span>{error}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {retryAction && (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => {
                    const act = retryAction;
                    setError(null);
                    act();
                  }}
                  className="gap-1"
                >
                  <RotateCw size={11} />
                  <span>Retry</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setError(null)}
                className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
              >
                ×
              </Button>
            </div>
          </div>
        )}

        {/* Quota Notice Banner */}
        {quotaNotice && !error && (
          <div className="px-4 py-3 rounded-xl border bg-amber-950/30 border-amber-800/40 text-amber-300 flex items-center justify-between text-xs gap-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400 shrink-0" />
              <span>AI quota reached, using deterministic rule fallback.</span>
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setQuotaNotice(null)}
              className="text-amber-400/70 hover:text-amber-200 h-6 w-6 p-0"
            >
              ×
            </Button>
          </div>
        )}

        {/* Step 1: Input Card */}
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-md bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                  1
                </span>
                <div>
                  <CardTitle className="text-base font-semibold">Paste client email</CardTitle>
                  <CardDescription className="text-xs">
                    Extract deliverables, identify client history, and recommend payment terms
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto text-xs">
                <label htmlFor="load-sample-select" className="text-muted-foreground whitespace-nowrap">
                  Load sample:
                </label>
                <select
                  id="load-sample-select"
                  onChange={(e) => handleSelectSample(e.target.value)}
                  className="bg-muted/50 border border-input text-foreground rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                >
                  {SAMPLE_EMAILS.map((sample) => (
                    <option key={sample.id} value={sample.id}>
                      {sample.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
            <div>
              <textarea
                id="email-textarea"
                rows={7}
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Paste client email text here (names, deliverables, rates, amounts)..."
                className="w-full bg-muted/30 border border-input rounded-xl p-3.5 text-xs text-foreground placeholder:text-muted-foreground font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring transition resize-y"
              />
            </div>
          </CardContent>

          <CardFooter className="pt-0 flex justify-end">
            <Button
              id="generate-invoice-btn"
              onClick={handleGenerateInvoice}
              disabled={loadingDraft}
              className="gap-2 cursor-pointer font-medium"
            >
              {loadingDraft ? (
                <>
                  <RotateCw size={13} className="animate-spin" />
                  <span>Extracting & assessing risk…</span>
                </>
              ) : (
                <>
                  <span>Generate invoice draft</span>
                  <ArrowRight size={13} />
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        {/* Skeleton Loader during Draft Extraction */}
        {loadingDraft && (
          <Card className="border-border/80 p-6 space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="w-6 h-6 rounded-md" />
                <Skeleton className="h-4 w-44" />
              </div>
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="h-16 w-full rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
          </Card>
        )}

        {/* Friendly Empty State when no draft yet */}
        {!draft && !approvedInvoices && !loadingDraft && (
          <Card className="border-dashed border-border/70 bg-muted/10 p-8 text-center text-muted-foreground space-y-2">
            <div className="w-10 h-10 rounded-full bg-muted/60 text-muted-foreground mx-auto flex items-center justify-center">
              <Mail size={18} />
            </div>
            <p className="text-sm font-medium text-foreground">Ready to extract & evaluate</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Select one of the sample client profiles above or paste your own invoice conversation to calculate risk and propose terms.
            </p>
          </Card>
        )}

        {/* Step 2: Approval Card with Original vs Recommended Terms Side-by-Side */}
        {draft && !approvedInvoices && (
          <Card className="border-border/80 shadow-sm animate-in fade-in duration-200">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-md bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                    2
                  </span>
                  <div>
                    <CardTitle className="text-base font-semibold">Review risk & payment terms</CardTitle>
                    <CardDescription className="text-xs">
                      Rules-based risk assessment paired with terms strategist recommendations
                    </CardDescription>
                  </div>
                </div>

                {/* Risk Level Badge */}
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`gap-1.5 px-3 py-1 text-xs font-medium ${
                      draft.risk.level === 'low'
                        ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400'
                        : draft.risk.level === 'medium'
                        ? 'bg-amber-950/40 border-amber-900/50 text-amber-400'
                        : 'bg-rose-950/40 border-rose-900/50 text-rose-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        draft.risk.level === 'low'
                          ? 'bg-emerald-400'
                          : draft.risk.level === 'medium'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    {draft.risk.level === 'low'
                      ? 'Low risk'
                      : draft.risk.level === 'medium'
                      ? 'Medium risk'
                      : 'High risk'}{' '}
                    <span className="font-mono">({draft.risk.score}/100)</span>
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-0">
              {/* AI Explanation Banner */}
              <div className="bg-muted/40 border border-border/80 rounded-xl p-4 flex gap-3">
                <Sparkles size={15} strokeWidth={1.5} className="text-indigo-400 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">AI terms recommendation</span>
                    {draft.explanationSource && (
                      <Badge variant="outline" className="text-[10px] py-0 font-mono text-muted-foreground">
                        {draft.explanationSource}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    &ldquo;{draft.explanation}&rdquo;
                  </p>
                </div>
              </div>

              {/* Risk Factors Breakdown */}
              <div className="bg-muted/20 border border-border/60 rounded-xl p-4 space-y-3">
                <span className="text-xs font-medium text-muted-foreground block">
                  Risk factors (database history)
                </span>
                <ul className="text-xs text-foreground space-y-1.5">
                  {draft.risk.reasons.map((r, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
                <div className="pt-3 flex flex-wrap gap-5 text-xs text-muted-foreground border-t border-border/50 font-mono">
                  <span>Invoices on record: <strong className="text-foreground">{draft.risk.metrics.totalInvoices}</strong></span>
                  <span>Late invoices: <strong className="text-foreground">{draft.risk.metrics.lateInvoices}</strong></span>
                  <span>Avg days late: <strong className="text-foreground">{draft.risk.metrics.averageDaysLate}d</strong></span>
                </div>
              </div>

              {/* Side-by-Side Terms Comparison in Two Columns */}
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground block">
                  Terms comparison
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Column 1: Original Standard Terms */}
                  <Card className="bg-card/50 border-border/80 flex flex-col justify-between">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-medium">Original terms</span>
                        <Badge variant="secondary" className="text-[10px] py-0">
                          Baseline
                        </Badge>
                      </div>
                      <CardTitle className="text-base font-semibold text-foreground pt-1">
                        {draft.originalTerms.summary}
                      </CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        {draft.originalTerms.description}
                      </CardDescription>
                    </CardHeader>
                    <CardFooter className="pt-2 border-t border-border/50 text-xs text-muted-foreground font-mono">
                      Total: <span className="text-foreground font-medium ml-1">${draft.originalTerms.totalAmount} USD</span>
                    </CardFooter>
                  </Card>

                  {/* Column 2: Recommended Guardrail Terms */}
                  <Card className="bg-indigo-950/20 border-indigo-900/60 flex flex-col justify-between shadow-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-indigo-400 font-medium">Recommended terms</span>
                        <Badge variant="outline" className="text-[10px] py-0 bg-indigo-950/60 text-indigo-300 border-indigo-800">
                          Optimized
                        </Badge>
                      </div>
                      <CardTitle className="text-base font-semibold text-indigo-200 pt-1">
                        {draft.proposedTerms.summary}
                      </CardTitle>
                      <CardDescription className="text-xs text-indigo-300/80 leading-relaxed">
                        {draft.proposedTerms.description}
                      </CardDescription>
                    </CardHeader>
                    <CardFooter className="pt-2 border-t border-indigo-900/40 text-xs text-indigo-300 font-mono flex-col items-start gap-0.5">
                      <div>Total: <span className="text-foreground font-medium ml-1">${draft.proposedTerms.totalAmount} USD</span></div>
                      {draft.proposedTerms.depositAmount && (
                        <div className="text-rose-400 text-[11px]">
                          40% deposit: ${draft.proposedTerms.depositAmount} USD upfront
                        </div>
                      )}
                      {draft.proposedTerms.discountAmount && (
                        <div className="text-emerald-400 text-[11px]">
                          Early-pay: ${draft.proposedTerms.discountedAmount} USD (save ${draft.proposedTerms.discountAmount})
                        </div>
                      )}
                    </CardFooter>
                  </Card>
                </div>
              </div>

              {/* Extracted Details & Inline Line-Item Editor */}
              <div className="bg-muted/30 border border-border/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">Extracted invoice details</span>
                    {draft.extraction.source && (
                      <Badge variant="outline" className="text-[10px] py-0 font-mono text-muted-foreground">
                        {draft.extraction.source}
                      </Badge>
                    )}
                    {draft.extraction.missingFields && draft.extraction.missingFields.length > 0 && (
                      <Badge variant="destructive" className="text-[10px] py-0">
                        Missing: {draft.extraction.missingFields.join(', ')}
                      </Badge>
                    )}
                  </div>
                  <Button
                    id="edit-draft-btn"
                    variant="link"
                    size="xs"
                    onClick={() => setIsEditing(!isEditing)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 p-0"
                  >
                    {isEditing ? 'Done editing' : 'Edit details'}
                  </Button>
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                    <div>
                      <label className="block text-muted-foreground mb-1 text-[11px]">Company / organization</label>
                      <input
                        type="text"
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        placeholder="e.g. Reliable Solutions LLC"
                        className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-muted-foreground mb-1 text-[11px]">Contact person</label>
                      <input
                        type="text"
                        value={editClientName}
                        onChange={(e) => setEditClientName(e.target.value)}
                        placeholder="e.g. Alice Vance"
                        className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-muted-foreground mb-1 text-[11px]">Client email (required)</label>
                      <input
                        type="email"
                        value={editClientEmail}
                        onChange={(e) => setEditClientEmail(e.target.value)}
                        placeholder="e.g. alice@reliablecorp.com"
                        className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-muted-foreground mb-1 text-[11px]">Currency</label>
                      <input
                        type="text"
                        value={editCurrency}
                        onChange={(e) => setEditCurrency(e.target.value)}
                        className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>

                    {/* Line Items Editor */}
                    <div className="sm:col-span-2 space-y-2 pt-2 border-t border-border/50">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-foreground">Line items</span>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={handleAddItem}
                          className="gap-1 text-xs text-indigo-400 hover:text-indigo-300"
                        >
                          <Plus size={12} /> Add item
                        </Button>
                      </div>
                      {editLineItems.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                            placeholder="Description"
                            className="flex-1 bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                            placeholder="Qty"
                            className="w-16 bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <input
                            type="number"
                            value={item.unit_price}
                            onChange={(e) => handleItemChange(idx, 'unit_price', Number(e.target.value))}
                            placeholder="Price"
                            className="w-24 bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleRemoveItem(idx)}
                            className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted-foreground">
                      <div className="bg-background/80 p-2.5 rounded-lg border border-border/50">
                        <span className="text-muted-foreground block text-[11px] mb-0.5">Company:</span>
                        <span className="text-foreground font-medium">{draft.extraction.data.company || '—'}</span>
                      </div>
                      <div className="bg-background/80 p-2.5 rounded-lg border border-border/50">
                        <span className="text-muted-foreground block text-[11px] mb-0.5">Contact:</span>
                        <span className="text-foreground font-medium">{draft.extraction.data.client_name || '—'}</span>
                      </div>
                      <div className="bg-background/80 p-2.5 rounded-lg border border-border/50">
                        <span className="text-muted-foreground block text-[11px] mb-0.5">Client email:</span>
                        <span className="text-indigo-400 font-medium">{draft.extraction.data.client_email || '—'}</span>
                      </div>
                      <div className="bg-background/80 p-2.5 rounded-lg border border-border/50">
                        <span className="text-muted-foreground block text-[11px] mb-0.5">Project & currency:</span>
                        <span className="text-foreground font-medium">{draft.extraction.data.project_type || 'General'} ({draft.extraction.data.currency})</span>
                      </div>
                    </div>

                    <div className="pt-1">
                      <span className="text-muted-foreground block mb-1 text-xs">Line items:</span>
                      <div className="space-y-1">
                        {draft.extraction.data.line_items.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-foreground bg-background/80 border border-border/50 px-3 py-2 rounded-lg">
                            <span className="text-xs">{item.description} (×{item.quantity})</span>
                            <span className="text-xs font-mono font-medium">
                              ${(item.quantity * item.unit_price).toFixed(2)} USD
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Demo Safety Notice */}
              <div className="text-xs text-muted-foreground bg-muted/20 px-3.5 py-2.5 rounded-xl border border-border/60 flex items-center gap-2">
                <ShieldCheck size={14} className="text-muted-foreground shrink-0" />
                <span>
                  <strong>Demo safety active:</strong> In sandbox mode, emails route safely to test sandbox recipient while showing client identity.
                </span>
              </div>

              {/* Warning if Approve is blocked */}
              {!isApproveReady && (
                <div className="bg-destructive/15 border border-destructive/30 text-destructive-foreground text-xs p-3.5 rounded-xl flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0 text-destructive" />
                    <span>
                      Approval blocked: requires valid line items, positive unit price, valid email, and currency.
                    </span>
                  </div>
                  {!isEditing && (
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => setIsEditing(true)}
                      className="text-xs text-destructive-foreground underline p-0"
                    >
                      Edit details
                    </Button>
                  )}
                </div>
              )}
            </CardContent>

            <CardFooter className="pt-2 border-t border-border/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
              <Button
                id="send-as-is-btn"
                variant="outline"
                onClick={() => handleApprove('AS_IS')}
                disabled={approving || !isApproveReady}
                className="order-2 sm:order-1 cursor-pointer"
              >
                Send as-is
              </Button>
              <Button
                id="approve-proposed-btn"
                onClick={() => handleApprove('PROPOSED')}
                disabled={approving || !isApproveReady}
                className="order-1 sm:order-2 cursor-pointer font-medium gap-2"
              >
                {approving ? (
                  <>
                    <RotateCw size={13} className="animate-spin" />
                    <span>Creating & sending PayPal invoice…</span>
                  </>
                ) : (
                  <>
                    <span>Approve proposed terms</span>
                    <CheckCircle2 size={13} />
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 3: Approval Success & Payer View */}
        {approvedInvoices && (
          <Card className="border-border/80 shadow-sm animate-in fade-in duration-200">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-900/40 flex items-center justify-center">
                    <CheckCircle2 size={15} />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">Invoices created successfully</CardTitle>
                    <CardDescription className="text-xs">
                      PayPal sandbox invoice created and dispatched per approved terms
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setApprovedInvoices(null);
                    setDraft(null);
                  }}
                  className="self-start sm:self-auto cursor-pointer"
                >
                  New invoice
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-0">
              {/* Invoices List */}
              <div className="space-y-3">
                {approvedInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="bg-muted/20 border border-border/70 rounded-xl p-4 sm:p-5 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold font-mono">
                            {inv.invoice_number}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              inv.status === 'SENT'
                                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
                                : 'bg-amber-950/40 text-amber-400 border-amber-900/50'
                            }`}
                          >
                            {inv.status}
                          </Badge>
                          {inv.is_deposit && (
                            <Badge variant="outline" className="text-xs bg-rose-950/40 text-rose-300 border-rose-900/50">
                              40% deposit
                            </Badge>
                          )}
                          {inv.is_delivery && (
                            <Badge variant="outline" className="text-xs bg-indigo-950/40 text-indigo-300 border-indigo-900/50">
                              60% balance on delivery
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Client: <strong className="text-foreground">{inv.client_email}</strong> · Terms: <strong className="text-foreground">{inv.terms}</strong>
                        </p>
                      </div>

                      <div className="text-left sm:text-right">
                        <div className="text-lg font-semibold font-mono">
                          ${inv.amount} <span className="text-xs text-muted-foreground font-normal">{inv.currency}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          PayPal: {inv.paypal_invoice_id}
                        </div>
                      </div>
                    </div>

                    {/* Actions for this invoice */}
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/50">
                      {inv.payer_view_url && (
                        <a
                          id={`payer-view-link-${inv.id}`}
                          href={inv.payer_view_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonVariants({ size: 'xs', className: 'gap-1.5' })}
                        >
                          <span>Open PayPal payer-view</span>
                          <ExternalLink size={12} />
                        </a>
                      )}

                      {inv.is_delivery && inv.status === 'DRAFT' && (
                        <Button
                          id="mark-delivered-btn"
                          size="xs"
                          variant="secondary"
                          onClick={() => handleMarkDelivered(inv.id)}
                          disabled={delivering}
                          className="gap-1.5 bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-800/60"
                        >
                          {delivering ? 'Sending balance invoice…' : 'Mark delivered & send balance'}
                          <ArrowRight size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Audit Log Trail */}
              {auditLogs.length > 0 && (
                <div className="bg-muted/30 border border-border/60 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-medium text-muted-foreground block">
                    Audit log trail
                  </span>
                  <div className="space-y-1">
                    {auditLogs.map((log, idx) => (
                      <div key={idx} className="text-xs text-muted-foreground font-mono bg-background/60 p-2.5 rounded-lg border border-border/40">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
