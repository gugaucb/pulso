import { Check, Copy, Link2, LogOut } from 'lucide-react';
import type { Participant } from '../domain/types';

interface RoomHeaderProps {
  roomCode: string;
  participants: Participant[];
  copiedCode: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onLeaveRoom: () => void;
}

export function RoomHeader({
  roomCode,
  participants,
  copiedCode,
  copiedLink,
  onCopyCode,
  onCopyLink,
  onLeaveRoom,
}: RoomHeaderProps) {
  const peerPresent = participants.length >= 2;
  const presenceLabel = peerPresent ? '2 pessoas online' : 'Aguardando alguém…';

  return (
    <header className="shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-mono-tabular text-base sm:text-lg font-bold tracking-wider text-[#111827]">
            {roomCode}
          </h1>
          <button
            type="button"
            onClick={onCopyCode}
            aria-label="Copiar código no cabeçalho"
            title="Copiar código"
            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#111827] transition cursor-pointer"
          >
            {copiedCode ? (
              <Check className="h-4 w-4 text-[#22C55E]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-0.5">
          <span
            className={`h-2 w-2 rounded-full ${peerPresent ? 'bg-[#22C55E]' : 'bg-amber-400'}`}
            aria-hidden="true"
          />
          <span>{presenceLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition cursor-pointer"
        >
          {copiedLink ? (
            <Check className="h-3.5 w-3.5 text-[#22C55E]" />
          ) : (
            <Link2 className="h-3.5 w-3.5 text-[#5B3DF5]" />
          )}
          <span className="hidden sm:inline">{copiedLink ? 'Link copiado!' : 'Copiar link'}</span>
        </button>

        <button
          type="button"
          onClick={onLeaveRoom}
          aria-label="Sair da sala"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700 px-3 py-1.5 text-xs font-medium text-slate-700 transition cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  );
}
