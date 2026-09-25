/**
 * MessageBubble — Ant Design X style conversation bubbles with Action Toolbar.
 *
 * Implements:
 * - User message: Sleek dark rounded bubble with user badge, timestamp, and staged file cards
 * - Ultron message: Glowing Ω avatar, high-contrast typography, markdown & code blocks with 1-click Copy
 * - Action Toolbar below Ultron messages:
 *   - Copy full response button
 *   - Thumbs up / Thumbs down feedback (wires to /api/feedback)
 *   - Retry / Regenerate button
 *   - Token & latency metadata pill
 */

import React, { useState } from 'react';
import {
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Sparkles,
  FileText,
  FileCode,
  FileAudio,
  FileImage,
  File,
  Clock,
  User,
  Zap,
} from 'lucide-react';
import type { ChatMessage, FileAttachment } from './useOrchestatorChat';
import { UltronIcon } from './UltronIcon';

export interface MessageBubbleProps {
  msg: ChatMessage;
  onRegenerate?: (messageId: string) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void;
}

// ─── Code Block with 1-Click Copy ─────────────────────────────────────────────

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2.5 rounded-lg border border-zinc-700/80 bg-zinc-950 overflow-hidden shadow-md">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px] font-mono text-zinc-400 select-none">
        <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
          <FileCode className="w-3.5 h-3.5 text-cyan-400" />
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content */}
      <pre className="p-3.5 overflow-x-auto text-zinc-200 text-xs font-mono leading-relaxed m-0 selection:bg-zinc-800">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

