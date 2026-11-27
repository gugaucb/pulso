export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, Math.max(0, delayMs)),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface ScheduledTimer {
  id: number;
  fireAt: number;
  callback: () => void;
}

/**
 * Deterministic controllable clock for backend unit and integration tests.
 */
export class ManualClock implements Clock {
  private currentMs: number;
  private nextTimerId = 1;
  private readonly timers = new Map<number, ScheduledTimer>();

  constructor(initialMs = Date.now()) {
    this.currentMs = initialMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextTimerId++;
    const fireAt = this.currentMs + Math.max(0, delayMs);
    this.timers.set(id, { id, fireAt, callback });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    if (typeof handle === 'number') {
      this.timers.delete(handle);
    }
  }

  advanceBy(ms: number): void {
    if (ms < 0) {
      throw new Error('Cannot advance ManualClock backwards');
    }
    this.flushTimersUntil(this.currentMs + ms);
  }

  setNow(ms: number): void {
    if (ms >= this.currentMs) {
      this.flushTimersUntil(ms);
      return;
    }
    this.currentMs = ms;
  }

  private flushTimersUntil(targetMs: number): void {
    while (true) {
      let earliest: ScheduledTimer | null = null;
      for (const timer of this.timers.values()) {
        if (timer.fireAt <= targetMs && (!earliest || timer.fireAt < earliest.fireAt || (timer.fireAt === earliest.fireAt && timer.id < earliest.id))) {
          earliest = timer;
        }
      }
      if (!earliest) break;
      this.timers.delete(earliest.id);
      if (earliest.fireAt > this.currentMs) {
        this.currentMs = earliest.fireAt;
      }
      earliest.callback();
    }
    this.currentMs = targetMs;
  }
}
