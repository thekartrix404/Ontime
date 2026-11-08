'use client';

import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface AppStatus {
  paypalMode: 'sandbox' | 'mock';
  llmMode: 'live' | 'mock';
}

export function HeaderBadges() {
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    fetch('/api/status')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load status');
        return res.json();
      })
      .then((data) => {
        setStatus({
          paypalMode: data.paypalMode === 'sandbox' ? 'sandbox' : 'mock',
          llmMode: data.llmMode === 'live' ? 'live' : 'mock',
        });
      })
      .catch(() => {
        setStatus({ paypalMode: 'mock', llmMode: 'mock' });
      });
  }, []);

  const paypalIsLive = status?.paypalMode === 'sandbox';
  const llmIsLive = status?.llmMode === 'live';

  return (
    <div className="flex items-center gap-2 text-xs">
      <Tooltip>
        <TooltipTrigger>
          <span
            data-testid="header-paypal-badge"
            className="cursor-help inline-flex"
          >
            <Badge
              variant="outline"
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border transition-colors ${
                paypalIsLive
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50 hover:bg-emerald-950/60'
                  : 'text-amber-400 bg-amber-950/40 border-amber-900/50 hover:bg-amber-950/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  paypalIsLive ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {paypalIsLive ? 'PayPal Sandbox' : 'PayPal Mock'}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-xs">
          {paypalIsLive
            ? 'Connected to real PayPal Sandbox API (Invoicing v2)'
            : 'Using MockPayPal provider (local deterministic in-memory provider)'}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger>
          <span
            data-testid="header-llm-badge"
            className="cursor-help inline-flex"
          >
            <Badge
              variant="outline"
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border transition-colors ${
                llmIsLive
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50 hover:bg-emerald-950/60'
                  : 'text-amber-400 bg-amber-950/40 border-amber-900/50 hover:bg-amber-950/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  llmIsLive ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {llmIsLive ? 'Gemini Live' : 'AI Mock'}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-xs">
          {llmIsLive
            ? 'Live Gemini model calls via @google/genai SDK'
            : 'Deterministic mock responses without external API calls'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
