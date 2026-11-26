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

export interface UseRoomSessionOptions {
  transport?: RoomTransport;
  initialUrl?: string;
  inactivityDurationMs?: number;
  initialLocale?: Locale;
}

export interface RoomSessionState {
  status: ConnectionStatus;
  roomCode: string | null;
  inviteUrl: string | null;
  localParticipant: Participant | null;
  participants: Participant[];
  messages: EphemeralMessage[];
  errorCode: RoomErrorCode | null;
  isHost: boolean;
  createRoom: (displayName?: string) => Promise<void>;
  joinRoom: (rawCode: string, displayName?: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
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

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<EphemeralMessage[]>([]);
  const [errorCode, setErrorCode] = useState<RoomErrorCode | null>(null);

  const wipeVolatileState = useCallback((nextStatus: ConnectionStatus, nextError: RoomErrorCode | null = null) => {
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
    setStatus(nextStatus);
    setErrorCode(nextError);
  }, []);

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
          setParticipants(event.participants);
          setStatus(event.participants.length >= 2 ? 'connected' : 'waiting');
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
      e2eeRef.current?.destroy();
      e2eeRef.current = null;
      if (ownsTransportRef.current) {
        transport.dispose();
      } else {
        void transport.leaveRoom();
      }
    };
  }, [transport, wipeVolatileState]);

  const createRoom = useCallback(
    async (displayName?: string) => {
      const cleanName = displayName?.trim() || DEFAULT_DISPLAY_NAME;
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
    [options.inactivityDurationMs, transport],
  );

  const joinRoom = useCallback(
    async (rawCode: string, displayName?: string) => {
      if (!isValidRoomCode(rawCode)) {
        setErrorCode('invalid_code');
        setStatus('error');
        return;
      }

      const cleanName = displayName?.trim() || DEFAULT_DISPLAY_NAME;
      const formatted = formatRoomCode(rawCode);
      setErrorCode(null);
      setStatus('connecting');

      await transport.joinRoom({
        roomCode: formatted,
        displayName: cleanName,
      });
    },
    [transport],
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

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      const session = e2eeRef.current;
      const currentCode = roomCodeRef.current;
      const sender = localParticipantRef.current;

      if (!text || !session || !currentCode || !sender) {
        return;
      }

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
    [transport],
  );

  const leaveRoom = useCallback(async () => {
    await transport.leaveRoom();
    wipeVolatileState('idle', null);
  }, [transport, wipeVolatileState]);

  const clearError = useCallback(() => {
    setErrorCode(null);
    setStatus((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  return {
    status,
    roomCode,
    inviteUrl,
    localParticipant,
    participants,
    messages,
    errorCode,
    isHost: localParticipant?.role === 'host',
    createRoom,
    joinRoom,
    sendMessage,
    leaveRoom,
    clearError,
  };
}
