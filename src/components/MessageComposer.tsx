import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Paperclip, Send, Smile } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';
import { useI18n } from '../i18n';

const COMMON_EMOJIS = ['😀', '😂', '👍', '❤️', '🙏', '🔥', '🎉', '👌', '🤔', '😅', '🚀', '🔒'] as const;

interface MessageComposerProps {
  onSendMessage: (text: string) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
}

export function MessageComposer({ onSendMessage, onTypingChange }: MessageComposerProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachmentNoticeOpen, setAttachmentNoticeOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const controlsContainerRef = useRef<HTMLDivElement | null>(null);

  useDismissable(emojiOpen || attachmentNoticeOpen, controlsContainerRef, () => {
    setEmojiOpen(false);
    setAttachmentNoticeOpen(false);
  });

  const submitCurrentDraft = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setDraft('');
    setEmojiOpen(false);
    setAttachmentNoticeOpen(false);
    onTypingChange?.(false);
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

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? draft.length;
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;

    setDraft(nextDraft);
    onTypingChange?.(nextDraft.trim().length > 0);
    setEmojiOpen(false);

    if (textarea) {
      textarea.focus();
      const nextCaret = start + emoji.length;
      requestAnimationFrame(() => {
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="pulso-print-hide shrink-0 bg-white dark:bg-[#1A1C2A] border-t border-slate-200 dark:border-[#2A2D42] px-3 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:py-3.5 transition-colors"
    >
      <div
        ref={controlsContainerRef}
        className="relative flex items-end gap-1.5 rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#232638] px-3.5 py-2 focus-within:border-[#5B3DF5] dark:focus-within:border-[#6344F5] focus-within:bg-white dark:focus-within:bg-[#25283D] focus-within:ring-2 focus-within:ring-[#5B3DF5]/15 transition"
      >
        <textarea
          ref={textareaRef}
          aria-label={t.messages.composerAriaLabel}
          rows={1}
          placeholder={t.messages.composerPlaceholder}
          value={draft}
          onChange={(e) => {
            const nextValue = e.target.value;
            setDraft(nextValue);
            onTypingChange?.(nextValue.trim().length > 0);
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none bg-transparent py-1.5 text-sm text-[#111827] dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:outline-none max-h-32"
        />

        {attachmentNoticeOpen && (
          <div
            role="dialog"
            aria-label={t.messages.attachmentLabel}
            className="absolute bottom-full right-14 mb-2 w-72 rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] shadow-xl p-3.5 text-xs z-30"
          >
            <p className="font-semibold text-[#111827] dark:text-slate-100">
              {t.messages.attachmentLabel}
            </p>
            <p className="mt-1 text-slate-600 dark:text-slate-300 leading-relaxed">
              {t.messages.attachmentEphemeralNotice}
            </p>
          </div>
        )}

        {emojiOpen && (
          <div
            role="dialog"
            aria-label={t.messages.emojiPickerLabel}
            className="absolute bottom-full right-10 mb-2 w-60 rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] shadow-xl p-2.5 z-30"
          >
            <div className="grid grid-cols-6 gap-1">
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-base hover:bg-slate-100 dark:hover:bg-[#2B2F45] transition cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          aria-label={t.messages.attachmentLabel}
          aria-expanded={attachmentNoticeOpen}
          aria-haspopup="dialog"
          title={t.messages.attachmentLabel}
          onClick={() => {
            setAttachmentNoticeOpen((prev) => !prev);
            setEmojiOpen(false);
          }}
          className="inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-[#2B2F45] hover:text-[#111827] dark:hover:text-slate-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label={t.messages.emojiPickerLabel}
          aria-expanded={emojiOpen}
          aria-haspopup="dialog"
          title={t.messages.emojiPickerLabel}
          onClick={() => {
            setEmojiOpen((prev) => !prev);
            setAttachmentNoticeOpen(false);
          }}
          className="inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-[#2B2F45] hover:text-[#111827] dark:hover:text-slate-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
        >
          <Smile className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="submit"
          aria-label={t.messages.sendAriaLabel}
          disabled={!draft.trim() || sending}
          className="inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] dark:hover:bg-[#6344F5] disabled:opacity-40 text-white transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}