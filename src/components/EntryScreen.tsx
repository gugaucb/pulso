import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, PlusCircle } from 'lucide-react';
import { formatRoomCode, isValidRoomCode, normalizeRoomCode } from '../domain/roomCode';
import type { ConnectionStatus, RoomErrorCode } from '../domain/types';
import { PulsoLogo } from './PulsoLogo';

interface EntryScreenProps {
  status: ConnectionStatus;
  errorCode: RoomErrorCode | null;
  onCreateRoom: (displayName: string) => Promise<void>;
  onJoinRoom: (roomCode: string, displayName: string) => Promise<void>;
  onClearError: () => void;
}

const ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  invalid_code: 'Código da sala inválido. Verifique os 8 caracteres (ex.: A7K9-M2P4).',
  room_not_found: 'Sala não encontrada ou já expirada.',
  room_full: 'Esta sala 1:1 já está ocupada por 2 participantes.',
  room_expired: 'Esta sala expirou ou foi encerrada pelo anfitrião.',
  transport_error: 'Não foi possível conectar à sala. Tente novamente.',
};

export function EntryScreen({
  status,
  errorCode,
  onCreateRoom,
  onJoinRoom,
  onClearError,
}: EntryScreenProps) {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [touched, setTouched] = useState(false);

  const isConnecting = status === 'connecting';
  const normalizedLength = normalizeRoomCode(roomCodeInput).length;
  const hasInvalidFormat =
    touched && normalizedLength > 0 && !isValidRoomCode(roomCodeInput);

  const visibleError =
    errorCode !== null
      ? ERROR_MESSAGES[errorCode]
      : hasInvalidFormat
        ? ERROR_MESSAGES.invalid_code
        : null;

  const handleRoomCodeChange = (value: string) => {
    setRoomCodeInput(formatRoomCode(value));
    if (errorCode) {
      onClearError();
    }
  };

  const handleJoinSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    await onJoinRoom(roomCodeInput, displayName);
  };

  const handleCreateClick = async () => {
    onClearError();
    await onCreateRoom(displayName);
  };

  return (
    <main className="min-h-screen bg-[#F8F9FC] flex items-center justify-center p-4">
      <section className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200/80 p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <PulsoLogo variant="light" size="md" />
          <h1 className="mt-5 text-2xl font-bold text-[#111827] tracking-tight">
            Entre ou crie uma sala
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Converse e faça chamadas de vídeo com quem você quiser. Sem cadastro.
          </p>
        </div>

        <form onSubmit={handleJoinSubmit} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="room-code-input"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Código da sala
            </label>
            <input
              id="room-code-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={9}
              placeholder="Ex.: A7K9-M2P4"
              value={roomCodeInput}
              onChange={(e) => handleRoomCodeChange(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={isConnecting}
              aria-invalid={visibleError ? 'true' : 'false'}
              className="w-full rounded-xl border border-slate-300 bg-slate-50/70 px-4 py-3 text-center font-mono-tabular text-base tracking-wider text-[#111827] placeholder:text-slate-400 focus:border-[#5B3DF5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#5B3DF5]/20 transition"
            />
          </div>

          <div>
            <label
              htmlFor="display-name-input"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Seu nome (opcional)
            </label>
            <input
              id="display-name-input"
              type="text"
              autoComplete="off"
              maxLength={32}
              placeholder="Visitante"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isConnecting}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-[#111827] placeholder:text-slate-400 focus:border-[#5B3DF5] focus:outline-none focus:ring-2 focus:ring-[#5B3DF5]/20 transition"
            />
          </div>

          {visibleError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
              <span>{visibleError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] active:bg-[#4328C4] disabled:opacity-60 px-4 py-3 text-sm font-semibold text-white shadow-sm transition cursor-pointer"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Conectando…</span>
              </>
            ) : (
              <span>Entrar na sala</span>
            )}
          </button>
        </form>

        <div className="relative my-5 flex items-center justify-center">
          <div className="w-full border-t border-slate-200" />
          <span className="bg-white px-3 text-xs font-medium text-slate-400">
            ou
          </span>
        </div>

        <button
          type="button"
          onClick={handleCreateClick}
          disabled={isConnecting}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 px-4 py-3 text-sm font-semibold text-[#111827] transition cursor-pointer"
        >
          <PlusCircle className="h-4 w-4 text-[#5B3DF5]" />
          <span>Criar nova sala</span>
        </button>
      </section>
    </main>
  );
}
