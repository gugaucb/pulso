import { useCallback, useEffect, useRef, useState } from 'react';
import { createCodecE2eeSession, type E2eeSession } from '../crypto/cipherPort';
import { buildInviteUrl, parseInviteUrl } from '../domain/inviteLink';
import { formatRoomCode, generateRoomCode, isValidRoomCode } from '../domain/roomCode';
import type {
  ConnectionStatus,
  EphemeralMessage,
  Locale,
  Participant,
  RoomErrorCode,
  TransportEvent,
} from '../domain/types';
import { BroadcastChannelTransport } from '../transport/BroadcastChannelTransport';
import type { RoomTransport } from '../transport/RoomTransport';

const DEFAULT_DISPLAY_NAME = 'Visitante';
const TYPING_IDLE_TIMEOUT_MS = 2500;
const REMOTE_TYPING_TIMEOUT_MS = 4000;

function generateSecretKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createMessageId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function clearBrowserRoomUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  const hasRoomParam = url.searchParams.has('room');
  const hasKeyHash = url.hash.includes('k=');
  if (!hasRoomParam && !hasKeyHash) return;

  url.searchParams.delete('room');
  if (hasKeyHash) {
    url.hash = '';
  }
  const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(null, '', nextRelativeUrl || '/');
}

export interface UseRoomSessionOptions {
  transport?: RoomTransport;
  initialUrl?: string;
  inactivityDurationMs?: number;
  initialLocale?: Locale;
  defaultDisplayName?: string;
}

