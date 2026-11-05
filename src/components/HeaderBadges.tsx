'use client';

import React, { useState, useEffect } from 'react';

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
      {/* PayPal Badge: green for sandbox, amber for mock */}
      <span
        data-testid="header-paypal-badge"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border text-[11px] sm:text-xs transition-colors ${
          paypalIsLive
            ? 'text-emerald-400 bg-emerald-950/70 border-emerald-800/70'
            : 'text-amber-400 bg-amber-950/70 border-amber-800/70'
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            paypalIsLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
          }`}
        />
        {paypalIsLive ? 'PayPal Sandbox' : 'PayPal Mock'}
      </span>

      {/* LLM Badge: green for live, amber for mock */}
      <span
        data-testid="header-llm-badge"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border text-[11px] sm:text-xs transition-colors ${
          llmIsLive
            ? 'text-emerald-400 bg-emerald-950/70 border-emerald-800/70'
            : 'text-amber-400 bg-amber-950/70 border-amber-800/70'
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            llmIsLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
          }`}
        />
        {llmIsLive ? 'Gemini Live' : 'AI Mock'}
      </span>
    </div>
  );
}

