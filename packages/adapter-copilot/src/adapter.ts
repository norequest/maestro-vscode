import { spawn as nodeSpawn } from "node:child_process";
import type {
  AgentSession,
  EngineAdapter,
  HealthStatus,
  Role,
  Task,
  Workspace,
} from "@hallucinate/core";
import { COPILOT_ENGINE_ID } from "@hallucinate/core";
import { buildAgentArgs, buildArgs, buildFleetArgs, type OutputFormat } from "./args.js";
import { type AgentProfileWriter, ensureCopilotAgent } from "./agent-profile.js";
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
  /**
   * When set, the adapter runs in NATIVE custom-agent mode: it materializes the
   * role into a Copilot `.agent.md` (via this writer) and spawns
   * `copilot --agent <slug> -p "<task>"`, so Copilot recognizes a real named
   * custom agent instead of receiving the persona as a raw prompt. When absent
   * (the default), the legacy inline-preamble behavior is preserved unchanged.
   * Production wires {@link nodeAgentProfileWriter}; tests inject a fake.
   */
  agentProfile?: AgentProfileWriter;
  /**
   * OPT-IN FLEET single-session mode. When `true`, the adapter spawns ONE
   * lead session (`copilot -p "<task verbatim>" --output-format json
   * --no-color`) that runs the roster's named custom agents as in-session
   * sub-agents, and parses their JSONL lifecycle into sub-agent events. The
   * extension supplies the `/fleet ...` text and roster as `task.description`,
   * which is passed VERBATIM. There is deliberately NO `--agent`: Copilot's
   * built-in default dispatcher owns the `task` dispatch tool that `/fleet`
   * drives, whereas a custom lead agent teaches a dead ```delegate
   * convention and never dispatches. Default `false` keeps the per-teammate
   * spawn behavior byte-identical.
   */
  fleet?: boolean;
}

export class CopilotAdapter implements EngineAdapter {
  readonly id = COPILOT_ENGINE_ID;
  readonly capabilities;
  private readonly spawnFn: SpawnFn;
  private readonly env: Record<string, string | undefined>;
  private readonly command: string;
  private readonly outputFormat: OutputFormat;
  private readonly agentProfile?: AgentProfileWriter;
  private readonly fleet: boolean;

  constructor(opts: CopilotAdapterOptions = {}) {
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.env = opts.env ?? process.env;
    this.command = opts.command ?? "copilot";
    this.fleet = opts.fleet ?? false;
    // Fleet mode always streams structured JSONL, so it advertises and parses as
    // a structured-events mode regardless of any `outputFormat` passed.
    this.outputFormat = this.fleet ? "fleet" : (opts.outputFormat ?? "text");
    this.agentProfile = opts.agentProfile;
    this.capabilities = capabilitiesFor(this.outputFormat);
  }

  /**
   * In native mode, materialize the agent file then build `--agent` argv. If
   * materialization fails (fs error), fall back to the inline preamble so a
   * dispatch never breaks just because the agent file could not be written.
   */
  private argvFor(task: Task, workspace: Workspace, role: Role): string[] {
    if (this.fleet) {
      // Fleet mode: pass the `/fleet ...` text VERBATIM via `-p` and let Copilot's
      // built-in default dispatcher (which owns the `task` dispatch tool) run it.
      // No preamble, and deliberately NO `--agent`: a custom lead agent
      // teaches the dead ```delegate convention and `/fleet` never dispatches.
      return buildFleetArgs(task, workspace, role);
    }
    if (this.agentProfile) {
      try {
        const slug = ensureCopilotAgent(this.agentProfile, workspace.path, role, task);
        return buildAgentArgs(task, workspace, role, slug, this.outputFormat);
      } catch {
        return buildArgs(task, workspace, role, this.outputFormat);
      }
    }
    return buildArgs(task, workspace, role, this.outputFormat);
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(resolveAuth(this.env));
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const args = this.argvFor(task, workspace, role);
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
