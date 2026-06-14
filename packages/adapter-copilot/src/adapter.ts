import { spawn as nodeSpawn } from "node:child_process";
import type {
  AgentSession,
  EngineAdapter,
  HealthStatus,
  Role,
  Task,
  Workspace,
} from "@maestro/core";
import { buildArgs } from "./args.js";
import { resolveAuth } from "./auth.js";
import { COPILOT_CAPABILITIES } from "./capabilities.js";
import { CopilotSession } from "./copilot-session.js";
import type { ChildHandle, SpawnFn } from "./types.js";

/** Default: spawn the real `copilot` binary with piped stdio. The cast bridges
 *  Node's ChildProcess (nullable stdio) to our ChildHandle at the boundary. */
const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildHandle;

export interface CopilotAdapterOptions {
  /** Injectable for testing; defaults to node:child_process.spawn. */
  spawn?: SpawnFn;
  /** Injectable for testing; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** The binary name; defaults to "copilot". */
  command?: string;
}

export class CopilotAdapter implements EngineAdapter {
  readonly id = "copilot";
  readonly capabilities = COPILOT_CAPABILITIES;
  private readonly spawnFn: SpawnFn;
  private readonly env: Record<string, string | undefined>;
  private readonly command: string;

  constructor(opts: CopilotAdapterOptions = {}) {
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.env = opts.env ?? process.env;
    this.command = opts.command ?? "copilot";
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(resolveAuth(this.env));
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const args = buildArgs(task, workspace, role);
    const child = this.spawnFn(this.command, args, {
      cwd: workspace.path,
      env: this.env as NodeJS.ProcessEnv,
    });
    const session = new CopilotSession(child);
    session.start();
    return session;
  }
}
