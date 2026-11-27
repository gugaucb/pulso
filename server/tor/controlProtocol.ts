import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';

const SERVER_HASH_LABEL = Buffer.from('Tor safe cookie authentication server-to-controller hash', 'ascii');
const CLIENT_HASH_LABEL = Buffer.from('Tor safe cookie authentication controller-to-server hash', 'ascii');
const V3_SERVICE_ID_REGEX = /^[a-z2-7]{56}$/;
const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

export interface ControlEndpoint {
  host: string;
  port: number;
}

export type ControlAsyncEvent =
  | {
      type: 'status_client';
      severity: string;
      action: string;
      progress?: number;
      tag?: string;
      summary?: string;
      reason?: string;
    }
  | {
      type: 'hs_desc';
      action: string;
      serviceId?: string;
    }
  | {
      type: 'other';
      raw: string;
    };

/**
 * Parses Tor ControlPortWriteToFile content (e.g. `PORT=127.0.0.1:9051` or `PORT=[::1]:9051`).
 */
export function parseControlPortFile(content: string): ControlEndpoint {
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line.startsWith('PORT=')) continue;
    const rawAddr = line.slice('PORT='.length).trim();

    let host: string;
    let portStr: string;
    if (rawAddr.startsWith('[')) {
      const closeIdx = rawAddr.indexOf(']:');
      if (closeIdx === -1) continue;
      host = rawAddr.slice(1, closeIdx);
      portStr = rawAddr.slice(closeIdx + 2);
    } else {
      const colonIdx = rawAddr.lastIndexOf(':');
      if (colonIdx === -1) continue;
      host = rawAddr.slice(0, colonIdx);
      portStr = rawAddr.slice(colonIdx + 1);
    }

    const port = Number.parseInt(portStr, 10);
    if (host && Number.isInteger(port) && port > 0 && port <= 65535 && String(port) === portStr) {
      return { host, port };
    }
  }
  throw new Error('Malformed or missing ControlPort entry in ControlPortWriteToFile');
}

function computeSafeCookieHmac(
  label: Buffer,
  cookieBytes: Buffer,
  clientNonce: Buffer,
  serverNonce: Buffer,
): Buffer {
  const payload = Buffer.concat([cookieBytes, clientNonce, serverNonce]);
  return createHmac('sha256', label).update(payload).digest();
}

/**
 * Computes expected SERVERHASH per Tor Control Spec §3.24.
 */
export function computeSafeCookieServerHash(
  cookieBytes: Buffer,
  clientNonce: Buffer,
  serverNonce: Buffer,
): Buffer {
  return computeSafeCookieHmac(SERVER_HASH_LABEL, cookieBytes, clientNonce, serverNonce);
}

/**
 * Computes controller AUTHENTICATE digest per Tor Control Spec §3.24.
 */
export function computeSafeCookieClientHash(
  cookieBytes: Buffer,
  clientNonce: Buffer,
  serverNonce: Buffer,
): Buffer {
  return computeSafeCookieHmac(CLIENT_HASH_LABEL, cookieBytes, clientNonce, serverNonce);
}

/**
 * Parses `AUTHCHALLENGE SERVERHASH=<hex> SERVERNONCE=<hex>`.
 */
export function parseAuthChallengeReply(lines: string[]): { serverHash: Buffer; serverNonce: Buffer } {
  const joined = lines.join(' ');
  const serverHashMatch = /\bSERVERHASH=([0-9a-fA-F]+)\b/.exec(joined);
  const serverNonceMatch = /\bSERVERNONCE=([0-9a-fA-F]+)\b/.exec(joined);

  const serverHashHex = serverHashMatch?.[1] ?? '';
  const serverNonceHex = serverNonceMatch?.[1] ?? '';
  if (!HEX_64_REGEX.test(serverHashHex) || !HEX_64_REGEX.test(serverNonceHex)) {
    throw new Error('Invalid AUTHCHALLENGE reply from Tor ControlPort');
  }

  return {
    serverHash: Buffer.from(serverHashHex, 'hex'),
    serverNonce: Buffer.from(serverNonceHex, 'hex'),
  };
}

