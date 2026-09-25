import React, { useCallback, useRef, useState } from 'react';
import Bubble from '@ant-design/x/es/bubble';
import Sender from '@ant-design/x/es/sender';
import type { BubbleItemType } from '@ant-design/x/es/bubble/interface';
import type { ChatMessage } from './useOrchestatorChat';

// Re-export stub for parallel agent scope
export function AgentBadge() { return null; }

interface ChatMessagesProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
}

// Detect code blocks and render with copy button
function renderContent(content: string) {
  if (!content.includes('```')) {
    return <span className="whitespace-pre-wrap break-words">{content}</span>;
  }

  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3).split('\n');
          const lang = lines[0].trim();
          const code = lines.slice(1, -1).join('\n');
          return <CodeBlock key={i} code={code} lang={lang} />;
        }
        return (
          <span key={i} className="whitespace-pre-wrap break-words">
            {part}
          </span>
        );
      })}
    </>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="relative my-2 rounded-lg overflow-hidden border border-zinc-700">
      <div className="flex items-center justify-between px-3 py-1 bg-zinc-800 text-zinc-400 text-xs font-mono">
        <span>{lang || 'code'}</span>
        <button
          onClick={copy}
          className="hover:text-white transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-zinc-900 p-3 overflow-x-auto text-zinc-200 text-xs font-mono leading-relaxed m-0">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ChatMessages({
  messages,
  isStreaming,
  onSend,
}: ChatMessagesProps) {
  const [inputValue, setInputValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build Ant Design X BubbleList items
  const items: BubbleItemType[] = messages.map((msg) => ({
    key: msg.id,
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.status === 'streaming' && !msg.content ? '…' : msg.content,
    loading: msg.status === 'streaming' && !msg.content,
    placement: msg.role === 'user' ? 'end' : 'start',
    styles: {
      content: msg.role === 'user'
        ? {
            background: '#27272a',
            color: '#f4f4f5',
            borderRadius: '12px 12px 2px 12px',
            fontSize: '13px',
            lineHeight: '1.6',
            maxWidth: '75%',
          }
        : {
            background: '#18181b',
            color: '#d4d4d8',
            borderRadius: '12px 12px 12px 2px',
            fontSize: '13px',
            lineHeight: '1.6',
            maxWidth: '85%',
            border: '1px solid #3f3f46',
          },
    },
    contentRender: msg.status === 'streaming' && !msg.content
      ? undefined
      : (_content: string) => renderContent(msg.content),
  }));

  const handleSubmit = useCallback(
    (val: string) => {
      const trimmed = val.trim();
      if (!trimmed || isStreaming) return;
      setInputValue('');
      onSend(trimmed);
    },
    [isStreaming, onSend],
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            <div className="text-4xl font-bold text-zinc-700">Ω</div>
            <p className="text-sm font-mono text-zinc-500">Message Ultron to begin</p>
          </div>
        ) : (
          <Bubble.List
            items={items}
            style={{ background: 'transparent' }}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Sender bar */}
      <div className="shrink-0 p-3 border-t border-zinc-800 bg-zinc-950">
        {/* Ant Design X Sender */}
        <Sender
          value={inputValue}
          onChange={(v) => setInputValue(v)}
          onSubmit={handleSubmit}
          submitType="enter"
          disabled={isStreaming}
          placeholder="Message Ultron..."
          style={{
            background: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            color: '#f4f4f5',
          }}
        />
        <p className="text-[10px] font-mono text-zinc-700 mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>

      {/* Ant Design X theme overrides */}
      <style>{`
        .ant-sender {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
        .ant-sender-content {
          background: #18181b !important;
          border: 1px solid #3f3f46 !important;
          border-radius: 8px !important;
        }
        .ant-sender textarea {
          background: transparent !important;
          color: #f4f4f5 !important;
          font-size: 13px !important;
        }
        .ant-sender textarea::placeholder {
          color: #71717a !important;
        }
        .ant-sender-actions-btn {
          background: #ffffff !important;
          color: #000000 !important;
          border-radius: 6px !important;
          font-weight: 600 !important;
        }
        .ant-sender-actions-btn:hover {
          background: #e4e4e7 !important;
        }
        .ant-sender-actions-btn:disabled {
          opacity: 0.4 !important;
        }
        .ant-bubble-content {
          word-break: break-word !important;
        }
      `}</style>
    </div>
  );
}
