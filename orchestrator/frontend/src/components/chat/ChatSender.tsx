/**
 * ChatSender — Enhanced Multi-Modal Sender Bar.
 *
 * Implements:
 * - Paperclip file attachment button & staging tray (audio, docs, code, images)
 * - Microphone voice note recording button with active duration timer
 * - Clean auto-expanding textarea (Enter to send, Shift+Enter for newline)
 * - Stop Generation button when isLoading is true
 * - Keyboard shortcut hint
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  MicOff,
  Square,
  X,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  File,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  FileAttachment,
  detectAttachmentCategory,
  formatFileSize,
} from './useOrchestatorChat';

export interface ChatSenderProps {
  isLoading: boolean;
  onSend: (text: string, attachments?: FileAttachment[]) => Promise<void> | void;
  onStop: () => void;
  placeholder?: string;
  initialValue?: string;
}

function getAttachmentCategoryIcon(category: FileAttachment['category']) {
  switch (category) {
    case 'audio': return <FileAudio className="w-3.5 h-3.5 text-pink-400" />;
    case 'code': return <FileCode className="w-3.5 h-3.5 text-cyan-400" />;
    case 'image': return <FileImage className="w-3.5 h-3.5 text-emerald-400" />;
    case 'document': return <FileText className="w-3.5 h-3.5 text-amber-400" />;
    default: return <File className="w-3.5 h-3.5 text-zinc-400" />;
  }
}

export function ChatSender({
  isLoading,
  onSend,
  onStop,
  placeholder = 'Message Ultron or dispatch multi-agent tasks...',
  initialValue = '',
}: ChatSenderProps) {
  const [text, setText] = useState(initialValue);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Sync initialValue if provided externally
  useEffect(() => {
    if (initialValue) {
      setText(initialValue);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [initialValue]);

  // Adjust textarea height dynamically
  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    adjustHeight();
  };

  // Submit message
  const handleSubmit = async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;

    const currentText = trimmed;
    const currentAttachments = [...attachments];

    // Clear input & staging
    setText('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await onSend(currentText, currentAttachments.length > 0 ? currentAttachments : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // ─── File Upload Handler ───────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: FileAttachment[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).slice(2, 9),
      name: file.name,
      url: URL.createObjectURL(file),
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      category: detectAttachmentCategory(file.type, file.name),
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);
    // Reset file input value so user can upload the same file again if desired
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // ─── Microphone Voice Recording ────────────────────────────────────────────

  const startRecording = () => {
    setIsRecording(true);
    setRecordSeconds(0);
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);

    // Initialize Web Speech Recognition if available
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript) {
            setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
            adjustHeight();
          }
        };

        recognition.onerror = () => {
          stopRecording();
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        // Fallback to timer recording mode
      }
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const formatRecordTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isLoading;

  return (
    <div className="p-3 border-t border-zinc-800 bg-zinc-950 select-none">
      {/* Attached Files Staging Tray */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2.5 px-1">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700/80 text-xs font-mono text-zinc-200 shadow-sm animate-in fade-in"
            >
              {getAttachmentCategoryIcon(file.category)}
              <span className="truncate max-w-[150px]">{file.name}</span>
              <span className="text-[10px] text-zinc-500">{formatFileSize(file.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(file.id)}
                className="p-0.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors ml-1"
                title="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Voice Recording Active Bar */}
      {isRecording && (
        <div className="flex items-center justify-between px-3 py-1.5 mb-2 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs font-mono text-rose-300 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span className="font-semibold">Recording voice note...</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular-nums font-mono">{formatRecordTime(recordSeconds)}</span>
            <button
              type="button"
              onClick={stopRecording}
              className="px-2 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-white text-[11px] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Sender Box */}
      <div className="relative flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/90 focus-within:border-zinc-600 transition-colors shadow-inner">
        {/* Text Input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? 'Listening to speech...' : placeholder}
          disabled={isLoading}
          rows={1}
          className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm text-white placeholder-zinc-500 outline-none leading-relaxed disabled:opacity-50"
          style={{ minHeight: '44px', maxHeight: '160px' }}
        />

        {/* Action Controls Bar */}
        <div className="flex items-center justify-between px-2.5 pb-2 pt-1 border-t border-zinc-800/40">
          {/* Left: Attachments & Mic */}
          <div className="flex items-center gap-1">
            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,audio/*,.pdf,.doc,.docx,.txt,.csv,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.sh"
            />

            {/* Paperclip Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
              title="Attach files (images, audio, documents, code)"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Mic Voice Note Button */}
            <button
              type="button"
              onClick={toggleRecording}
              disabled={isLoading}
              className={`p-1.5 rounded-lg transition-colors ${
                isRecording
                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              } disabled:opacity-40`}
              title={isRecording ? 'Stop voice recording' : 'Record voice note'}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          {/* Right: Stop or Send Button */}
          <div className="flex items-center gap-2">
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-mono font-medium transition-colors shadow-sm"
                title="Stop Ultron generation"
              >
                <Square className="w-3.5 h-3.5 fill-current text-rose-400" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSend}
                className={`flex items-center justify-center w-8 h-8 rounded-lg font-bold transition-all duration-150 ${
                  canSend
                    ? 'bg-white text-black hover:bg-zinc-200 shadow-md hover:scale-105 active:scale-95'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50'
                }`}
                aria-label="Send message"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Helper Shortcut Hint */}
      <div className="flex items-center justify-between px-1 mt-1.5 text-[10px] font-mono text-zinc-600">
        <span>Enter to send · Shift+Enter for newline</span>
        <span className="hidden sm:inline">Ultron Swarm v2.0</span>
      </div>
    </div>
  );
}

export default ChatSender;
