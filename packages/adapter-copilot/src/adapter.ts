import { spawn as nodeSpawn } from "node:child_process";
import type {
  AgentSession,
  EngineAdapter,
  HealthStatus,
  Role,
  Task,
  Workspace,
} from "@maestro/core";
import { buildArgs, type OutputFormat } from "./args.js";
import { resolveAuth } from "./auth.js";
import { capabilitiesFor } from "./capabilities.js";
import { CopilotSession } from "./copilot-session.js";
import type { ChildHandle, SpawnFn } from "./types.js";

/** Default: spawn the real `copilot` binary with piped stdio. Node types
 *  stdout/stderr as `Readable | null`, so we narrow them before crossing into
 *  ChildHandle (whose streams are non-null) instead of laundering with a double
 *  cast that a single `stdio` edit could silently break. */
const defaultSpawn: SpawnFn = (command, args, options) => {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.stdout || !child.stderr) {
    throw new Error("copilot: stdio streams not piped");
  }
  return child as ChildHandle;
};

/** Drop keys whose value is `undefined` so spawn never receives undefined-valued
 *  env entries. All defined vars are forwarded unchanged (no allowlist that
 *  could strip the auth token). */
function definedEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface CopilotAdapterOptions {
  /** Injectable for testing; defaults to node:child_process.spawn. */
  spawn?: SpawnFn;
  /** Injectable for testing; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** The binary name; defaults to "copilot". */
  command?: string;
  /**
   * OPT-IN structured-events mode. `"text"` (default) keeps the v1 plain-text
   * stream unchanged; `"json"` adds `--output-format json` and parses the
   * structured stream into formatted output events. The exact CLI JSON schema
   * is not confirmed, so json mode degrades gracefully per line; see
   * {@link renderJsonLine}.
   */
  outputFormat?: OutputFormat;
}

export class CopilotAdapter implements EngineAdapter {
  readonly id = "copilot";
  readonly capabilities;
  private readonly spawnFn: SpawnFn;
  private readonly env: Record<string, string | undefined>;
  private readonly command: string;
  private readonly outputFormat: OutputFormat;

  constructor(opts: CopilotAdapterOptions = {}) {
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.env = opts.env ?? process.env;
    this.command = opts.command ?? "copilot";
    this.outputFormat = opts.outputFormat ?? "text";
    this.capabilities = capabilitiesFor(this.outputFormat);
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(resolveAuth(this.env));
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const args = buildArgs(task, workspace, role, this.outputFormat);
    const child = this.spawnFn(this.command, args, {
      cwd: workspace.path,
      env: definedEnv(this.env),
    });
    if (!child.stdout || !child.stderr) {
      throw new Error("copilot: stdio streams not piped");
    }
    const session = new CopilotSession(child, { outputFormat: this.outputFormat });
    session.start();
    return session;
  }
}