/**
 * Extracts and validates the 56-char v3 ServiceID from an ADD_ONION reply.
 */
export function parseAddOnionReply(lines: string[]): string {
  for (const line of lines) {
    const match = /^ServiceID=([a-zA-Z2-7]+)$/.exec(line.trim());
    if (match) {
      const normalized = match[1].toLowerCase();
      if (V3_SERVICE_ID_REGEX.test(normalized)) {
        return normalized;
      }
    }
  }
  throw new Error(`Missing valid v3 ServiceID in ADD_ONION reply: ${lines.join('; ')}`);
}

function parseControlKvValue(raw: string, key: string): string | undefined {
  const quotedPattern = new RegExp(`(?:^|\\s)${key}="((?:[^"\\\\]|\\\\.)*)"`);
  const quotedMatch = quotedPattern.exec(raw);
  if (quotedMatch) {
    return quotedMatch[1].replace(/\\(.)/g, '$1');
  }
  const unquotedPattern = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`);
  const unquotedMatch = unquotedPattern.exec(raw);
  return unquotedMatch?.[1];
}

/**
 * Parses asynchronous 650 event lines (STATUS_CLIENT and HS_DESC).
 */
export function parseControlAsyncEvent(lines: string[]): ControlAsyncEvent {
  const raw = lines.join(' ').trim();
  const tokens = raw.split(/\s+/);
  const eventType = tokens[0];

  if (eventType === 'STATUS_CLIENT') {
    const severity = tokens[1] ?? '';
    const action = tokens[2] ?? '';
    const progressMatch = /\bPROGRESS=(\d+)\b/.exec(raw);
    const progress = progressMatch ? Number.parseInt(progressMatch[1], 10) : undefined;
    const tag = parseControlKvValue(raw, 'TAG');
    const summary = parseControlKvValue(raw, 'SUMMARY');
    const reason = parseControlKvValue(raw, 'REASON');
    return {
      type: 'status_client',
      severity,
      action,
      progress,
      ...(tag !== undefined ? { tag } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  if (eventType === 'HS_DESC') {
    const action = tokens[1] ?? '';
    const rawAddr = tokens[2]?.replace(/\.onion$/i, '').toLowerCase();
    const serviceId = rawAddr && V3_SERVICE_ID_REGEX.test(rawAddr) ? rawAddr : undefined;
    return { type: 'hs_desc', action, serviceId };
  }

  return { type: 'other', raw };
}

export interface ControlReply {
  code: number;
  lines: string[];
}

interface PendingCommand {
  resolve: (reply: ControlReply) => void;
  reject: (err: Error) => void;
}

function noop(): void {}

/**
 * Stateful Tor ControlPort protocol client operating over any Node Duplex stream.
 * Separates asynchronous 650 events from FIFO synchronous command replies.
 */
export class ControlPortClient {
  private readonly stream: Duplex;
  private readonly pendingQueue: PendingCommand[] = [];
  private readonly eventListeners = new Set<(event: ControlAsyncEvent) => void>();
  private readBuffer = '';
  private currentReplyLines: string[] = [];
  private currentAsyncLines: string[] = [];
  private inDataBlock: 'reply' | 'async' | null = null;
  private closed = false;

  constructor(stream: Duplex) {
    this.stream = stream;
    this.stream.on('data', this.handleData);
    this.stream.on('error', this.handleStreamError);
    this.stream.on('close', this.handleStreamClose);
  }

  onEvent(listener: (event: ControlAsyncEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  sendCommand(command: string): Promise<ControlReply> {
    if (this.closed) {
      return Promise.reject(new Error('Tor ControlPort stream is closed'));
    }
    return new Promise<ControlReply>((resolve, reject) => {
      this.pendingQueue.push({ resolve, reject });
      this.stream.write(`${command}\r\n`);
    });
  }

  async authenticateSafeCookie(
    cookieBytes: Buffer,
    randomBytesFn: (size: number) => Buffer = randomBytes,
  ): Promise<void> {
    if (cookieBytes.length !== 32) {
      throw new Error(`Expected 32-byte Tor auth cookie, got ${cookieBytes.length} bytes`);
    }
    const clientNonce = randomBytesFn(32);
    const challengeReply = await this.sendCommand(
      `AUTHCHALLENGE SAFECOOKIE ${clientNonce.toString('hex')}`,
    );
    const { serverHash, serverNonce } = parseAuthChallengeReply(challengeReply.lines);
    const expectedServerHash = computeSafeCookieServerHash(cookieBytes, clientNonce, serverNonce);

    if (
      serverHash.length !== expectedServerHash.length ||
      !timingSafeEqual(serverHash, expectedServerHash)
    ) {
      throw new Error('SAFECOOKIE SERVERHASH verification failed');
    }

    const clientHash = computeSafeCookieClientHash(cookieBytes, clientNonce, serverNonce);
    await this.sendCommand(`AUTHENTICATE ${clientHash.toString('hex')}`);
  }

  async setEvents(events: string[]): Promise<void> {
    await this.sendCommand(`SETEVENTS ${events.join(' ')}`);
  }

  async addOnion(localPort: number): Promise<string> {
    const reply = await this.sendCommand(
      `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:${localPort}`,
    );
    return parseAddOnionReply(reply.lines);
  }

  async delOnion(serviceId: string): Promise<void> {
    await this.sendCommand(`DEL_ONION ${serviceId}`);
  }

  async signalShutdown(): Promise<void> {
    await this.sendCommand('SIGNAL SHUTDOWN');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stream.off('data', this.handleData);
    this.stream.off('error', this.handleStreamError);
    this.stream.off('close', this.handleStreamClose);
    this.stream.on('error', noop);
    if (!this.stream.destroyed) {
      this.stream.destroy();
    }
    this.rejectPending(new Error('Tor ControlPort connection closed'));
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    this.readBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    while (true) {
      const nlIdx = this.readBuffer.indexOf('\n');
      if (nlIdx === -1) break;
      const line = this.readBuffer.slice(0, nlIdx).replace(/\r$/, '');
      this.readBuffer = this.readBuffer.slice(nlIdx + 1);
      this.processLine(line);
    }
  };

  private readonly handleStreamError = (err: Error): void => {
    this.closed = true;
    this.rejectPending(err);
  };

  private readonly handleStreamClose = (): void => {
    this.closed = true;
    this.rejectPending(new Error('Tor ControlPort connection closed unexpectedly'));
  };

  private rejectPending(err: Error): void {
    while (this.pendingQueue.length > 0) {
      const item = this.pendingQueue.shift();
      item?.reject(err);
    }
  }

  private processLine(line: string): void {
    if (this.inDataBlock !== null) {
      if (line === '.') {
        this.inDataBlock = null;
      } else {
        const unescaped = line.startsWith('..') ? line.slice(1) : line;
        const target = this.inDataBlock === 'async' ? this.currentAsyncLines : this.currentReplyLines;
        target.push(unescaped);
      }
      return;
    }

    const match = /^(\d{3})([ +-])(.*)$/.exec(line);
    if (!match) {
      return;
    }

    const code = Number.parseInt(match[1], 10);
    const divider = match[2];
    const text = match[3];

    if (code === 650) {
      this.currentAsyncLines.push(text);
      if (divider === '+') {
        this.inDataBlock = 'async';
      } else if (divider === ' ') {
        const event = parseControlAsyncEvent(this.currentAsyncLines);
        this.currentAsyncLines = [];
        for (const listener of this.eventListeners) {
          listener(event);
        }
      }
      return;
    }

    this.currentReplyLines.push(text);
    if (divider === '+') {
      this.inDataBlock = 'reply';
      return;
    }
    if (divider === ' ') {
      const lines = this.currentReplyLines;
      this.currentReplyLines = [];
      const pending = this.pendingQueue.shift();
      if (!pending) return;

      if (code >= 200 && code < 300) {
        pending.resolve({ code, lines });
      } else {
        pending.reject(new Error(`Tor ControlPort error ${code}: ${lines.join('; ')}`));
      }
    }
  }
}
