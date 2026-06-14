import type { AgentSession, EngineAdapter, HealthStatus, Role, Task, Workspace } from "@maestro/core";
import { ACP_CAPABILITIES } from "./capabilities.js";
import { AcpSession } from "./session.js";
import { defaultAcpTransportFn } from "./transport.js";
import type { AcpTransportFn } from "./types.js";

export interface AcpAdapterOptions {
  /**
   * The CLI binary to invoke with `--acp --stdio`. Defaults to "gemini".
   * Pass "copilot" to drive Copilot CLI in ACP mode.
   */
  command?: string;
  /** Injectable for testing; defaults to the real subprocess spawn. */
  transportFn?: AcpTransportFn;
  /** Injectable for testing; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

export class AcpAdapter implements EngineAdapter {
  readonly id = "acp";
  readonly capabilities = ACP_CAPABILITIES;
  private readonly command: string;
  private readonly transportFn: AcpTransportFn;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: AcpAdapterOptions = {}) {
    this.command = opts.command ?? "gemini";
    this.transportFn = opts.transportFn ?? defaultAcpTransportFn;
    this.env = opts.env ?? process.env;
  }

  health(): Promise<HealthStatus> {
    // A real health check would attempt `which <command>` or a dry run. For now
    // we return ok:true so the adapter is usable in tests and in the extension
    // without requiring the CLI to be installed. A live check is a future polish.
    return Promise.resolve({ ok: true, detail: `using command: ${this.command}` });
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const args = ["--acp", "--stdio"];
    if (role.engine.model) {
      args.push("--model", role.engine.model);
    }
    const transport = this.transportFn(this.command, args, {
      cwd: workspace.path,
      env: this.env as NodeJS.ProcessEnv,
    });
    const session = new AcpSession(transport, {
      instructions: role.instructions,
      model: role.engine.model,
      autonomy: role.autonomy,
    });
    session.start(task);
    return session;
  }
}
