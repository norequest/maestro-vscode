import * as vscode from "vscode";
import { Orchestrator, type Role } from "@maestro/core";
import { GitWorkspaceManager } from "@maestro/workspace";
import { CopilotAdapter } from "@maestro/adapter-copilot";
import { AcpAdapter } from "@maestro/adapter-acp";
import { createCockpit } from "./controller.js";
import { RosterTreeDataProvider } from "./roster.js";
import { StageWebviewPanel } from "./stage.js";

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

  const cockpit = createCockpit(
    orch,
    (state) => {
      roster.update(state);
      stage.post(state);
    },
    (message) => void vscode.window.showErrorMessage(`Maestro: ${message}`),
  );

  context.subscriptions.push(
    roster,
    vscode.window.registerTreeDataProvider("maestro.roster", roster),
    vscode.commands.registerCommand("maestro.openStage", () => stage.reveal()),
    vscode.commands.registerCommand("maestro.focusAgent", (agentId?: string) => {
      stage.reveal();
      if (agentId) cockpit.handle({ type: "focus", agentId });
    }),
    vscode.commands.registerCommand("maestro.spawnAgent", async () => {
      const description = await vscode.window.showInputBox({
        prompt: "Task for the agent",
        placeHolder: "e.g. Add a --version flag to the CLI",
      });
      if (!description) return;
      stage.reveal();
      try {
        cockpit.handle({ type: "spawn", roleName: DEFAULT_ROLE.name, description });
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
