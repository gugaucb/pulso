import { Clock, Copy, Check, Link2, LogOut } from 'lucide-react';
import type { Participant } from '../domain/types';
import { getInitials } from '../utils/formatters';
import { PulsoLogo } from './PulsoLogo';

interface RoomSidebarProps {
  roomCode: string;
  localParticipant: Participant;
  participants: Participant[];
  copiedCode: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onLeaveRoom: () => void;
}

export function RoomSidebar({
  roomCode,
  localParticipant,
  participants,
  copiedCode,
  copiedLink,
  onCopyCode,
  onCopyLink,
  onLeaveRoom,
}: RoomSidebarProps) {
  const onlineCount = participants.filter((p) => p.online).length;
  const onlineText = onlineCount === 1 ? '1 pessoa online' : `${onlineCount} pessoas online`;

  return (
    <aside
      aria-label="Barra lateral da sala"
      className="hidden md:flex md:w-64 md:shrink-0 flex-col justify-between bg-[#141522] text-slate-200 border-r border-slate-800/80 p-5 select-none"
    >
      <div className="space-y-6">
        <div>
          <PulsoLogo variant="dark" size="sm" />
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Sala atual
          </p>
          <div className="flex items-center justify-between rounded-xl bg-[#1B1D2C] border border-slate-700/60 px-3.5 py-2.5">
            <span className="font-mono-tabular text-sm font-semibold tracking-wider text-white">
              {roomCode}
            </span>
            <button
              type="button"
              onClick={onCopyCode}
              aria-label="Copiar código da sala"
              title="Copiar código"
              className="text-slate-400 hover:text-white transition cursor-pointer"
            >
              {copiedCode ? (
                <Check className="h-4 w-4 text-[#22C55E]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" aria-hidden="true" />
            <span>{onlineText}</span>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
            Participantes
          </p>
          <ul className="space-y-2">
            {participants.map((participant) => {
              const isSelf = participant.id === localParticipant.id;
              const label = isSelf
                ? participant.displayName !== 'Visitante'
                  ? `Você (${participant.displayName})`
                  : 'Você'
                : participant.displayName;
              const avatarBg = isSelf ? 'bg-[#3B82F6]' : 'bg-[#6344F5]';

              return (
                <li
                  key={participant.id}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-100"
                >
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarBg}`}
                    aria-hidden="true"
                  >
                    {getInitials(isSelf ? participant.displayName : participant.displayName)}
                  </span>
                  <span className="truncate font-medium">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Sobre a sala
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-300 px-1">
            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>Expira em 1h</span>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800/80 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 px-1">
          Atalhos
        </p>
        <button
          type="button"
          onClick={onCopyLink}
          className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-[#1B1D2C] hover:text-white transition cursor-pointer"
        >
          {copiedLink ? (
            <Check className="h-4 w-4 text-[#22C55E]" />
          ) : (
            <Link2 className="h-4 w-4 text-slate-400" />
          )}
          <span>{copiedLink ? 'Link copiado!' : 'Copiar link'}</span>
        </button>
        <button
          type="button"
          onClick={onLeaveRoom}
          className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-red-500/10 hover:text-red-300 transition cursor-pointer"
        >
          <LogOut className="h-4 w-4 text-slate-400" />
          <span>Sair da sala</span>
        </button>
      </div>
    </aside>
  );
}
