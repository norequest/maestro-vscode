import * as vscode from "vscode";
import { Orchestrator, type Role } from "@maestro/core";
import { GitWorkspaceManager } from "@maestro/workspace";
import { CopilotAdapter } from "@maestro/adapter-copilot";
import { AcpAdapter } from "@maestro/adapter-acp";
import { createCockpit } from "./controller.js";
import { RosterTreeDataProvider } from "./roster.js";
import { StageWebviewPanel } from "./stage.js";
import { EventLogger } from "./persistence.js";
import { FsPersistenceBackend } from "./persistence-fs.js";
import { loadConductorDir, makeNodeFsReader, scaffoldIfMissing, makeNodeFsWriter } from "@maestro/config";

const DEFAULT_ROLE: Role = {
  name: "Implementer",
  instructions: "You are an implementer. Make the requested change in this worktree.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage("Maestro needs an open folder (a git repo) to conduct agents.");
    return;
  }
  const repoRoot = folder.uri.fsPath;

  const eventLogger = new EventLogger(new FsPersistenceBackend(repoRoot));

  const workspaces = new GitWorkspaceManager({ repoRoot });
  const orch = new Orchestrator({ maxParallelAgents: 3 }, workspaces);
  orch.registerAdapter(new CopilotAdapter());
  // Register the generic ACP adapter (Gemini CLI in --acp --stdio mode). With
  // no approval UI yet (M6), an ACP-targeted role should use an auto-approving
  // autonomy. No ACP role is seeded in M5; this registration is forward-compat.
  orch.registerAdapter(new AcpAdapter({ command: "gemini" }));
  orch.registerRole(DEFAULT_ROLE);

  const roster = new RosterTreeDataProvider();
  const stage = new StageWebviewPanel(context.extensionUri, (msg) => cockpit.handle(msg));

  const prModeEnabled = (): boolean =>
    vscode.workspace.getConfiguration("maestro").get<boolean>("prMode", false);

  const handleMergeAction = async (msg: { type: string; agentId?: string }): Promise<void> => {
    if (!msg.agentId) return;
    const agent = orch.getAgent(msg.agentId);
    if (!agent) return;
    if (msg.type === "resolve-conflict") {
      const files = agent.conflict?.files ?? [];
      for (const relPath of files) {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(repoRoot), relPath);
        await vscode.commands.executeCommand("vscode.open", uri);
      }
      const { buildConflictResolveMessage } = await import("./merge-helpers.js");
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
      const { buildPrTitle, buildPrBody } = await import("./merge-helpers.js");
      try {
        const result = await workspaces.pushAndPr(agent.id, {
          title: buildPrTitle(agent.role.name, agent.task.description),
          body: buildPrBody(agent.summary, agent.diff?.files ?? []),
          base: "main",
          remote: "origin",
          draft: vscode.workspace.getConfiguration("maestro").get<boolean>("prDraft", false),
        });
        void vscode.window.showInformationMessage(`PR created: ${result.prUrl}`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Create PR failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

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
    const unsubPersist = orch.on((event) => eventLogger.write(event));
    const unsubForget = orch.on((event) => {
      if (
        event.kind === "agent-updated" &&
        (event.agent.state === "merged" || event.agent.state === "discarded")
      ) {
        void eventLogger.forget(event.agent.id);
      }
    });
    context.subscriptions.push({ dispose: () => { unsubPersist(); unsubForget(); } });
  })();

  context.subscriptions.push(
    roster,
    vscode.window.registerTreeDataProvider("maestro.roster", roster),
    vscode.commands.registerCommand("maestro.openStage", () => stage.reveal()),
    vscode.commands.registerCommand("maestro.focusAgent", (agentId?: string) => {
      stage.reveal();
      if (agentId) cockpit.handle({ type: "focus", agentId });
    }),
    vscode.commands.registerCommand("maestro.spawnAgent", async () => {
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

      // Register the selected role (idempotent: overwrites by name). Handles roles
      // loaded from YAML that were not pre-registered at activate time.
      orch.registerRole(selectedRole);

      stage.reveal();
      try {
        cockpit.handle({ type: "spawn", roleName: selectedRole.name, description });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Maestro: could not spawn agent: ${message}`);
      }
    }),
    { dispose: () => cockpit.dispose() },
  );
}

export function deactivate(): void {
  // no-op; subscriptions dispose the cockpit
}
