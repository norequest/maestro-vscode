import * as vscode from "vscode";
import { Orchestrator, type Role, type Team } from "@maestro/core";
import { GitWorkspaceManager } from "@maestro/workspace";
import { CopilotAdapter } from "@maestro/adapter-copilot";
import { AcpAdapter } from "@maestro/adapter-acp";
import { createCockpit, type MergeActionMessage } from "./controller.js";
import { RosterTreeDataProvider } from "./roster.js";
import { teamQuickPickItems } from "./team-picker.js";
import { StageWebviewPanel } from "./stage.js";
import { EventLogger } from "./persistence.js";
import { FsPersistenceBackend } from "./persistence-fs.js";
import { loadConductorDir, makeNodeFsReader, scaffoldIfMissing, makeNodeFsWriter, DEFAULT_CONFIG, loadSkills, loadSoul } from "@maestro/config";
import { isKnownEngineId, loadComposerData } from "./composer-data.js";
import { makeConfigGateway, makeAnatomyGateway } from "./config-gateway.js";
import { LibraryWebviewPanel } from "./library.js";
import { AnatomyWebviewPanel } from "./anatomy.js";

const DEFAULT_ROLE: Role = {
  name: "Implementer",
  instructions: "You are an implementer. Make the requested change in this worktree.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

const NO_FOLDER_MESSAGE =
  "Maestro needs an open folder (a git repo) to conduct agents. Open a folder, then try again.";

/**
 * The folder-dependent wiring built by {@link setupConducting}. Command handlers
 * close over a single `Conducting | undefined` so they keep working whether or
 * not a folder is open: with no folder the handlers warn instead of throwing.
 */
interface Conducting {
  readonly repoRoot: string;
  readonly orch: Orchestrator;
  readonly workspaces: GitWorkspaceManager;
  readonly cockpit: ReturnType<typeof createCockpit>;
  readonly stage: StageWebviewPanel;
  readonly library: LibraryWebviewPanel;
  readonly anatomy: AnatomyWebviewPanel;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // The Roster tree and every command MUST register unconditionally, before any
  // folder check. The contributed commands (and the view-title `+` button) are
  // visible the moment the extension activates, which now happens eagerly at
  // startup, possibly with no workspace folder open. Registering them here means
  // `command 'maestro.spawnAgent' not found` can never happen; the folder-gated
  // work lives in setupConducting() and the handlers warn until it exists.
  const roster = new RosterTreeDataProvider();

  // The single piece of folder-dependent state. Reassigned by setupConducting();
  // read by every command handler to decide between acting and warning. The
  // Stage webview lives inside it so it shares the conducting lifecycle.
  let conducting: Conducting | undefined;

  /**
   * Build all folder-dependent objects (workspaces, orchestrator, adapters,
   * cockpit, persistence) for the given repo root and store them in the
   * `conducting` closure variable. Idempotent: a second call while conducting is
   * already set up is a no-op, so the onDidChangeWorkspaceFolders handler and the
   * activate-time call can both invoke it safely.
   */
  async function setupConducting(repoRoot: string): Promise<void> {
    if (conducting) return;

    const eventLogger = new EventLogger(new FsPersistenceBackend(repoRoot));

    // Honor .conductor/config.yaml's maxParallelAgents. Best-effort: any load
    // failure (missing dir, unreadable config, parse error) falls back to
    // DEFAULT_CONFIG so a bad config never blocks setup. The lazy role loader in
    // spawnAgent re-reads .conductor/ at spawn time; this read is config-only.
    let orchConfig = DEFAULT_CONFIG;
    try {
      const fsReader = await makeNodeFsReader();
      const loaded = await loadConductorDir(repoRoot, fsReader);
      orchConfig = loaded.config ?? DEFAULT_CONFIG;
    } catch {
      orchConfig = DEFAULT_CONFIG;
    }

    const workspaces = new GitWorkspaceManager({ repoRoot });
    const orch = new Orchestrator(orchConfig, workspaces);
    orch.registerAdapter(new CopilotAdapter());
    // Register the generic ACP adapter (Gemini CLI in --acp --stdio mode). With
    // no approval UI yet (M6), an ACP-targeted role should use an auto-approving
    // autonomy. No ACP role is seeded in M5; this registration is forward-compat.
    orch.registerAdapter(new AcpAdapter({ command: "gemini" }));
    orch.registerRole(DEFAULT_ROLE);

    // P4: inject preamble resolver so soul+skills are threaded onto the task at spawn time.
    // Core stays pure (no fs/config imports in @maestro/core). The resolver is extension-local.
    orch.setPreambleResolver(async (role) => {
      const reader = await makeNodeFsReader();
      const skillsResult = await loadSkills(repoRoot, reader).catch(() => ({ bodies: new Map<string, string>() }));
      const skillBodies = (role.skills ?? [])
        .map((n) => skillsResult.bodies.get(n))
        .filter((b): b is string => typeof b === "string");
      let soulDoc;
      if (role.soul) {
        const s = await loadSoul(repoRoot, role.soul, reader).catch(() => null);
        if (s && "soul" in s) soulDoc = s.soul;
      }
      return {
        soulDoc,
        ...(skillBodies.length ? { skillBodies } : {}),
      };
    });

    const prModeEnabled = (): boolean =>
      vscode.workspace.getConfiguration("maestro").get<boolean>("prMode", false);

    // Typed as the WebviewToHost merge-action subset (not a widened {type:
    // string}), so agentId is known-present and a renamed variant is a compile
    // error.
    const handleMergeAction = async (msg: MergeActionMessage): Promise<void> => {
      const agent = orch.getAgent(msg.agentId);
      if (!agent) return;
      if (msg.type === "resolve-conflict") {
        const files = agent.conflict?.files ?? [];
        const { conflictFileBase, buildConflictResolveMessage } = await import("./merge-helpers.js");
        const base = conflictFileBase(agent);
        if (!base) {
          // No worktree on disk: opening repo-root copies would show marker-free
          // files. Warn instead of opening the wrong copy.
          void vscode.window.showWarningMessage(
            "Maestro: cannot open conflict files (the agent's worktree is unavailable). Resolve the merge manually.",
          );
          return;
        }
        for (const relPath of files) {
          // Conflict markers live in the agent's worktree, not the main repo root.
          const uri = vscode.Uri.joinPath(vscode.Uri.file(base), relPath);
          await vscode.commands.executeCommand("vscode.open", uri);
        }
        void vscode.window.showInformationMessage(buildConflictResolveMessage(files));
      } else if (msg.type === "finish-merge") {
        try {
          const result = await workspaces.resolveMerge(agent.id);
          if (result.status === "clean") {
            await workspaces.cleanup(agent.id);
            orch.finishConflictResolution(agent.id);
          } else {
            void vscode.window.showWarningMessage(
              `Still unresolved: ${result.files.join(", ")}. Fix all markers and click Finish Merge again.`,
            );
          }
        } catch (err) {
          void vscode.window.showErrorMessage(`Finish merge failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (msg.type === "create-pr") {
        if (!prModeEnabled()) {
          void vscode.window.showInformationMessage("PR mode is off. Enable maestro.prMode in settings.");
          return;
        }
        const { buildPrTitle, buildPrBody, markPrCreatedAfterPush } = await import("./merge-helpers.js");
        try {
          const result = await workspaces.pushAndPr(agent.id, {
            title: buildPrTitle(agent.role.name, agent.task.description),
            body: buildPrBody(agent.summary, agent.diff?.files ?? []),
            base: "main",
            remote: "origin",
            draft: vscode.workspace.getConfiguration("maestro").get<boolean>("prDraft", false),
          });
          void vscode.window.showInformationMessage(`PR created: ${result.prUrl}`);
          // The PR is open. Move the card to the terminal "pr-created" state via
          // the core: this releases the worktree but KEEPS the branch (the PR
          // needs its commits). markPrCreated emits the terminal agent-updated
          // event, so the cockpit re-renders on its own (no manual "ready" push
          // needed). pushAndPr itself stays here because it needs vscode.workspace;
          // the post-push transition is the pure, unit-tested seam.
          await markPrCreatedAfterPush(orch, agent.id);
        } catch (err) {
          void vscode.window.showErrorMessage(`Create PR failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    const stage = new StageWebviewPanel(context.extensionUri, (msg) => {
      // Engine-allowlist boundary guard (R6): refuse a dispatch carrying an engine
      // not in KNOWN_ENGINE_IDS before it reaches the orchestrator. This prevents a
      // tampered webview from injecting an arbitrary binary as an engine.
      if (msg.type === "dispatch" && msg.engineId !== undefined && !isKnownEngineId(msg.engineId)) {
        void vscode.window.showWarningMessage(`Maestro: refused dispatch to unknown engine "${msg.engineId}".`);
        return;
      }
      cockpit.handle(msg);
    });

    const cockpit = createCockpit(
      orch,
      (state) => {
        roster.update(state);
        stage.post(state);
      },
      (message) => void vscode.window.showErrorMessage(`Maestro: ${message}`),
      handleMergeAction,
    );

    // Persistence (M7): restore the previous session, then log all future events.
    // The logger subscribes AFTER hydrate so the events hydrate() re-emits are not
    // re-persisted (which would grow the on-disk log on every reload). The cockpit
    // is already subscribed via createCockpit above, so hydrate's events rebuild
    // the card set.
    void (async () => {
      try {
        const records = await eventLogger.loadAll();
        if (records.length > 0) orch.hydrate(records);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showWarningMessage(`Maestro: could not restore previous session: ${message}`);
      }
      // A SINGLE subscription persists every event and forgets on terminal
      // states. EventLogger serializes write/forget per agent id, so the forget
      // always runs after any pending write (no ghost-log resurrection race) and
      // a write arriving after forget for a terminal id is dropped.
      //
      // Note: a `.conductor/.runtime/<id>.jsonl` log may contain sensitive agent
      // scrollback (model output, tool I/O). The directory is gitignored; it is
      // local-only and removed on merge/discard.
      const unsubPersist = orch.on((event) => {
        eventLogger.write(event);
        if (
          event.kind === "agent-updated" &&
          (event.agent.state === "merged" || event.agent.state === "discarded")
        ) {
          void eventLogger.forget(event.agent.id);
        }
      });
      context.subscriptions.push({ dispose: () => { unsubPersist(); } });
    })();

    context.subscriptions.push({ dispose: () => cockpit.dispose() });

    const gateway = makeConfigGateway(repoRoot);
    const library = new LibraryWebviewPanel(context.extensionUri, gateway);
    const anatomyGateway = makeAnatomyGateway(repoRoot);
    const anatomy = new AnatomyWebviewPanel(context.extensionUri, anatomyGateway);
    conducting = { repoRoot, orch, workspaces, cockpit, stage, library, anatomy };
  }

  // Commands and the tree view register unconditionally. Handlers below read the
  // `conducting` closure var; when it is undefined (no folder) they warn instead
  // of throwing.
  context.subscriptions.push(
    roster,
    vscode.window.registerTreeDataProvider("maestro.roster", roster),
    vscode.commands.registerCommand("maestro.openStage", () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      conducting.stage.reveal();
    }),
    vscode.commands.registerCommand("maestro.openLibrary", () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      conducting.library.reveal();
    }),
    vscode.commands.registerCommand("maestro.openAnatomy", async () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      const { repoRoot, anatomy } = conducting;

      const fsReader = await makeNodeFsReader();
      const loaded = await loadConductorDir(repoRoot, fsReader).catch(() => null);

      if (!loaded || loaded.roles.length === 0) {
        void vscode.window.showInformationMessage("Maestro: no roles defined in .conductor/roles/.");
        return;
      }

      if (loaded.errors.length > 0) {
        const msgs = loaded.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
        void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
      }

      let selectedRole: Role;
      if (loaded.roles.length === 1) {
        selectedRole = loaded.roles[0]!;
      } else {
        const picks = loaded.roles.map((r) => ({
          label: r.name,
          description: `${r.engine.id} · ${r.autonomy}`,
          role: r,
        }));
        const picked = await vscode.window.showQuickPick(picks, {
          title: "Select a role to edit",
          placeHolder: "Role",
        });
        if (!picked) return;
        selectedRole = picked.role;
      }

      await anatomy.open(selectedRole.name);
    }),
    vscode.commands.registerCommand("maestro.focusAgent", (agentId?: string) => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      conducting.stage.reveal();
      if (agentId) conducting.cockpit.handle({ type: "focus", agentId });
    }),
    vscode.commands.registerCommand("maestro.newAgent", async () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      const { repoRoot, stage } = conducting;
      const fsReader = await makeNodeFsReader();
      const data = await loadComposerData(repoRoot, fsReader).catch(() => ({
        roles: [],
        teams: [],
        errors: [] as Array<{ source: string; errors: string[] }>,
      }));
      if (data.errors.length > 0) {
        const msgs = data.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
        void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
      }
      const { composerOptions } = await import("@maestro/cockpit");
      stage.reveal();
      stage.postComposer(composerOptions(data.roles, data.teams));
    }),
    vscode.commands.registerCommand("maestro.spawnAgent", async () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      const { repoRoot, orch, cockpit, stage } = conducting;

      // First-run: scaffold .conductor/ if absent (non-fatal on failure).
      const fsWriter = await makeNodeFsWriter();
      await scaffoldIfMissing(repoRoot, fsWriter).catch(() => false);

      // Load roles from .conductor/.
      const fsReader = await makeNodeFsReader();
      const loaded = await loadConductorDir(repoRoot, fsReader).catch(() => null);

      let selectedRole = DEFAULT_ROLE;

      if (loaded && loaded.roles.length > 0) {
        if (loaded.errors.length > 0) {
          const msgs = loaded.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
          void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
        }
        if (loaded.roles.length === 1) {
          selectedRole = loaded.roles[0]!;
        } else {
          const picks = loaded.roles.map((r) => ({
            label: r.name,
            description: `${r.engine.id} · ${r.autonomy}`,
            role: r,
          }));
          const picked = await vscode.window.showQuickPick(picks, {
            title: "Select a role for this agent",
            placeHolder: "Role",
          });
          if (!picked) return;
          selectedRole = picked.role;
        }
      }

      const description = await vscode.window.showInputBox({
        prompt: `Task for ${selectedRole.name}`,
        placeHolder: "e.g. Add a --version flag to the CLI",
      });
      if (!description) return;

      const goal = await vscode.window.showInputBox({
        prompt: `Goal for ${selectedRole.name} (the why; optional)`,
        placeHolder: "so that the refactor cannot silently break checkout",
      });
      // goal === undefined means escaped; "" means confirmed-empty. Treat empty as no goal.

      // Register the selected role (idempotent: overwrites by name). Handles roles
      // loaded from YAML that were not pre-registered at setup time.
      orch.registerRole(selectedRole);

      stage.reveal();
      try {
        cockpit.handle({ type: "spawn", roleName: selectedRole.name, description, ...(goal ? { goal } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Maestro: could not spawn agent: ${message}`);
      }
    }),
    vscode.commands.registerCommand("maestro.launchTeam", async () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      const { repoRoot, orch, stage } = conducting;

      // Load teams from .conductor/teams/. Mirror spawnAgent: same fsReader,
      // same repoRoot, same error-surfacing.
      const fsReader = await makeNodeFsReader();
      const loaded = await loadConductorDir(repoRoot, fsReader).catch(() => null);

      if (!loaded || loaded.teams.length === 0) {
        void vscode.window.showInformationMessage("Maestro: no teams defined in .conductor/teams/.");
        return;
      }

      if (loaded.errors.length > 0) {
        const msgs = loaded.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
        void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
      }

      const items = teamQuickPickItems(loaded.teams);
      let selectedTeam: Team;
      if (items.length === 1) {
        // Auto-select the sole team (mirrors spawnAgent's single-role path).
        selectedTeam = items[0]!.team;
      } else {
        const picked = await vscode.window.showQuickPick(items, {
          title: "Select a team to dispatch",
          placeHolder: "Team",
        });
        if (!picked) return;
        selectedTeam = picked.team;
      }

      const description = await vscode.window.showInputBox({
        prompt: `Task for team ${selectedTeam.name}`,
        placeHolder: "What should this team work on?",
      });
      if (!description) return;

      stage.reveal();
      try {
        orch.launchTeam(selectedTeam, description);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Maestro: could not launch team: ${message}`);
      }
    }),
  );

  // If a folder is already open, wire up conducting now (the normal case). If
  // not, the commands above are still registered; they warn until a folder opens.
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    await setupConducting(folder.uri.fsPath);
  }

  // When a folder later becomes available (the user opens one into an empty
  // window), wire up conducting then. setupConducting is idempotent, so this is
  // safe even if a folder was already present.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (conducting) return;
      const next = vscode.workspace.workspaceFolders?.[0];
      if (next) void setupConducting(next.uri.fsPath);
    }),
  );
}

export function deactivate(): void {
  // no-op; subscriptions dispose the cockpit
}