function renderMarkdown(content: string) {
  if (!content) return null;

  // Split into code blocks and normal text blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).trim().split('\n');
          const lang = lines[0].trim();
          const code = lines.slice(1).join('\n');
          return <CodeBlock key={i} code={code} lang={lang} />;
        }

        // Render plain text with basic markdown formatting (headers, bold, lists, inline code)
        const lines = part.split('\n');
        return (
          <div key={i} className="space-y-1.5">
            {lines.map((line, lineIdx) => {
              if (!line.trim()) return <div key={lineIdx} className="h-1.5" />;

              // Headers
              if (line.startsWith('### ')) {
                return (
                  <h4 key={lineIdx} className="text-sm font-bold text-white tracking-wide mt-2">
                    {line.slice(4)}
                  </h4>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h3 key={lineIdx} className="text-base font-bold text-white tracking-wide mt-3 pb-1 border-b border-zinc-800">
                    {line.slice(3)}
                  </h3>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h2 key={lineIdx} className="text-lg font-bold text-white tracking-wide mt-3 pb-1 border-b border-zinc-800">
                    {line.slice(2)}
                  </h2>
                );
              }

              // Bullet points
              if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
                const bulletText = line.trim().slice(2);
                return (
                  <div key={lineIdx} className="flex items-start gap-2 text-zinc-200 pl-2">
                    <span className="text-cyan-400 font-bold leading-normal">•</span>
                    <span className="flex-1">{formatInline(bulletText)}</span>
                  </div>
                );
              }

              // Numbered list
              const numMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
              if (numMatch) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2 text-zinc-200 pl-2">
                    <span className="text-cyan-400 font-mono text-xs font-semibold">{numMatch[1]}.</span>
                    <span className="flex-1">{formatInline(numMatch[2])}</span>
                  </div>
                );
              }

              return (
                <p key={lineIdx} className="text-zinc-200 leading-relaxed break-words">
                  {formatInline(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function formatInline(text: string): React.ReactNode {
  // Inline code `...`
  const codeParts = text.split(/(`[^`]+`)/g);
  return codeParts.map((sub, idx) => {
    if (sub.startsWith('`') && sub.endsWith('`')) {
      return (
        <code
          key={idx}
          className="mx-1 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-cyan-300 font-mono text-xs"
        >
          {sub.slice(1, -1)}
        </code>
      );
    }
    // Bold **...**
    const boldParts = sub.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((b, bIdx) => {
      if (b.startsWith('**') && b.endsWith('**')) {
        return (
          <strong key={bIdx} className="font-semibold text-white">
            {b.slice(2, -2)}
          </strong>
        );
      }
      return b;
    });
  });
}

// ─── Attachment Chip ─────────────────────────────────────────────────────────

function getAttachmentIcon(category: FileAttachment['category']) {
  switch (category) {
    case 'audio': return <FileAudio className="w-3.5 h-3.5 text-pink-400" />;
    case 'code': return <FileCode className="w-3.5 h-3.5 text-cyan-400" />;
    case 'image': return <FileImage className="w-3.5 h-3.5 text-emerald-400" />;
    case 'document': return <FileText className="w-3.5 h-3.5 text-amber-400" />;
    default: return <File className="w-3.5 h-3.5 text-zinc-400" />;
  }
}

function AttachmentTray({ attachments }: { attachments: FileAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/90 border border-zinc-700 text-xs font-mono text-zinc-300"
        >
          {getAttachmentIcon(att.category)}
          <span className="truncate max-w-[140px]">{att.name}</span>
          <span className="text-[10px] text-zinc-500">
            {att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main MessageBubble ───────────────────────────────────────────────────────

export function MessageBubble({ msg, onRegenerate, onFeedback }: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const isError = msg.status === 'error';

  const [copiedResponse, setCopiedResponse] = useState(false);

  const handleCopyFull = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  const handleRating = (rating: 'up' | 'down') => {
    onFeedback?.(msg.id, rating);
  };

  const formattedTime = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`group flex gap-3 my-3 animate-in fade-in duration-200 ${
        isUser ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      {/* Avatar */}
      {isUser ? (
        <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-300 shadow-sm">
          <User className="w-3.5 h-3.5" />
        </div>
      ) : (
        <div className="relative flex-shrink-0">
          <UltronIcon size="sm" pulse={msg.status === 'streaming'} status={msg.status === 'streaming' ? 'busy' : 'online'} />
        </div>
      )}

      {/* Message Content & Action Toolbar */}
      <div className={`flex flex-col gap-1 max-w-[85%] sm:max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Header line: Role Label + Timestamp */}
        <div className="flex items-center gap-2 px-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
          <span className={isUser ? 'text-zinc-400' : 'text-cyan-400 font-semibold'}>
            {isUser ? 'YOU' : 'ULTRON'}
          </span>
          <span>·</span>
          <span>{formattedTime}</span>
        </div>

        {/* Message Bubble Card */}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-zinc-800/90 border border-zinc-700/80 text-zinc-100 rounded-tr-sm shadow-sm'
              : isError
                ? 'bg-rose-950/40 border border-rose-900/80 text-rose-200 rounded-tl-sm shadow-sm'
                : 'bg-zinc-900/90 border border-zinc-800/90 text-zinc-100 rounded-tl-sm shadow-md'
          }`}
        >
          {/* User Attachments (if any) */}
          {isUser && msg.attachments && msg.attachments.length > 0 && (
            <AttachmentTray attachments={msg.attachments} />
          )}

          {/* Body */}
          {isUser ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed text-zinc-100 font-normal">
              {msg.content}
            </p>
          ) : (
            renderMarkdown(msg.content)
          )}
        </div>

        {/* Action Toolbar for Ultron messages */}
        {isAssistant && (
          <div className="flex items-center gap-1.5 mt-1 px-1 text-xs text-zinc-500 font-mono select-none flex-wrap">
            {/* 1-Click Copy Full Response */}
            <button
              type="button"
              onClick={handleCopyFull}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-900 hover:text-zinc-300 transition-colors"
              title="Copy response to clipboard"
            >
              {copiedResponse ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span className="text-[10px]">Copy</span>
                </>
              )}
            </button>

            {/* Thumbs Up Button */}
            <button
              type="button"
              onClick={() => handleRating('up')}
              className={`p-1 rounded hover:bg-zinc-900 transition-colors ${
                msg.feedback === 'up' ? 'text-emerald-400 bg-emerald-950/40' : 'hover:text-zinc-300'
              }`}
              title="Good response"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>

            {/* Thumbs Down Button */}
            <button
              type="button"
              onClick={() => handleRating('down')}
              className={`p-1 rounded hover:bg-zinc-900 transition-colors ${
                msg.feedback === 'down' ? 'text-rose-400 bg-rose-950/40' : 'hover:text-zinc-300'
              }`}
              title="Poor response"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>

            {/* Regenerate Button */}
            {onRegenerate && (
              <button
                type="button"
                onClick={() => onRegenerate(msg.id)}
                className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-zinc-900 hover:text-zinc-300 transition-colors"
                title="Regenerate this response"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="text-[10px]">Retry</span>
              </button>
            )}

            {/* Metadata Pill: Tokens & Latency */}
            {(msg.usage || msg.latencyMs != null) && (
              <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500 tabular-nums">
                <Clock className="w-2.5 h-2.5 text-zinc-600" />
                {msg.latencyMs != null && (
                  <span>
                    {msg.latencyMs < 1000 ? `${msg.latencyMs}ms` : `${(msg.latencyMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                {msg.usage && (
                  <>
                    <span>·</span>
                    <span>
                      {(msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0)} toks
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
