import { useCallback, useEffect, useRef, useState } from 'react';
import { createE2eeSession, type E2eeSession } from '../crypto/cipherPort';
import { buildInviteUrl, parseInviteUrl } from '../domain/inviteLink';
import { generateOnionAddress, normalizeOnionAddress } from '../domain/onionAddress';
import { formatRoomCode, generateRoomCode, isValidRoomCode } from '../domain/roomCode';
import type {
  ConnectionStatus,
  EphemeralMessage,
  Locale,
  Participant,
  RoomErrorCode,
  RoomMode,
  TransportEvent,
} from '../domain/types';
import { BroadcastChannelTransport } from '../transport/BroadcastChannelTransport';
import type { RoomTransport } from '../transport/RoomTransport';
import {
  computeRemainingMs,
  DEFAULT_INACTIVITY_DURATION_MS,
  getInactivityAlertLevel,
  type InactivityAlertLevel,
} from './inactivityTimer';

const DEFAULT_DISPLAY_NAME = 'Visitante';
const TYPING_IDLE_TIMEOUT_MS = 2500;
const REMOTE_TYPING_TIMEOUT_MS = 4000;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function generateSecretKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  bytes.fill(0);
  return encoded;
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
  const hasModeParam = url.searchParams.has('mode');
  const hasOnionParam = url.searchParams.has('onion');
  const hasKeyHash = url.hash.includes('k=');
  if (!hasRoomParam && !hasModeParam && !hasOnionParam && !hasKeyHash) return;

  url.searchParams.delete('room');
  url.searchParams.delete('mode');
  url.searchParams.delete('onion');
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

export interface CreateRoomOptions {
  mode?: RoomMode;
  onionAddress?: string;
}

