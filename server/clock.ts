export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Deterministic controllable clock for backend unit and integration tests.
 */
export class ManualClock implements Clock {
  private currentMs: number;

  constructor(initialMs = Date.now()) {
    this.currentMs = initialMs;
  }

  now(): number {
    return this.currentMs;
  }

  advanceBy(ms: number): void {
    if (ms < 0) {
      throw new Error('Cannot advance ManualClock backwards');
    }
    this.currentMs += ms;
  }

  setNow(ms: number): void {
    this.currentMs = ms;
  }
}