export interface RoomSessionState {
  status: ConnectionStatus;
  roomCode: string | null;
  inviteUrl: string | null;
  localParticipant: Participant | null;
  participants: Participant[];
  messages: EphemeralMessage[];
  typingParticipantName: string | null;
  errorCode: RoomErrorCode | null;
  isHost: boolean;
  createRoom: (displayName?: string) => Promise<void>;
  joinRoom: (rawCode: string, displayName?: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  setTyping: (isTyping: boolean) => void;
  leaveRoom: () => Promise<void>;
  clearError: () => void;
}

export function useRoomSession(options: UseRoomSessionOptions = {}): RoomSessionState {
  const ownsTransportRef = useRef(false);
  const transportRef = useRef<RoomTransport | null>(null);
  if (!transportRef.current) {
    if (options.transport) {
      transportRef.current = options.transport;
      ownsTransportRef.current = false;
    } else {
      transportRef.current = new BroadcastChannelTransport();
      ownsTransportRef.current = true;
    }
  }
  const transport = transportRef.current;

  const e2eeRef = useRef<E2eeSession | null>(null);
  const secretKeyRef = useRef<string | undefined>(undefined);
  const roomCodeRef = useRef<string | null>(null);
  const localParticipantRef = useRef<Participant | null>(null);
  const autoJoinAttemptedRef = useRef(false);
  const localIsTypingRef = useRef(false);
  const localTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<EphemeralMessage[]>([]);
  const [typingParticipantId, setTypingParticipantId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RoomErrorCode | null>(null);

  const clearTypingTimers = useCallback(() => {
    if (localTypingTimerRef.current) {
      clearTimeout(localTypingTimerRef.current);
      localTypingTimerRef.current = null;
    }
    if (remoteTypingTimerRef.current) {
      clearTimeout(remoteTypingTimerRef.current);
      remoteTypingTimerRef.current = null;
    }
    localIsTypingRef.current = false;
  }, []);

  const wipeVolatileState = useCallback((nextStatus: ConnectionStatus, nextError: RoomErrorCode | null = null) => {
    clearTypingTimers();
    e2eeRef.current?.destroy();
    e2eeRef.current = null;
    secretKeyRef.current = undefined;
    roomCodeRef.current = null;
    localParticipantRef.current = null;

    setRoomCode(null);
    setInviteUrl(null);
    setLocalParticipant(null);
    setParticipants([]);
    setMessages([]);
    setTypingParticipantId(null);
    setStatus(nextStatus);
    setErrorCode(nextError);
  }, [clearTypingTimers]);

  useEffect(() => {
    const unsubscribe = transport.subscribe((event: TransportEvent) => {
      switch (event.type) {
        case 'room_joined': {
          e2eeRef.current = createCodecE2eeSession();
          roomCodeRef.current = event.roomCode;
          localParticipantRef.current = event.participant;

          const origin =
            typeof window !== 'undefined' && window.location.origin !== 'null'
              ? window.location.origin
              : 'https://pulso.local';

          setRoomCode(event.roomCode);
          setInviteUrl(
            buildInviteUrl({
              origin,
              roomCode: event.roomCode,
              secretKey: secretKeyRef.current,
              mode: event.mode,
              onionAddress: event.onionAddress,
            }),
          );
          setLocalParticipant(event.participant);
          setParticipants(event.participants);
          setMessages([]);
          setErrorCode(null);
          setStatus(event.participants.length >= 2 ? 'connected' : 'waiting');
          break;
        }
        case 'participant_joined': {
          setParticipants(event.participants);
          setStatus('connected');
          break;
        }
        case 'participant_left': {
          if (remoteTypingTimerRef.current) {
            clearTimeout(remoteTypingTimerRef.current);
            remoteTypingTimerRef.current = null;
          }
          setTypingParticipantId((prev) => (prev === event.participantId ? null : prev));
          setParticipants(event.participants);
          setStatus(event.participants.length >= 2 ? 'connected' : 'waiting');
          break;
        }
        case 'typing': {
          if (remoteTypingTimerRef.current) {
            clearTimeout(remoteTypingTimerRef.current);
            remoteTypingTimerRef.current = null;
          }
          if (event.isTyping) {
            setTypingParticipantId(event.participantId);
            remoteTypingTimerRef.current = setTimeout(() => {
              setTypingParticipantId((prev) => (prev === event.participantId ? null : prev));
            }, REMOTE_TYPING_TIMEOUT_MS);
          } else {
            setTypingParticipantId((prev) => (prev === event.participantId ? null : prev));
          }
          break;
        }
        case 'encrypted_message': {
          const session = e2eeRef.current;
          if (!session) return;
          void session
            .decrypt(event.envelope)
            .then((plaintext) => {
              const incoming: EphemeralMessage = {
                id: `${event.envelope.senderId}-${event.envelope.seq}-${event.envelope.sentAt}`,
                senderId: event.envelope.senderId,
                senderName: event.envelope.senderName,
                senderRole: event.envelope.senderRole,
                text: plaintext,
                createdAt: event.envelope.sentAt,
              };
              setTypingParticipantId((prev) =>
                prev === event.envelope.senderId ? null : prev,
              );
              setMessages((prev) => [...prev, incoming]);
            })
            .catch(() => {
              // Drop envelopes that fail decryption/authentication
            });
          break;
        }
        case 'room_expired': {
          wipeVolatileState('expired', 'room_expired');
          break;
        }
        case 'room_error': {
          wipeVolatileState('error', event.code);
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      clearTypingTimers();
      e2eeRef.current?.destroy();
      e2eeRef.current = null;
      if (ownsTransportRef.current) {
        transport.dispose();
      } else {
        void transport.leaveRoom();
      }
    };
  }, [clearTypingTimers, transport, wipeVolatileState]);

  const createRoom = useCallback(
    async (displayName?: string) => {
      const fallbackName = options.defaultDisplayName ?? DEFAULT_DISPLAY_NAME;
      const cleanName = displayName?.trim() || fallbackName;
      const code = generateRoomCode();
      secretKeyRef.current = generateSecretKey();
      setErrorCode(null);
      setStatus('connecting');

      await transport.createRoom({
        roomCode: code,
        displayName: cleanName,
        mode: 'normal',
        inactivityDurationMs: options.inactivityDurationMs,
      });
    },
    [options.defaultDisplayName, options.inactivityDurationMs, transport],
  );

  const joinRoom = useCallback(
    async (rawCode: string, displayName?: string) => {
      if (!isValidRoomCode(rawCode)) {
        setErrorCode('invalid_code');
        setStatus('error');
        return;
      }

      const fallbackName = options.defaultDisplayName ?? DEFAULT_DISPLAY_NAME;
      const cleanName = displayName?.trim() || fallbackName;
      const formatted = formatRoomCode(rawCode);
      setErrorCode(null);
      setStatus('connecting');

      await transport.joinRoom({
        roomCode: formatted,
        displayName: cleanName,
      });
    },
    [options.defaultDisplayName, transport],
  );

  useEffect(() => {
    if (autoJoinAttemptedRef.current) return;
    autoJoinAttemptedRef.current = true;

    const urlToParse =
      options.initialUrl ??
      (typeof window !== 'undefined' ? window.location.href : undefined);

    if (!urlToParse) return;
    const parsed = parseInviteUrl(urlToParse);
    if (!parsed) return;

    secretKeyRef.current = parsed.secretKey;
    void joinRoom(parsed.roomCode);
  }, [joinRoom, options.initialUrl]);

  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (!roomCodeRef.current) return;

      if (localTypingTimerRef.current) {
        clearTimeout(localTypingTimerRef.current);
        localTypingTimerRef.current = null;
      }

      if (isTyping) {
        if (!localIsTypingRef.current) {
          localIsTypingRef.current = true;
          void transport.setTyping(true);
        }
        localTypingTimerRef.current = setTimeout(() => {
          localTypingTimerRef.current = null;
          if (localIsTypingRef.current) {
            localIsTypingRef.current = false;
            void transport.setTyping(false);
          }
        }, TYPING_IDLE_TIMEOUT_MS);
      } else if (localIsTypingRef.current) {
        localIsTypingRef.current = false;
        void transport.setTyping(false);
      }
    },
    [transport],
  );

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      const session = e2eeRef.current;
      const currentCode = roomCodeRef.current;
      const sender = localParticipantRef.current;

      if (!text || !session || !currentCode || !sender) {
        return;
      }

      setTyping(false);

      const envelope = await session.encrypt(text, {
        roomCode: currentCode,
        senderId: sender.id,
        senderName: sender.displayName,
        senderRole: sender.role,
      });

      const localMsg: EphemeralMessage = {
        id: createMessageId(),
        senderId: sender.id,
        senderName: sender.displayName,
        senderRole: sender.role,
        text,
        createdAt: envelope.sentAt,
      };

      setMessages((prev) => [...prev, localMsg]);
      await transport.sendEncryptedMessage(envelope);
    },
    [setTyping, transport],
  );

  const leaveRoom = useCallback(async () => {
    setTyping(false);
    await transport.leaveRoom();
    clearBrowserRoomUrl();
    wipeVolatileState('idle', null);
  }, [setTyping, transport, wipeVolatileState]);

  const clearError = useCallback(() => {
    setErrorCode(null);
    setStatus((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const typingParticipantName = typingParticipantId
    ? (participants.find((p) => p.id === typingParticipantId)?.displayName ?? null)
    : null;

  return {
    status,
    roomCode,
    inviteUrl,
    localParticipant,
    participants,
    messages,
    typingParticipantName,
    errorCode,
    isHost: localParticipant?.role === 'host',
    createRoom,
    joinRoom,
    sendMessage,
    setTyping,
    leaveRoom,
    clearError,
  };
}
