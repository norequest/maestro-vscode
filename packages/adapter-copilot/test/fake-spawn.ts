import type { ChildHandle, DataStream, SpawnFn } from "../src/types.js";

class FakeStream implements DataStream {
  private listener?: (chunk: string) => void;
  on(_event: "data", listener: (chunk: Buffer | string) => void): void {
    this.listener = listener as (chunk: string) => void;
  }
  emit(text: string): void {
    this.listener?.(text);
  }
}

export class FakeChild implements ChildHandle {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  killed = false;
  private closeListener?: (code: number | null) => void;
  private errorListener?: (err: Error) => void;

  on(event: "close" | "error", listener: ((code: number | null) => void) & ((err: Error) => void)): void {
    if (event === "close") this.closeListener = listener;
    else this.errorListener = listener;
  }
  kill(): void {
    this.killed = true;
  }

  // Test drivers:
  out(text: string): void {
    this.stdout.emit(text);
  }
  close(code: number | null): void {
    this.closeListener?.(code);
  }
  error(err: Error): void {
    this.errorListener?.(err);
  }
}

/** Build a fake SpawnFn that records args and returns a controllable child. */
export function makeFakeSpawn(): {
  fn: SpawnFn;
  child: () => FakeChild | undefined;
  lastArgs: () => readonly string[] | undefined;
  lastCwd: () => string | undefined;
} {
  let lastChild: FakeChild | undefined;
  let lastArgs: readonly string[] | undefined;
  let lastCwd: string | undefined;
  const fn: SpawnFn = (_command, args, options) => {
    lastArgs = args;
    lastCwd = options.cwd;
    lastChild = new FakeChild();
    return lastChild;
  };
  return { fn, child: () => lastChild, lastArgs: () => lastArgs, lastCwd: () => lastCwd };
}
