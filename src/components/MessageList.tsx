import { useEffect, useRef } from 'react';
import { Check, CheckCircle2, Clock, Copy, Share2 } from 'lucide-react';
import type { EphemeralMessage } from '../domain/types';
import { formatRelativeTime, getInitials } from '../utils/formatters';

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
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex items-center justify-center bg-[#F8F9FC]">
        {isHost ? (
          <section className="w-full max-w-md rounded-2xl bg-white border border-slate-200/80 shadow-sm p-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 text-[#22C55E]" aria-hidden="true" />
              <span>Sua sala foi criada!</span>
            </div>

            <p className="mt-4 font-mono-tabular text-3xl font-bold tracking-widest text-[#111827]">
              {roomCode}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onCopyCode}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-[#111827] transition cursor-pointer"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-4 w-4 text-[#22C55E]" />
                    <span>Código copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-slate-500" />
                    <span>Copiar código</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onShareLink}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-[#111827] transition cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-4 w-4 text-[#22C55E]" />
                    <span>Link copiado!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4 text-[#5B3DF5]" />
                    <span>Compartilhar</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>A sala expira em 1h</span>
            </div>
          </section>
        ) : (
          <div className="text-center max-w-sm space-y-2">
            <p className="text-sm font-semibold text-[#111827]">
              Conectado à sala {roomCode}
            </p>
            <p className="text-xs text-slate-500">
              Envie a primeira mensagem efêmera abaixo. Nada é salvo em servidor ou navegador.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="Mensagens efêmeras"
      className="flex-1 overflow-y-auto bg-white p-4 sm:p-6 space-y-4"
    >
      {messages.map((message) => {
        const isOwn = message.senderId === localParticipantId;
        const senderLabel = isOwn ? 'Você' : message.senderName;
        const avatarBg = isOwn ? 'bg-[#5B3DF5]' : 'bg-[#6344F5]';
        const bubbleClass = isOwn
          ? 'bg-[#EEF0FF] text-[#111827]'
          : 'bg-[#F1F3F8] text-[#111827]';

        return (
          <article key={message.id} className="flex items-start gap-3">
            <div
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarBg}`}
              aria-hidden="true"
            >
              {getInitials(senderLabel)}
            </div>
            <div className="min-w-0 max-w-xl">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold text-[#111827]">
                  {senderLabel}
                </span>
                <time
                  dateTime={new Date(message.createdAt).toISOString()}
                  className="text-xs text-slate-400"
                >
                  {formatRelativeTime(message.createdAt)}
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
