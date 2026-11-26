import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

interface MessageComposerProps {
  onSendMessage: (text: string) => Promise<void>;
}

export function MessageComposer({ onSendMessage }: MessageComposerProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const submitCurrentDraft = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setDraft('');
    try {
      await onSendMessage(trimmed);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submitCurrentDraft();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentDraft();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 bg-white border-t border-slate-200 px-4 sm:px-6 py-3.5"
    >
      <div className="flex items-end gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 focus-within:border-[#5B3DF5] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#5B3DF5]/15 transition">
        <textarea
          aria-label="Mensagem efêmera"
          rows={1}
          placeholder="Digite uma mensagem..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none bg-transparent py-1.5 text-sm text-[#111827] placeholder:text-slate-400 focus:outline-none max-h-32"
        />
        <button
          type="submit"
          aria-label="Enviar mensagem"
          disabled={!draft.trim() || sending}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] disabled:opacity-40 text-white transition cursor-pointer"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
