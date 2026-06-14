import { spawn } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs a git command. Injected so logic is testable without real git. */
export type GitRunner = (args: readonly string[], opts?: { cwd?: string }) => Promise<GitResult>;

/** Default GitRunner backed by node:child_process. */
export const nodeGitRunner: GitRunner = (args, opts) =>
  new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", [...args], { cwd: opts?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: code ?? 1,
      }),
    );
  });

/**
 * Binaries the shell runner is permitted to spawn. The first element of an
 * args array is treated as the command (see nodeShellRunner), so without this
 * guard a caller-derived first token could spawn an arbitrary binary. Today the
 * only non-git binary Maestro invokes is `gh`.
 */
export const SHELL_RUNNER_ALLOWLIST: readonly string[] = ["gh"];

/**
 * A shell runner for non-git binaries. Spawns the first element of args as the
 * command (unlike nodeGitRunner which always prepends "git"). Defense in depth:
 * the command must be on SHELL_RUNNER_ALLOWLIST, so even a bug that lets an
 * attacker-controlled token reach args[0] cannot spawn an arbitrary binary.
 */
export const nodeShellRunner: GitRunner = (args, opts) => {
  const [cmd, ...rest] = args;
  if (!cmd) return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
  if (!SHELL_RUNNER_ALLOWLIST.includes(cmd)) {
    return Promise.reject(
      new Error(`nodeShellRunner refused to spawn non-allowlisted binary "${cmd}"`),
    );
  }
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn(cmd, rest, { cwd: opts?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: code ?? 1,
      }),
    );
  });
};
