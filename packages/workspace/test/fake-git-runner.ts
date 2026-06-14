import type { GitResult, GitRunner } from "../src/git-runner.js";

export interface FakeGitCall {
  args: readonly string[];
  cwd?: string;
}

/**
 * Fake GitRunner. `responses` maps a key (the joined args, or a prefix you
 * register) to a scripted result. Records every call for assertions.
 */
export function makeFakeGitRunner(
  responses: Array<{ match: (args: readonly string[]) => boolean; result: Partial<GitResult> }> = [],
): { runner: GitRunner; calls: FakeGitCall[] } {
  const calls: FakeGitCall[] = [];
  const runner: GitRunner = (args, opts) => {
    calls.push({ args, cwd: opts?.cwd });
    const hit = responses.find((r) => r.match(args));
    return Promise.resolve({
      stdout: hit?.result.stdout ?? "",
      stderr: hit?.result.stderr ?? "",
      exitCode: hit?.result.exitCode ?? 0,
    });
  };
  return { runner, calls };
}

/** Match helper: args start with this prefix. */
export const startsWith =
  (...prefix: string[]) =>
  (args: readonly string[]): boolean =>
    prefix.every((p, i) => args[i] === p);