export interface RoomSessionState {
  transport: RoomTransport;
  status: ConnectionStatus;
  roomCode: string | null;
  roomMode: RoomMode;
  onionAddress: string | null;
  inviteUrl: string | null;
  localParticipant: Participant | null;
  participants: Participant[];
  messages: EphemeralMessage[];
  typingParticipantName: string | null;
  errorCode: RoomErrorCode | null;
  isHost: boolean;
  sasCode: string | null;
  e2eeReady: boolean;
  hasLinkSecret: boolean;
  inactivityRemainingMs: number;
  inactivityAlertLevel: InactivityAlertLevel;
  inactivityDurationMs: number;
  createRoom: (displayName?: string, mode?: RoomMode, options?: CreateRoomOptions) => Promise<void>;
  joinRoom: (rawCode: string, displayName?: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  setTyping: (isTyping: boolean) => void;
  renewActivity: () => Promise<void>;
  leaveRoom: () => Promise<void>;
  returnToEntry: () => void;
  clearError: () => void;
}

interface PendingKeyExchange {
  senderId: string;
  publicKeyJwk: JsonWebKey;
  hasSecret?: boolean;
}

export function useRoomSession(options: UseRoomSessionOptions = {}): RoomSessionState {
  const transportRef = useRef<RoomTransport | null>(null);
  if (!transportRef.current) {
    transportRef.current = options.transport ?? new BroadcastChannelTransport();
  }
  const transport = transportRef.current;

  const e2eeRef = useRef<E2eeSession | null>(null);
  const sessionGenRef = useRef(0);
  const secretKeyRef = useRef<string | undefined>(undefined);
  const roomCodeRef = useRef<string | null>(null);
  const localParticipantRef = useRef<Participant | null>(null);
  const localPubJwkRef = useRef<JsonWebKey | null>(null);
  const peerPresentRef = useRef(false);
  const sentLocalKeyRef = useRef(false);
  const pendingPeerKeyRef = useRef<PendingKeyExchange | null>(null);
  const handshakeReadyRef = useRef<Deferred | null>(null);
  const handshakeStartedRef = useRef(false);
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  const receiveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingOutboundQueueRef = useRef<Array<{ text: string }>>([]);
  const autoJoinAttemptedRef = useRef(false);
  const initialInviteModeRef = useRef<RoomMode>('normal');
  const initialOnionRef = useRef<string | null>(null);
  const localIsTypingRef = useRef(false);
  const localTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveDurationMs = options.inactivityDurationMs ?? DEFAULT_INACTIVITY_DURATION_MS;
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomMode, setRoomMode] = useState<RoomMode>('normal');
  const [onionAddress, setOnionAddress] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<EphemeralMessage[]>([]);
  const [typingParticipantId, setTypingParticipantId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RoomErrorCode | null>(null);
  const [sasCode, setSasCode] = useState<string | null>(null);
  const [e2eeReady, setE2eeReady] = useState(false);
  const [hasLinkSecret, setHasLinkSecret] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(effectiveDurationMs);
  const expiresAtRef = useRef<number | null>(null);

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

  const resetCryptoState = useCallback(() => {
    sessionGenRef.current += 1;
    handshakeReadyRef.current?.resolve();
    handshakeReadyRef.current = null;
    handshakeStartedRef.current = false;
    pendingPeerKeyRef.current = null;
    localPubJwkRef.current = null;
    peerPresentRef.current = false;
    sentLocalKeyRef.current = false;
    e2eeRef.current?.destroy();
    e2eeRef.current = null;
    setSasCode(null);
    setE2eeReady(false);
  }, []);

  const wipeVolatileState = useCallback(
    (nextStatus: ConnectionStatus, nextError: RoomErrorCode | null = null) => {
      clearTypingTimers();
      resetCryptoState();
      pendingOutboundQueueRef.current = [];
      secretKeyRef.current = undefined;
      roomCodeRef.current = null;
      localParticipantRef.current = null;
      initialInviteModeRef.current = 'normal';
      initialOnionRef.current = null;

      setHasLinkSecret(false);
      setRoomCode(null);
      setRoomMode('normal');
      setOnionAddress(null);
      setInviteUrl(null);
      setLocalParticipant(null);
      setParticipants([]);
      setMessages([]);
      setTypingParticipantId(null);
      expiresAtRef.current = null;
      setExpiresAt(null);
      setRemainingMs(0);
      setStatus(nextStatus);
      setErrorCode(nextError);
    },
    [clearTypingTimers, resetCryptoState],
  );

  useEffect(() => {
    const finalizeHandshake = async (
      session: E2eeSession,
      gen: number,
      peerKey: PendingKeyExchange,
    ) => {
      if (handshakeStartedRef.current || sessionGenRef.current !== gen) return;
      handshakeStartedRef.current = true;

      const isLocalHost = localParticipantRef.current?.role === 'host';
      const useSecretKey = !(isLocalHost && peerKey.hasSecret === false);

      try {
        const derivedSas = await session.completeKeyExchange(peerKey.publicKeyJwk, {
          useSecretKey,
        });
        if (sessionGenRef.current !== gen || e2eeRef.current !== session) return;

        setHasLinkSecret(useSecretKey && Boolean(secretKeyRef.current));
        setSasCode(derivedSas);
        setE2eeReady(true);
        handshakeReadyRef.current?.resolve();

        const queued = pendingOutboundQueueRef.current.splice(0);
        if (queued.length > 0) {
          sendChainRef.current = sendChainRef.current
            .then(async () => {
              for (const item of queued) {
                if (
                  sessionGenRef.current !== gen ||
                  e2eeRef.current !== session ||
                  !session.isReady()
                ) {
                  break;
                }
                const currentCode = roomCodeRef.current;
                const sender = localParticipantRef.current;
                if (!currentCode || !sender) break;

                const envelope = await session.encrypt(item.text, {
                  roomCode: currentCode,
                  senderId: sender.id,
                  senderName: sender.displayName,
                  senderRole: sender.role,
                });
                if (sessionGenRef.current !== gen) break;

                await transport.sendEncryptedMessage(envelope);
                await transport.notifyActivity();
              }
            })
            .catch(() => {});
        }
      } catch {
        handshakeStartedRef.current = false;
      }
    };

    const startE2eeSession = (code: string, participant: Participant, hasPeer: boolean) => {
      resetCryptoState();
      const gen = sessionGenRef.current;
      const session = createE2eeSession({
        role: participant.role,
        roomCode: code,
        secretKey: secretKeyRef.current,
      });
      e2eeRef.current = session;
      handshakeReadyRef.current = createDeferred();
      peerPresentRef.current = hasPeer;
      setHasLinkSecret(Boolean(secretKeyRef.current));

      void session.init().then((pubJwk) => {
        if (sessionGenRef.current !== gen || e2eeRef.current !== session) return;
        localPubJwkRef.current = pubJwk;

        if (peerPresentRef.current && !sentLocalKeyRef.current) {
          sentLocalKeyRef.current = true;
          void transport.sendKeyExchange(pubJwk, {
            hasSecret: Boolean(secretKeyRef.current),
          });
        }

        if (pendingPeerKeyRef.current) {
          const pending = pendingPeerKeyRef.current;
          pendingPeerKeyRef.current = null;
          void finalizeHandshake(session, gen, pending);
        }
      }).catch(() => {
        // Session may be destroyed before key generation completes on room exit/expiry
      });
    };

    const unsubscribe = transport.subscribe((event: TransportEvent) => {
      switch (event.type) {
        case 'room_joined': {
          pendingOutboundQueueRef.current = [];
          roomCodeRef.current = event.roomCode;
          localParticipantRef.current = event.participant;

          const effectiveMode: RoomMode =
            event.mode === 'tor' || initialInviteModeRef.current === 'tor' ? 'tor' : 'normal';
          const effectiveOnion =
            effectiveMode === 'tor'
              ? (event.onionAddress ?? initialOnionRef.current ?? null)
              : null;

          const origin =
            typeof window !== 'undefined' && window.location.origin !== 'null'
              ? window.location.origin
              : 'https://pulso.local';

          setRoomCode(event.roomCode);
          setRoomMode(effectiveMode);
          setOnionAddress(effectiveOnion);
          setInviteUrl(
            buildInviteUrl({
              origin,
              roomCode: event.roomCode,
              secretKey: secretKeyRef.current,
              mode: effectiveMode,
              onionAddress: effectiveOnion ?? undefined,
            }),
          );
          setLocalParticipant(event.participant);
          setParticipants(event.participants);
          setMessages([]);
          setErrorCode(null);
          expiresAtRef.current = event.expiresAt;
          setExpiresAt(event.expiresAt);
          setRemainingMs(computeRemainingMs(event.expiresAt));
          setStatus(event.participants.length >= 2 ? 'connected' : 'waiting');

          startE2eeSession(
            event.roomCode,
            event.participant,
            event.participants.length >= 2,
          );
          break;
        }
        case 'participant_joined': {
          setParticipants(event.participants);
          setStatus('connected');
          peerPresentRef.current = true;

          if (localPubJwkRef.current) {
            sentLocalKeyRef.current = true;
            void transport.sendKeyExchange(localPubJwkRef.current, {
              hasSecret: Boolean(secretKeyRef.current),
            });
          }
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

          const code = roomCodeRef.current;
          const local = localParticipantRef.current;
          if (event.participants.length < 2 && code && local) {
            startE2eeSession(code, local, false);
          }
          break;
        }
        case 'key_exchange': {
          if (event.senderId === localParticipantRef.current?.id) {
            return;
          }
          peerPresentRef.current = true;

          const session = e2eeRef.current;
          const gen = sessionGenRef.current;
          const payload: PendingKeyExchange = {
            senderId: event.senderId,
            publicKeyJwk: event.publicKeyJwk,
            hasSecret: event.hasSecret,
          };

          if (!session || !localPubJwkRef.current) {
            pendingPeerKeyRef.current = payload;
            return;
          }

          if (!sentLocalKeyRef.current) {
            sentLocalKeyRef.current = true;
            void transport.sendKeyExchange(localPubJwkRef.current, {
              hasSecret: Boolean(secretKeyRef.current),
            });
          }

          void finalizeHandshake(session, gen, payload);
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
          const gen = sessionGenRef.current;
          const handshake = handshakeReadyRef.current;
          if (!session) return;

          receiveChainRef.current = receiveChainRef.current.then(async () => {
            if (sessionGenRef.current !== gen || e2eeRef.current !== session) return;
            await handshake?.promise;
            if (sessionGenRef.current !== gen || !session.isReady()) return;

            try {
              const plaintext = await session.decrypt(event.envelope);
              if (sessionGenRef.current !== gen) return;
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
            } catch {
              // Drop envelopes that fail decryption, GCM auth, or anti-replay checks
            }
          });
          break;
        }
        case 'activity_reset': {
          if (!roomCodeRef.current) return;
          expiresAtRef.current = event.expiresAt;
          setExpiresAt(event.expiresAt);
          setRemainingMs(computeRemainingMs(event.expiresAt));
          break;
        }
        case 'room_expired': {
          clearBrowserRoomUrl();
          wipeVolatileState('expired', 'room_expired');
          break;
        }
        case 'room_error': {
          clearBrowserRoomUrl();
          wipeVolatileState('error', event.code);
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      clearTypingTimers();
      resetCryptoState();
      pendingOutboundQueueRef.current = [];
      secretKeyRef.current = undefined;
      roomCodeRef.current = null;
      localParticipantRef.current = null;
      void transport.leaveRoom();
    };
  }, [clearTypingTimers, resetCryptoState, transport, wipeVolatileState]);

  const createRoom = useCallback(
    async (displayName?: string, mode: RoomMode = 'normal', createOptions?: CreateRoomOptions) => {
      const effectiveMode = createOptions?.mode ?? mode;
      const fallbackName = options.defaultDisplayName ?? DEFAULT_DISPLAY_NAME;
      const cleanName = displayName?.trim() || fallbackName;
      const code = generateRoomCode();
      secretKeyRef.current = generateSecretKey();
      initialInviteModeRef.current = effectiveMode;

      let resolvedOnion: string | undefined;
      if (effectiveMode === 'tor') {
        const provided = createOptions?.onionAddress
          ? normalizeOnionAddress(createOptions.onionAddress)
          : null;
        const browserOnion =
          typeof window !== 'undefined' && window.location.hostname.endsWith('.onion')
            ? window.location.origin
            : null;
        resolvedOnion = provided ?? browserOnion ?? generateOnionAddress();
      }
      initialOnionRef.current = resolvedOnion ?? null;

      setRoomMode(effectiveMode);
      setOnionAddress(resolvedOnion ?? null);
      setErrorCode(null);
      setStatus('connecting');

      await transport.createRoom({
        roomCode: code,
        displayName: cleanName,
        mode: effectiveMode,
        onionAddress: resolvedOnion,
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

  const joinRoomRef = useRef(joinRoom);
  joinRoomRef.current = joinRoom;

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
    initialInviteModeRef.current = parsed.mode;
    initialOnionRef.current = parsed.onionAddress ?? null;
    setRoomMode(parsed.mode);
    setOnionAddress(parsed.onionAddress ?? null);
    void joinRoomRef.current(parsed.roomCode);

    return () => {
      autoJoinAttemptedRef.current = false;
    };
  }, [options.initialUrl]);

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
      const gen = sessionGenRef.current;
      const currentCode = roomCodeRef.current;
      const sender = localParticipantRef.current;

      if (!text || !session || !currentCode || !sender) {
        return;
      }

      setTyping(false);

      if (!session.isReady()) {
        const localMsg: EphemeralMessage = {
          id: createMessageId(),
          senderId: sender.id,
          senderName: sender.displayName,
          senderRole: sender.role,
          text,
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, localMsg]);
        pendingOutboundQueueRef.current.push({ text });
        return;
      }

      const task = sendChainRef.current.then(async () => {
        if (sessionGenRef.current !== gen || e2eeRef.current !== session || !session.isReady()) {
          return;
        }

        const envelope = await session.encrypt(text, {
          roomCode: currentCode,
          senderId: sender.id,
          senderName: sender.displayName,
          senderRole: sender.role,
        });

        if (sessionGenRef.current !== gen) return;

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
        await transport.notifyActivity();
      });

      sendChainRef.current = task.catch(() => {});
      await task;
    },
    [setTyping, transport],
  );

  const expireRoom = useCallback(async () => {
    if (!roomCodeRef.current) return;
    if (expiresAtRef.current !== null && Date.now() < expiresAtRef.current) {
      return;
    }
    clearBrowserRoomUrl();
    wipeVolatileState('expired', 'room_expired');
    if (transport.expireRoom) {
      await transport.expireRoom();
    } else {
      await transport.leaveRoom();
    }
  }, [transport, wipeVolatileState]);

  useEffect(() => {
    const inRoom = status === 'waiting' || status === 'connected';
    if (!inRoom || expiresAt === null) return;

    const initialRemaining = computeRemainingMs(expiresAtRef.current ?? expiresAt);
    setRemainingMs(initialRemaining);
    if (initialRemaining <= 0) {
      void expireRoom();
      return;
    }

    const expireTimeout = setTimeout(() => {
      void expireRoom();
    }, initialRemaining);

    let tickInterval: ReturnType<typeof setInterval> | null = null;
    const firstDelay = initialRemaining % 1000 || 1000;
    const alignTimeout = setTimeout(() => {
      const rem = computeRemainingMs(expiresAtRef.current);
      setRemainingMs(rem);
      if (rem <= 0) {
        void expireRoom();
        return;
      }
      tickInterval = setInterval(() => {
        const nextRem = computeRemainingMs(expiresAtRef.current);
        setRemainingMs(nextRem);
        if (nextRem <= 0) {
          void expireRoom();
        }
      }, 1000);
    }, firstDelay);

    return () => {
      clearTimeout(expireTimeout);
      clearTimeout(alignTimeout);
      if (tickInterval) clearInterval(tickInterval);
    };
  }, [expireRoom, expiresAt, status]);

  const renewActivity = useCallback(async () => {
    if (!roomCodeRef.current) return;
    await transport.notifyActivity();
  }, [transport]);

  const leaveRoom = useCallback(async () => {
    setTyping(false);
    await transport.leaveRoom();
    clearBrowserRoomUrl();
    wipeVolatileState('idle', null);
  }, [setTyping, transport, wipeVolatileState]);

  const returnToEntry = useCallback(() => {
    clearBrowserRoomUrl();
    setErrorCode(null);
    setStatus('idle');
  }, []);

  const clearError = useCallback(() => {
    setErrorCode(null);
    setStatus((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const typingParticipantName = typingParticipantId
    ? (participants.find((p) => p.id === typingParticipantId)?.displayName ?? null)
    : null;

  return {
    transport,
    status,
    roomCode,
    roomMode,
    onionAddress,
    inviteUrl,
    localParticipant,
    participants,
    messages,
    typingParticipantName,
    errorCode,
    isHost: localParticipant?.role === 'host',
    sasCode,
    e2eeReady,
    hasLinkSecret,
    inactivityRemainingMs: remainingMs,
    inactivityAlertLevel: getInactivityAlertLevel(remainingMs),
    inactivityDurationMs: effectiveDurationMs,
    createRoom,
    joinRoom,
    sendMessage,
    setTyping,
    renewActivity,
    leaveRoom,
    returnToEntry,
    clearError,
  };
}
