// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseControlAsyncEvent } from './controlProtocol';

describe('parseControlAsyncEvent STATUS_CLIENT fields', () => {
  it('parses TAG, SUMMARY, and PROGRESS from NOTICE BOOTSTRAP events including PT phases', () => {
    expect(
      parseControlAsyncEvent([
        'STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=5 TAG=conn_pt SUMMARY="Connecting to pluggable transport"',
      ]),
    ).toEqual({
      type: 'status_client',
      severity: 'NOTICE',
      action: 'BOOTSTRAP',
      progress: 5,
      tag: 'conn_pt',
      summary: 'Connecting to pluggable transport',
    });

    expect(
      parseControlAsyncEvent([
        'STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=10 TAG=handshake_pt SUMMARY="Handshaking with pluggable transport"',
      ]),
    ).toEqual({
      type: 'status_client',
      severity: 'NOTICE',
      action: 'BOOTSTRAP',
      progress: 10,
      tag: 'handshake_pt',
      summary: 'Handshaking with pluggable transport',
    });
  });

  it('parses REASON and quoted/escaped SUMMARY from WARN BOOTSTRAP events', () => {
    expect(
      parseControlAsyncEvent([
        'STATUS_CLIENT WARN BOOTSTRAP PROGRESS=14 TAG=conn_pt SUMMARY="Connecting to \\"relay\\" failed" REASON=NOROUTE WARNING="No route to host"',
      ]),
    ).toEqual({
      type: 'status_client',
      severity: 'WARN',
      action: 'BOOTSTRAP',
      progress: 14,
      tag: 'conn_pt',
      summary: 'Connecting to "relay" failed',
      reason: 'NOROUTE',
    });
  });
});
