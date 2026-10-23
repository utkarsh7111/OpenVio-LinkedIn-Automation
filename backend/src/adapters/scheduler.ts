export interface SchedulerAdapter {
  start(): void;
  stop(): void;
  stopAndWait(): Promise<void>;
  runOnce(): Promise<boolean>;
  readonly running: boolean;
}

export interface CreateSchedulerAdapterOptions {
  processDuePosts: () => Promise<unknown>;
  intervalSeconds: number;
}

/** OpenVio replaces this interval runner with its own scheduled job platform. */
export function createSchedulerAdapter({ processDuePosts, intervalSeconds }: CreateSchedulerAdapterOptions): SchedulerAdapter {
  if (typeof processDuePosts !== 'function') throw new TypeError('processDuePosts must be a function');
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) throw new TypeError('intervalSeconds must be a positive integer');
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  async function runOnce(): Promise<boolean> {
    if (running) return false;
    running = true;
    try {
      await processDuePosts();
      return true;
    } catch (error: any) {
      console.error(JSON.stringify({ event: 'scheduler_run_failed', errorType: error?.name ?? 'Error' }));
      return false;
    } finally {
      running = false;
    }
  }
  return Object.freeze({
    start() {
      if (timer) return;
      timer = setInterval(runOnce, intervalSeconds * 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    async stopAndWait(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = undefined;
      while (running) await new Promise((resolve) => setTimeout(resolve, 5));
    },
    runOnce,
    get running() {
      return running;
    },
  });
}
