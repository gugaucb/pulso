import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, CheckCircle2, Clock, Copy, Lock, Share2 } from 'lucide-react';
import type { EphemeralMessage, RoomMode } from '../domain/types';
import { formatRelativeTime, useI18n } from '../i18n';
import { getInitials } from '../utils/formatters';

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

interface MessageListProps {
  roomCode: string;
  roomMode?: RoomMode;
  onionAddress?: string | null;
  isHost: boolean;
  localParticipantId: string;
  messages: EphemeralMessage[];
  typingParticipantName?: string | null;
  copiedCode: boolean;
  copiedLink: boolean;
  copiedOnion?: boolean;
  onCopyCode: () => void;
  onShareLink: () => void;
  onCopyOnion?: () => void;
}

function TypingIndicator({ participantName }: { participantName: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 pt-1"
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-1 rounded-full bg-[#EEF0FF] dark:bg-[#232638] px-2.5 py-1.5"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#5B3DF5] dark:bg-[#818CF8] animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#5B3DF5] dark:bg-[#818CF8] animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#5B3DF5] dark:bg-[#818CF8] animate-bounce [animation-delay:300ms]" />
      </span>
      <span>{t.messages.typingIndicator(participantName)}</span>
    </div>
  );
}

export function MessageList({
  roomCode,
  roomMode = 'normal',
  onionAddress,
  isHost,
  localParticipantId,
  messages,
  typingParticipantName,
  copiedCode,
  copiedLink,
  copiedOnion = false,
  onCopyCode,
  onShareLink,
  onCopyOnion,
}: MessageListProps) {
  const isTorMode = roomMode === 'tor';
  const { locale, t } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  useEffect(() => {
    if (messages.length === 0) {
      isAtBottomRef.current = true;
      setShowScrollToLatest(false);
      return;
    }

    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, typingParticipantName]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = isNearBottom(el);
    isAtBottomRef.current = nearBottom;
    setShowScrollToLatest(!nearBottom);
  };

  const handleScrollToLatest = () => {
    isAtBottomRef.current = true;
    setShowScrollToLatest(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center justify-center gap-4 bg-[#F8F9FC] dark:bg-[#1A1C2A] transition-colors">
        {isHost ? (
          <section className="w-full max-w-md rounded-2xl bg-white dark:bg-[#232638] border border-slate-200/80 dark:border-[#2E3248] shadow-sm p-6 text-center transition-colors">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-[#22C55E]" aria-hidden="true" />
              <span>{t.room.roomCreatedBadge}</span>
            </div>

            <p className="mt-4 font-mono-tabular text-3xl font-bold tracking-widest text-[#111827] dark:text-slate-50">
              {roomCode}
            </p>

            {isTorMode ? (
              <div className="mt-4 rounded-xl border border-purple-200 dark:border-purple-500/35 bg-purple-50/70 dark:bg-purple-500/10 p-3.5 text-left space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-800 dark:text-purple-200">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t.torMode.onionInstructionsTitle}</span>
                  </span>
                </div>
                {onionAddress && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      {t.torMode.onionAddressLabel}
                    </p>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-purple-200/80 dark:border-purple-500/30 bg-white dark:bg-[#141522] px-2.5 py-2">
                      <code className="font-mono-tabular text-xs text-[#111827] dark:text-slate-100 break-all">
                        {onionAddress}
                      </code>
                      {onCopyOnion && (
                        <button
                          type="button"
                          onClick={onCopyOnion}
                          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-[#2E3248] bg-slate-50 dark:bg-[#1B1D2C] hover:bg-slate-100 dark:hover:bg-[#2B2F45] px-2.5 py-1 text-[11px] font-semibold text-[#111827] dark:text-slate-100 transition cursor-pointer"
                        >
                          {copiedOnion ? (
                            <>
                              <Check className="h-3 w-3 text-[#22C55E]" aria-hidden="true" />
                              <span>{t.torMode.onionCopied}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" aria-hidden="true" />
                              <span>{t.torMode.copyOnion}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                  {t.torMode.hostReadyStatus}
                </p>
                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {t.torMode.onionInstructionsBody}
                </p>
              </div>
            ) : (
              <p className="mt-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {t.room.emptyHostInviteHint}
              </p>
            )}

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
          <div className="text-center max-w-md space-y-2.5">
            <p className="text-sm font-semibold text-[#111827] dark:text-slate-100">
              {t.room.connectedToRoom(roomCode)}
            </p>
            {isTorMode && (
              <div className="rounded-xl border border-purple-200 dark:border-purple-500/35 bg-purple-50/70 dark:bg-purple-500/10 px-4 py-3 text-xs text-purple-900 dark:text-purple-100 space-y-1.5">
                <p className="font-medium">{t.torMode.guestReadyStatus}</p>
                {onionAddress && (
                  <p className="font-mono-tabular text-[11px] text-purple-700 dark:text-purple-200 break-all">
                    {onionAddress}
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t.room.emptyGuestHint}
            </p>
          </div>
        )}
        {typingParticipantName && (
          <TypingIndicator participantName={typingParticipantName} />
        )}
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onContextMenu={(event) => event.preventDefault()}
        role="log"
        aria-label={t.messages.listAriaLabel}
        className="flex-1 overflow-y-auto bg-white dark:bg-[#1A1C2A] p-4 sm:p-6 space-y-4 transition-colors select-none"
      >
        {messages.map((message) => {
          const isOwn = message.senderId === localParticipantId;
          const senderLabel = isOwn ? t.room.you : message.senderName;
          const avatarBg = isOwn ? 'bg-[#5B3DF5]' : 'bg-[#6344F5]';
          const bubbleClass = isOwn
            ? 'bg-[#EEF0FF] dark:bg-[#2D2856] text-[#111827] dark:text-[#F5F3FF] border border-[#5B3DF5]/15 dark:border-[#6344F5]/30'
            : 'bg-[#F1F3F8] dark:bg-[#232638] text-[#111827] dark:text-[#F1F5F9] border border-slate-200/70 dark:border-[#2E3248]';

          return (
            <article key={message.id} className="flex items-start gap-3 animate-message-in">
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
                <div
                  onContextMenu={(event) => event.preventDefault()}
                  className={`select-none rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${bubbleClass}`}
                >
                  {message.text}
                </div>
              </div>
            </article>
          );
        })}
        {typingParticipantName && (
          <TypingIndicator participantName={typingParticipantName} />
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollToLatest && (
        <button
          type="button"
          onClick={handleScrollToLatest}
          className="absolute bottom-4 right-4 sm:right-6 z-20 inline-flex items-center gap-1.5 rounded-full bg-[#5B3DF5] hover:bg-[#4E32D9] text-white shadow-lg px-4 py-2 text-xs font-semibold transition cursor-pointer"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t.messages.scrollToLatest}</span>
        </button>
      )}
    </div>
  );
}
