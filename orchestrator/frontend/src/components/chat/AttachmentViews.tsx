/**
 * AttachmentViews — Rich multimedia and attachment rendering components for Ultron Chat.
 *
 * Supports:
 * - Audio & Voice Notes: Sleek dark player with waveform visualization and controls
 * - Documents: Cards for PDF, Doc, Sheets, Text with download/open actions
 * - Code Files: Cards with syntax badge, size, view/download actions
 * - Images: Responsive rounded thumbnail with click-to-expand lightbox
 * - Links: Styled clickable pill chips with ExternalLink icons and URL cards
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  File,
  Download,
  ExternalLink,
  Play,
  Pause,
  Volume2,
  Maximize2,
  X,
  Music,
} from 'lucide-react';
import type { FileAttachment } from './useOrchestatorChat';
import { formatFileSize } from './useOrchestatorChat';

export function resolveMediaUrl(url: string): string {
  if (!url) return '';
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return url;
  }
  return `http://localhost:8080${url.startsWith('/') ? '' : '/'}${url}`;
}

// ─── Audio Player with Waveform Aesthetics ───────────────────────────────────

export function AudioAttachmentPlayer({ attachment }: { attachment: FileAttachment }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const mediaUrl = resolveMediaUrl(attachment.url);

  // Deterministic waveform bar heights (28 bars) based on file name
  const waveformHeights = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < attachment.name.length; i++) {
      hash = (hash << 5) - hash + attachment.name.charCodeAt(i);
      hash |= 0;
    }
    const heights: number[] = [];
    for (let i = 0; i < 28; i++) {
      const pseudo = Math.abs(Math.sin((hash + i * 37) * 9301 + 49297));
      heights.push(Math.max(15, Math.floor(pseudo * 85) + 15));
    }
    return heights;
  }, [attachment.name]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const handleSeek = (index: number) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const targetTime = (index / waveformHeights.length) * duration;
    audio.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full max-w-md my-1.5 rounded-xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-950 p-3 shadow-md">
      <audio ref={audioRef} src={mediaUrl} preload="metadata" />

      {/* Header info */}
      <div className="flex items-center justify-between gap-2 mb-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-violet-950/80 border border-violet-700/50 flex items-center justify-center flex-shrink-0 text-violet-400">
            <Music className="w-3.5 h-3.5" />
          </div>
          <span className="font-mono text-zinc-200 text-xs truncate max-w-[200px]" title={attachment.name}>
            {attachment.name}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 flex-shrink-0">
            {formatFileSize(attachment.size)}
          </span>
        </div>
        <a
          href={mediaUrl}
          download={attachment.name}
          className="text-zinc-400 hover:text-white transition-colors p-1 rounded hover:bg-zinc-800"
          title="Download audio"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Waveform and Play/Pause */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="w-9 h-9 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition-transform active:scale-95 flex-shrink-0 shadow-lg shadow-violet-900/30"
          aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>

        {/* Waveform bars */}
        <div className="flex-1 flex items-center gap-[3px] h-8 px-1 cursor-pointer select-none" title="Seek audio">
          {waveformHeights.map((h, i) => {
            const barProgress = (i / waveformHeights.length) * 100;
            const isFilled = barProgress <= progressPct;
            return (
              <div
                key={i}
                onClick={() => handleSeek(i)}
                className={`flex-1 rounded-full transition-all duration-150 ${
                  isFilled
                    ? 'bg-violet-400 shadow-sm shadow-violet-400/40'
                    : 'bg-zinc-700 hover:bg-zinc-500'
                } ${isPlaying && isFilled ? 'opacity-100' : 'opacity-85'}`}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>

        {/* Time counter */}
        <div className="font-mono text-[11px] text-zinc-400 flex-shrink-0 min-w-[55px] text-right">
          {formatTime(currentTime)}
          {duration > 0 && <span className="text-zinc-600"> / {formatTime(duration)}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Document Card ────────────────────────────────────────────────────────────

export function DocumentAttachmentCard({ attachment }: { attachment: FileAttachment }) {
  const mediaUrl = resolveMediaUrl(attachment.url);
  const ext = (attachment.name.split('.').pop() || '').toUpperCase();
  const isSheet = ['CSV', 'XLS', 'XLSX', 'ODS'].includes(ext);

  return (
    <div className="flex items-center justify-between gap-3 max-w-sm my-1.5 p-2.5 rounded-lg border border-zinc-700/80 bg-zinc-900/90 hover:bg-zinc-800/80 transition-colors group">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${
            isSheet
              ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400'
              : 'bg-blue-950/60 border-blue-800/60 text-blue-400'
          }`}
        >
          {isSheet ? <FileSpreadsheet className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-mono text-zinc-200 truncate group-hover:text-white" title={attachment.name}>
            {attachment.name}
          </p>
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 mt-0.5">
            <span className="px-1 py-0.2 rounded bg-zinc-800 text-zinc-300 font-bold text-[9px]">{ext}</span>
            <span>{formatFileSize(attachment.size)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href={mediaUrl}
          download={attachment.name}
          className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Download document"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

// ─── Code Card ────────────────────────────────────────────────────────────────

export function CodeAttachmentCard({ attachment }: { attachment: FileAttachment }) {
  const mediaUrl = resolveMediaUrl(attachment.url);
  const ext = (attachment.name.split('.').pop() || 'CODE').toUpperCase();

  return (
    <div className="flex items-center justify-between gap-3 max-w-sm my-1.5 p-2.5 rounded-lg border border-amber-900/50 bg-amber-950/20 hover:bg-amber-950/30 transition-colors group">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-amber-950/80 border border-amber-700/60 flex items-center justify-center flex-shrink-0 text-amber-400">
          <FileCode className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-mono text-amber-200 truncate group-hover:text-amber-100" title={attachment.name}>
            {attachment.name}
          </p>
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400 mt-0.5">
            <span className="px-1 py-0.2 rounded bg-amber-900/60 text-amber-300 font-bold text-[9px]">{ext}</span>
            <span>{formatFileSize(attachment.size)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
          title="View code"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href={mediaUrl}
          download={attachment.name}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Download code"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

// ─── Image Preview with Lightbox ──────────────────────────────────────────────

export function ImageAttachmentPreview({ attachment }: { attachment: FileAttachment }) {
  const [isOpen, setIsOpen] = useState(false);
  const mediaUrl = resolveMediaUrl(attachment.url);

  return (
    <>
      <div className="relative group max-w-xs my-1.5 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900 cursor-pointer shadow">
        <img
          src={mediaUrl}
          alt={attachment.name}
          className="max-h-56 w-auto object-cover rounded-lg transition-transform duration-200 group-hover:scale-[1.02]"
          onClick={() => setIsOpen(true)}
          loading="lazy"
        />
        <div
          onClick={() => setIsOpen(true)}
          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
        >
          <span className="p-1.5 rounded-full bg-zinc-900/80 text-white backdrop-blur-sm">
            <Maximize2 className="w-4 h-4" />
          </span>
          <a
            href={mediaUrl}
            download={attachment.name}
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-full bg-zinc-900/80 text-white backdrop-blur-sm hover:bg-zinc-800"
            title="Download image"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
        <div className="p-1.5 px-2 bg-zinc-900/90 border-t border-zinc-800 flex items-center justify-between text-[10px] font-mono text-zinc-400">
          <span className="truncate max-w-[180px]">{attachment.name}</span>
          <span>{formatFileSize(attachment.size)}</span>
        </div>
      </div>

      {/* Lightbox Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between pb-2 text-xs font-mono text-zinc-300">
              <span className="truncate">{attachment.name}</span>
              <div className="flex items-center gap-2">
                <a
                  href={mediaUrl}
                  download={attachment.name}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img
              src={mediaUrl}
              alt={attachment.name}
              className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl border border-zinc-800"
            />
          </div>
        </div>
      )}
    </>
  );
}

// ─── Generic / Other File Card ────────────────────────────────────────────────

export function GenericAttachmentCard({ attachment }: { attachment: FileAttachment }) {
  const mediaUrl = resolveMediaUrl(attachment.url);

  return (
    <div className="flex items-center justify-between gap-3 max-w-sm my-1.5 p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-800/70 transition-colors group">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-300">
          <File className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-mono text-zinc-200 truncate group-hover:text-white" title={attachment.name}>
            {attachment.name}
          </p>
          <span className="text-[10px] font-mono text-zinc-500 mt-0.5 block">
            {formatFileSize(attachment.size)}
          </span>
        </div>
      </div>

      <a
        href={mediaUrl}
        download={attachment.name}
        className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors flex-shrink-0"
        title="Download file"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

// ─── Attachment List ──────────────────────────────────────────────────────────

export function AttachmentList({ attachments }: { attachments?: FileAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 my-1.5">
      {attachments.map((att) => {
        switch (att.category) {
          case 'audio':
            return <AudioAttachmentPlayer key={att.id} attachment={att} />;
          case 'document':
            return <DocumentAttachmentCard key={att.id} attachment={att} />;
          case 'code':
            return <CodeAttachmentCard key={att.id} attachment={att} />;
          case 'image':
            return <ImageAttachmentPreview key={att.id} attachment={att} />;
          default:
            return <GenericAttachmentCard key={att.id} attachment={att} />;
        }
      })}
    </div>
  );
}

// ─── Regex URL Parser & Clickable Link Pill ───────────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s<>"'()[\]{}]+)/g;

function truncateUrl(url: string, maxLen = 32): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname;
    const full = domain + (path !== '/' ? path : '');
    return full.length > maxLen ? full.slice(0, maxLen - 1) + '…' : full;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 1) + '…' : url;
  }
}

export function RichTextWithLinks({ text }: { text: string }) {
  if (!text) return null;

  // Split text by URLs
  const parts = text.split(URL_REGEX);

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (part.match(/^https?:\/\//i)) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-full bg-blue-950/80 border border-blue-700/60 text-blue-300 hover:text-blue-100 hover:bg-blue-900 transition-colors text-xs font-mono select-all align-middle"
              title={part}
            >
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              <span>{truncateUrl(part)}</span>
            </a>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </span>
  );
}

// ─── URL Link Card ────────────────────────────────────────────────────────────

export function LinkPreviewCard({ url }: { url: string }) {
  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    domain = url;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 max-w-sm my-1.5 p-2 rounded-lg border border-blue-900/40 bg-blue-950/20 hover:bg-blue-950/40 transition-colors group text-xs font-mono"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-md bg-blue-950 border border-blue-700/50 flex items-center justify-center flex-shrink-0 text-blue-400">
          <ExternalLink className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <span className="font-semibold text-blue-300 truncate block group-hover:text-blue-200">
            {domain}
          </span>
          <span className="text-zinc-500 text-[10px] truncate block max-w-[200px]">
            {url}
          </span>
        </div>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 flex-shrink-0 mr-1" />
    </a>
  );
}
