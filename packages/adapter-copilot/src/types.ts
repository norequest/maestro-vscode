/** A readable stream we only ever attach a "data" listener to. */
export interface DataStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

/** Minimal handle over a spawned child process. Node's ChildProcess satisfies this. */
export interface ChildHandle {
  readonly stdout: DataStream;
  readonly stderr: DataStream;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

/** The shape of `node:child_process.spawn`, narrowed for injection and faking. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => ChildHandle;
