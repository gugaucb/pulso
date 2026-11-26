import { useEffect, useRef } from 'react';
import { Check, CheckCircle2, Clock, Copy, Share2 } from 'lucide-react';
import type { EphemeralMessage } from '../domain/types';
import { formatRelativeTime, useI18n } from '../i18n';
import { getInitials } from '../utils/formatters';

interface MessageListProps {
  roomCode: string;
  isHost: boolean;
  localParticipantId: string;
  messages: EphemeralMessage[];
  copiedCode: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onShareLink: () => void;
}

export function MessageList({
  roomCode,
  isHost,
  localParticipantId,
  messages,
  copiedCode,
  copiedLink,
  onCopyCode,
  onShareLink,
}: MessageListProps) {
  const { locale, t } = useI18n();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex items-center justify-center bg-[#F8F9FC] dark:bg-[#1A1C2A] transition-colors">
        {isHost ? (
          <section className="w-full max-w-md rounded-2xl bg-white dark:bg-[#232638] border border-slate-200/80 dark:border-[#2E3248] shadow-sm p-6 text-center transition-colors">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-[#22C55E]" aria-hidden="true" />
              <span>{t.room.roomCreatedBadge}</span>
            </div>

            <p className="mt-4 font-mono-tabular text-3xl font-bold tracking-widest text-[#111827] dark:text-slate-50">
              {roomCode}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onCopyCode}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-[#2E3248] bg-white dark:bg-[#1B1D2C] hover:bg-slate-50 dark:hover:bg-[#2B2F45] px-3.5 py-2.5 text-sm font-medium text-[#111827] dark:text-slate-100 transition cursor-pointer"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-4 w-4 text-[#22C55E]" />
                    <span>{t.room.codeCopied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                    <span>{t.room.copyCode}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onShareLink}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-[#2E3248] bg-white dark:bg-[#1B1D2C] hover:bg-slate-50 dark:hover:bg-[#2B2F45] px-3.5 py-2.5 text-sm font-medium text-[#111827] dark:text-slate-100 transition cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-4 w-4 text-[#22C55E]" />
                    <span>{t.room.linkCopied}</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4 text-[#5B3DF5] dark:text-[#818CF8]" />
                    <span>{t.room.share}</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.room.roomExpiresIn1h}</span>
            </div>
          </section>
        ) : (
          <div className="text-center max-w-sm space-y-2">
            <p className="text-sm font-semibold text-[#111827] dark:text-slate-100">
              {t.room.connectedToRoom(roomCode)}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t.room.emptyGuestHint}
            </p>
          </div>
        )}
      </div>
    );
  }

  const now = Date.now();

  return (
    <div
      role="log"
      aria-label={t.messages.listAriaLabel}
      className="flex-1 overflow-y-auto bg-white dark:bg-[#1A1C2A] p-4 sm:p-6 space-y-4 transition-colors"
    >
      {messages.map((message) => {
        const isOwn = message.senderId === localParticipantId;
        const senderLabel = isOwn ? t.room.you : message.senderName;
        const avatarBg = isOwn ? 'bg-[#5B3DF5]' : 'bg-[#6344F5]';
        const bubbleClass = isOwn
          ? 'bg-[#EEF0FF] dark:bg-[#2D2856] text-[#111827] dark:text-[#F5F3FF]'
          : 'bg-[#F1F3F8] dark:bg-[#232638] text-[#111827] dark:text-[#F1F5F9]';

        return (
          <article key={message.id} className="flex items-start gap-3">
            <div
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarBg}`}
              aria-hidden="true"
            >
              {getInitials(isOwn ? senderLabel : message.senderName)}
            </div>
            <div className="min-w-0 max-w-xl">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold text-[#111827] dark:text-slate-100">
                  {senderLabel}
                </span>
                <time
                  dateTime={new Date(message.createdAt).toISOString()}
                  className="text-xs text-slate-500 dark:text-slate-400"
                >
                  {formatRelativeTime(message.createdAt, now, locale)}
                </time>
              </div>
              <div className={`rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${bubbleClass}`}>
                {message.text}
              </div>
            </div>
          </article>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
