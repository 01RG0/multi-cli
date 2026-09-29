/**
 * TokenMeter — live token counter for the chat header.
 *
 * Answers one question at a glance: "is Ultron actually working right now?"
 * The proxy's /v1/messages call is non-streaming, so there are no token deltas
 * to render mid-flight. Instead this shows:
 *   - the running session total (input / output / total) from `usage` on each
 *     assistant message, which the proxy fills from the serving provider;
 *   - a live elapsed + throughput readout while a turn is in flight, so a hung
 *     or silently-retried request is visible instead of looking like a pause;
 *   - a flash when a turn lands, and a red state if the last turn errored.
 *
 * Throughput (output tokens / latency) is the most useful signal here: it
 * collapses to 0 when a provider returns a degraded reply with no token
 * accounting, which is exactly the failure the router now works around.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import type { ChatMessage } from './useOrchestatorChat';

interface TokenMeterProps {
  messages: ChatMessage[];
  isLoading: boolean;
}

interface SessionTotals {
  input: number;
  output: number;
  total: number;
  turns: number;
  /** output tokens per second on the most recent completed turn */
  lastThroughput: number | null;
  lastLatencyMs: number | null;
  lastProvider: string | null;
  /** true when the newest assistant turn is an error */
  lastFailed: boolean;
}

function computeTotals(messages: ChatMessage[]): SessionTotals {
  let input = 0;
  let output = 0;
  let turns = 0;
  let lastThroughput: number | null = null;
  let lastLatencyMs: number | null = null;
  let lastProvider: string | null = null;
  let lastFailed = false;

  for (const m of messages) {
    // Tool-call turns carry usage too (attached to the first card of the
    // group), so count both roles or the meter under-reports exactly the
    // turns where Ultron is doing the most work.
    if (m.role !== 'assistant' && m.role !== 'tool_call') continue;
    if (m.status === 'error') {
      lastFailed = true;
      continue;
    }
    if (m.usage) {
      input += m.usage.input_tokens ?? 0;
      output += m.usage.output_tokens ?? 0;
      turns += 1;
    }
    if (typeof m.latencyMs === 'number' && m.latencyMs > 0) {
      lastLatencyMs = m.latencyMs;
      const out = m.usage?.output_tokens ?? 0;
      lastThroughput = out > 0 ? out / (m.latencyMs / 1000) : 0;
    }
    if (m.model) lastProvider = m.model;
  }

  return {
    input,
    output,
    total: input + output,
    turns,
    lastThroughput,
    lastLatencyMs,
    lastProvider,
    lastFailed,
  };
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Pulses the "just landed" highlight for a moment after each turn completes. */
const FLASH_MS = 1600;


export function TokenMeter({ messages, isLoading }: TokenMeterProps) {
  const totals = useMemo(() => computeTotals(messages), [messages]);

  // Ticks ~10x/s while a request is in flight so elapsed time advances live.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [flash, setFlash] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const lastTurnCountRef = useRef<number>(totals.turns);

  useEffect(() => {
    if (isLoading) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now();
      setElapsedMs(0);
      const id = setInterval(() => {
        if (startedAtRef.current !== null) setElapsedMs(Date.now() - startedAtRef.current);
      }, 100);
      return () => clearInterval(id);
    }
    startedAtRef.current = null;
    setElapsedMs(0);
    return undefined;
  }, [isLoading]);

  useEffect(() => {
    if (totals.turns > lastTurnCountRef.current) {
      lastTurnCountRef.current = totals.turns;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), FLASH_MS);
      return () => clearTimeout(id);
    }
    lastTurnCountRef.current = totals.turns;
    return undefined;
  }, [totals.turns]);

  // No activity at all yet — stay quiet rather than showing a misleading "0".
  if (totals.turns === 0 && !isLoading) return null;

  const dotClass = isLoading
    ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse'
    : totals.lastFailed
      ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
      : flash
        ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]'
        : 'bg-cyan-400';

  const textClass = isLoading
    ? 'text-amber-300'
    : totals.lastFailed
      ? 'text-rose-300'
      : 'text-cyan-300';

  return (
    <div
      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300 select-none"
      title={
        `Session tokens: ${totals.input} in / ${totals.output} out across ${totals.turns} turn(s)` +
        (totals.lastLatencyMs !== null ? `\nLast turn: ${fmtDuration(totals.lastLatencyMs)}` : '') +
        (totals.lastThroughput !== null ? `\nThroughput: ${totals.lastThroughput.toFixed(1)} out tok/s` : '') +
        (totals.lastProvider ? `\nServed by: ${totals.lastProvider}` : '')
      }
    >
      <Activity className={`w-3 h-3 flex-shrink-0 ${textClass}`} />
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />

      {isLoading ? (
        <span className="tabular-nums">
          thinking <span className="text-amber-200/90">{fmtDuration(elapsedMs)}</span>
        </span>
      ) : (
        <>
          <span className="tabular-nums" data-testid="token-meter-total">
            {fmt(totals.total)}
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-500 tabular-nums">
            <span className="text-cyan-400/80">{fmt(totals.input)}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-emerald-400/80">{fmt(totals.output)}</span>
          </span>
          {totals.lastThroughput !== null && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-500 tabular-nums">
                {totals.lastThroughput.toFixed(0)}
                <span className="text-zinc-600">t/s</span>
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default TokenMeter;
