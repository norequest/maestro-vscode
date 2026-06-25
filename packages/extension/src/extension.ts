import * as vscode from "vscode";
import { Orchestrator, type EngineAdapter, type Role, type Team } from "@maestro/core";
import { GitWorkspaceManager } from "@maestro/workspace";
import { CopilotAdapter, nodeAgentProfileWriter, slugForRole, buildAgentProfile } from "@maestro/adapter-copilot";
import { AcpAdapter } from "@maestro/adapter-acp";
import { createCockpit, type MergeActionMessage } from "./controller.js";
import { teamQuickPickItems } from "./team-picker.js";
import { StageWebviewPanel } from "./stage.js";
import { EventLogger } from "./persistence.js";
import { FsPersistenceBackend } from "./persistence-fs.js";
import { loadConductorDir, makeNodeFsReader, scaffoldIfMissing, ensureVendoredSkills, makeNodeFsWriter, DEFAULT_CONFIG, discoverWorkspace, discoverPlugins as discoverPluginsFn } from "@maestro/config";
import type { McpInventory } from "@maestro/config";
import { isKnownEngineId, loadComposerData } from "./composer-data.js";
import { prepareSavedRoleDispatch } from "./dispatch-prep.js";
import { launchConductorTeam } from "./default-team.js";
import { FLEET_ENGINE_ID, launchFleetTeam, usesFleet } from "./fleet-team.js";
import { applyDefaults } from "./config-defaults.js";
import { resolveRolePreamble, syncRepoCopilotAgent } from "./copilot-agent-sync.js";
import { makeConfigGateway, makeAnatomyGateway } from "./config-gateway.js";
import { createLibrary } from "./library-controller.js";
import { createAnatomyController } from "./anatomy-controller.js";
import { buildDraftAnatomyVM } from "./anatomy-draft.js";
import { makeAppRouter } from "./app-router.js";
import { registerMaestroHomeView } from "./home-view.js";
import { type WebviewToHost } from "@maestro/cockpit";
import type { AppToHost } from "./app-protocol.js";

/**
 * Get the HEAD SHA of the repo at the given root. Returns undefined when git
 * is unavailable or the directory is not a repo.
 */
async function getHeadSha(repoRoot: string): Promise<string | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

const DEFAULT_ROLE: Role = {
  name: "Implementer",
  instructions: "You are an implementer. Make the requested change in this worktree.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

/**
 * The single conductor (lead) persona. It ALWAYS leads a team run, scoped to that
 * team's roster of specialists. A team is just a scoped roster of specialists the
 * conductor may load as sub-agents; a team never promotes one of its own roles to
 * lead. The conductor does the glue work itself and delegates the specialized
 * parts by smart triage.
 *
 * A THIN lead persona: just the name + its orchestration instructions. The richer
 * coordination reference (the three vendored coordination skills) is NO LONGER
 * hardcoded here; it now rides in via the config-driven default layer
 * (`defaults.leadSkills` in .conductor/config.yaml, with the three coordination
 * skills as the fallback for legacy dirs). setDefaults composes leadSkills into the
 * lead ONLY, so the playbook reaches the conductor without this role naming it. The
 * skill bodies are scaffolded into .github/skills/<name>/SKILL.md on first
 * launch; a missing file is tolerated by the preamble resolver (it is simply
 * omitted), so a not-yet-scaffolded skill degrades gracefully rather than blocking
 * a launch.
 */
const CONDUCTOR_ROLE: Role = {
  name: "Conductor",
  instructions:
    "You are the conductor, the default agent leading this run. Do the glue work " +
    "yourself: read the task, plan it, and make the straightforward changes directly. " +
    "Delegate the specialized parts to your sub-agents by smart triage, bringing in " +
    "the right specialist for the right slice rather than doing everything alone. You " +
    "have a scoped roster of specialists to draw on; delegate to them, then integrate " +
    "their work.",
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
  /** The single "Conducting Board" panel hosting board/library/anatomy/review. */
  readonly stage: StageWebviewPanel;
  /** Open the anatomy editor for a role (resolves + builds the VM, then navigates). */
  readonly openAnatomy: (roleName: string) => Promise<void>;
  /**
   * Load .conductor/teams/, resolve a team (by name when given, else via a
   * quick-pick), prompt for a task, and launch it. Shared by the
   * maestro.launchTeam command and the Library "Launch team" button.
   */
  readonly launchTeamByName: (name?: string) => Promise<void>;
  /** The single inbound dispatcher; reused by commands that need to drive a controller. */
  readonly routeAppMessage: (msg: AppToHost) => void;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Every command MUST register unconditionally, before any folder check. The
  // contributed commands are visible the moment the extension activates, which
  // happens eagerly at startup, possibly with no workspace folder open.
  // Registering them here means `command 'maestro.openStage' not found` can never
  // happen; the folder-gated work lives in setupConducting() and the handlers
  // warn until it exists. The Conducting Board (Stage) is the hero surface: it
  // auto-opens once a folder is wired up (see the end of setupConducting). There
  // is no roster tree; the board is the entry point.

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

    // Ensure the vendored coordination skills exist under .github/skills/ at
    // activation. scaffoldIfMissing writes them only on a fresh tree; a workspace
    // that already has a .conductor/ never gets them otherwise, so the lead's
    // leadSkills would resolve to nothing and fall back to prompt text. Doing this
    // at activation means the skills appear on disk without requiring a team
    // launch. Best-effort: a failure here must never block setup.
    try {
      const fsWriter = await makeNodeFsWriter();
      const added = await ensureVendoredSkills(repoRoot, fsWriter);
      if (added.length > 0) {
        console.log(`Maestro: added vendored coordination skills: ${added.join(", ")}.`);
      }
    } catch (err) {
      console.warn("Maestro: could not ensure vendored skills.", err);
    }

    const workspaces = new GitWorkspaceManager({ repoRoot });
    // A per-session id prefix so agent ids never collide with a previous
    // session's leftover branches, worktrees, or persisted logs. The default
    // counter restarts at 1 every activation, so a fresh "agent-1" would clash
    // with an orphaned `agent/agent-1` branch (worktree create fails) and would
    // overwrite a hydrated detached agent of the same id. The timestamp tag
    // makes each activation's ids distinct; hydrated ids carry an older tag.
    const sessionTag = Date.now().toString(36);
    let agentSeq = 0;
    const orch = new Orchestrator(orchConfig, workspaces, () => `agent-${sessionTag}-${++agentSeq}`);
    // Native custom-agent mode: materialize each role into a Copilot
    // `.agent.md` and spawn `copilot --agent <slug>` so Copilot recognizes a
    // real named custom agent (not a raw-text prompt). See agent-profile.ts.
    // This single shared adapter drives EVERY single-agent dispatch unchanged.
    orch.registerAdapter(new CopilotAdapter({ agentProfile: nodeAgentProfileWriter }));
    // A SECOND Copilot adapter in FLEET single-session mode, registered under a
    // distinct engine id. A Copilot CONDUCTING run rewrites its conductor role's
    // engine id to FLEET_ENGINE_ID (see launchFleetTeam), so the orchestrator
    // routes that ONE conductor process here while every other agent (and every
    // single-agent dispatch) stays on the plain "copilot" adapter above. The
    // conductor's `/fleet` run surfaces its specialists as in-session sub-agents
    // that the orchestrator nests as read-only virtual children. Wrapped so the
    // adapter advertises the fleet id (CopilotAdapter.id is hardcoded "copilot").
    const fleetCopilot = new CopilotAdapter({ agentProfile: nodeAgentProfileWriter, fleet: true });
    const fleetAdapter: EngineAdapter = {
      id: FLEET_ENGINE_ID,
      capabilities: fleetCopilot.capabilities,
      start: (task, workspace, role) => fleetCopilot.start(task, workspace, role),
      health: () => fleetCopilot.health(),
    };
    orch.registerAdapter(fleetAdapter);
    // Register the generic ACP adapter (Gemini CLI in --acp --stdio mode). With
    // no approval UI yet (M6), an ACP-targeted role should use an auto-approving
    // autonomy. No ACP role is seeded in M5; this registration is forward-compat.
    orch.registerAdapter(new AcpAdapter({ command: "gemini" }));
    orch.registerRole(DEFAULT_ROLE);

    // Config-driven DEFAULT layer: push .conductor/config.yaml's `defaults` block
    // (general instructions/skills for every agent + leadSkills for the lead) onto
    // the orchestrator. orchConfig is the resolved MaestroConfig read above; when a
    // legacy `.conductor` has no `defaults` block (or we fell back to DEFAULT_CONFIG)
    // applyDefaults injects the fallback `{ leadSkills: FALLBACK_LEAD_SKILLS }` (the
    // three vendored coordination skills) so the conductor still gets its playbook.
    // A fresh per-launch read
    // refreshes this (see launchTeamByName) so config edits land without a reload.
    applyDefaults(orch, orchConfig);

    // P4: inject preamble resolver so soul+skills are threaded onto the task at spawn time.
    // Core stays pure (no fs/config imports in @maestro/core). The resolver is extension-local.
    orch.setPreambleResolver(async (role) => {
      const reader = await makeNodeFsReader();
      return resolveRolePreamble(repoRoot, role, reader);
    });

    const prModeEnabled = (): boolean =>
      vscode.workspace.getConfiguration("maestro").get<boolean>("prMode", false);

    // Typed as the WebviewToHost merge-action subset (not a widened {type:
    // string}), so agentId is known-present and a renamed variant is a compile
    // error.
    const handleMergeAction = async (msg: MergeActionMessage): Promise<void> => {
      const agent = orch.getAgent(msg.agentId);
      if (!agent) return;
      // A virtual fleet sub-agent has no worktree/branch, so resolve/finish/PR
      // would only fail. The cockpit guards these in the controller already; this
      // is the host-side belt-and-suspenders so a stale message never touches git.
      if (agent.virtual) return;
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

    // Engine-allowlist guard for cockpit (board) messages: refuse a dispatch to
    // an unknown engine, then forward to the cockpit. Shared by routeAppMessage.
    const handleWebviewMessage = (msg: WebviewToHost): void => {
      if (msg.type === "new-task") {
        // The board "+ New task" funnel. Read .conductor/ FRESH (the webview can't
        // reliably know team counts), then open the IN-PAGE task composer: ONE
        // single-page surface, NO native OS dropdown. TEAMS are the unit of a task
        // run: the composer offers ONLY team selection. Picking a team launches it
        // with the CONDUCTOR scoped to that team, delegating to its specialists.
        // With zero teams the composer shows an in-page create-team CTA instead of
        // a chip row; there is no standalone default-agent path. On submit the
        // webview posts launch-team.
        void (async () => {
          const fsReader = await makeNodeFsReader();
          const data = await loadComposerData(repoRoot, fsReader).catch(() => ({
            roles: [],
            teams: [],
            errors: [] as Array<{ source: string; errors: string[] }>,
          }));

          // Map each hand-built team to its name + specialist (role) count. The
          // composer renders one chip per team. An empty list drives the CTA.
          const teams = data.teams.map((t) => ({ name: t.name, specialists: t.roles.length }));

          stage.reveal();
          stage.openTaskComposer(teams);
        })();
        return;
      }
      if (msg.type === "dispatch" && msg.engineId !== undefined && !isKnownEngineId(msg.engineId)) {
        void vscode.window.showWarningMessage(`Maestro: refused dispatch to unknown engine "${msg.engineId}".`);
        return;
      }
      if (msg.type === "dispatch" && msg.roleName !== undefined) {
        // The board sends only a role NAME. Load that saved role's full anatomy
        // (soul + instructions + skills + tools) from .conductor/ and register
        // it before dispatching, so the agent runs as the real custom agent
        // rather than the built-in default. Mirrors maestro.spawnAgent. The
        // dispatch ALWAYS proceeds (finally), so a load failure degrades to the
        // prior behavior instead of dropping the dispatch.
        void (async () => {
          try {
            await prepareSavedRoleDispatch(msg, {
              loadRoles: async () => {
                const fsReader = await makeNodeFsReader();
                const loaded = await loadConductorDir(repoRoot, fsReader);
                return loaded.roles;
              },
              registerRole: (role) => orch.registerRole(role),
            });
          } finally {
            cockpit.handle(msg);
          }
        })();
        return;
      }
      cockpit.handle(msg);
    };

    const reviewOpts = (): { prMode: boolean; prDraft: boolean } => ({
      prMode: prModeEnabled(),
      prDraft: vscode.workspace.getConfiguration("maestro").get<boolean>("prDraft", false),
    });

    // Track whether the user is currently looking at a card in the in-page review
    // so a board-side state change (e.g. Merge while review is up) re-posts the
    // refreshed card. The router flips to review on review-state; we mirror the
    // old "review.isOpen + focusedId" refresh by re-posting on every state change
    // for the focused card whenever a review has been opened this session.
    let lastReviewedId: string | undefined;

    // The single "Conducting Board" panel: ONE editor tab, board + library +
    // anatomy + review swapped in-place by app-main.js. routeAppMessage (defined
    // below) is the single inbound dispatcher.
    const stage = new StageWebviewPanel(context.extensionUri, (msg) => routeAppMessage(msg));

    const cockpit = createCockpit(
      orch,
      (state) => {
        stage.post(state);
        // Keep an open in-page review in sync: when board state changes, re-post
        // the reviewed card so its decision bar reflects the new state (done ->
        // merged after Merge, etc.). Keyed off the last reviewed id, NOT focus, so
        // the review stays live even when nothing is focused. The router only acts
        // on a review-state when it is showing the review view, so a stale re-post
        // while on the board is a harmless cache refresh.
        if (lastReviewedId) {
          const card = state.cards.find((c) => c.id === lastReviewedId);
          if (card) stage.postReview(card, reviewOpts());
          else lastReviewedId = undefined;
        }
      },
      (message) => void vscode.window.showErrorMessage(`Maestro: ${message}`),
      handleMergeAction,
      (agentId) => {
        // onOpenReview: look up the card from the cockpit's current state and post
        // it to the router, which shows the review in-page. Best-effort: warn if
        // the card is not found.
        const state = cockpit.state();
        const card = state.cards.find((c) => c.id === agentId);
        if (!card) {
          void vscode.window.showWarningMessage(`Maestro: agent ${agentId} not found for review.`);
          return;
        }
        lastReviewedId = agentId;
        stage.postReview(card, reviewOpts());
      },
      // confirmClearDone: the destructive "Clear all" bulk discard drops several
      // un-reviewed worktrees, so gate it behind a native modal. True only when
      // the conductor explicitly picks "Discard all".
      async (count) => {
        const choice = await vscode.window.showWarningMessage(
          `Discard ${count} ready-to-review run(s)? This drops their worktrees.`,
          { modal: true },
          "Discard all",
        );
        return choice === "Discard all";
      },
    );

    // Persistence (M7): restore the previous session, then log all future events.
    // The logger subscribes AFTER hydrate so the events hydrate() re-emits are not
    // re-persisted (which would grow the on-disk log on every reload). The cockpit
    // is already subscribed via createCockpit above, so hydrate's events rebuild
    // the card set.
    void (async () => {
      try {
        const records = await eventLogger.loadAll();
        if (records.length > 0) {
          orch.hydrate(records);
          // Re-register each restored agent's worktree with the workspace
          // manager, which starts the session with an empty record map. Without
          // this, Merge/Diff/Discard on a hydrated agent throw "Unknown agent".
          for (const agent of orch.getAgents()) {
            if (agent.workspace) {
              await workspaces.adopt(agent.id, agent.workspace).catch((error: unknown) => {
                const m = error instanceof Error ? error.message : String(error);
                console.error(`[Maestro] could not re-adopt worktree for ${agent.id}: ${m}`);
              });
            }
          }
        }
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
          (event.agent.state === "merged" ||
            event.agent.state === "discarded" ||
            event.agent.state === "pr-created")
        ) {
          // pr-created is a resolved terminal state whose card auto-leaves the
          // board (cockpit reducer). Forget its log too, so it does not rehydrate
          // as a ghost card on the next reload.
          void eventLogger.forget(event.agent.id);
        }
      });
      context.subscriptions.push({ dispose: () => { unsubPersist(); } });
    })();

    context.subscriptions.push({ dispose: () => cockpit.dispose() });

    const gateway = makeConfigGateway(repoRoot);
    const anatomyGateway = makeAnatomyGateway(repoRoot);

    // ── Library controller ────────────────────────────────────────────────────
    // The controller is unchanged; only its OUTPUT panel went away. Snapshots now
    // flow to the single panel via postLibrary.
    const library = createLibrary(gateway, (snap) => stage.postLibrary(snap));

    // ── Anatomy controller ────────────────────────────────────────────────────
    // Likewise: the controller is unchanged; its VM now flows to the single panel
    // via postAnatomy. open(roleName) loads + navigates the router to anatomy.
    const anatomy = createAnatomyController(
      anatomyGateway,
      (vm) => stage.postAnatomy(vm),
      (message) => void vscode.window.showWarningMessage(`Maestro Anatomy: ${message}`),
    );

    /** Resolve a role into the anatomy view: load it and navigate the router. */
    const openAnatomy = async (roleName: string): Promise<void> => {
      stage.reveal();
      // postAnatomy (fired by the controller's onSnapshot) flips the router to the
      // anatomy view; no explicit navigate needed.
      await anatomy.handle({ type: "open-anatomy", roleName });
    };

    /**
     * Load .conductor/teams/, resolve a team (by `name` when provided, else via a
     * quick-pick), prompt for a task description, then launch it on the
     * orchestrator. Shared by the maestro.launchTeam command (no name -> pick) and
     * the Library "Launch team" button (carries the team name).
     */
    const launchTeamByName = async (name?: string, task?: string): Promise<void> => {
      // First-run scaffold (best-effort, non-fatal): write .conductor/config.yaml
      // (with the starter `defaults` block) and the vendored coordination skills under
      // .github/skills/<name>/SKILL.md so a fresh repo has the lead's playbook on
      // disk. The
      // preamble resolver tolerates a missing skill, so a not-yet-scaffolded skill
      // degrades gracefully; this makes it present rather than merely tolerated.
      const fsWriter = await makeNodeFsWriter();
      await scaffoldIfMissing(repoRoot, fsWriter).catch(() => false);
      // scaffoldIfMissing returns early when .conductor/ already exists, so on an
      // existing tree it never writes the vendored skills. Ensure them separately
      // and idempotently so the lead's leadSkills resolve to real SKILL.md files,
      // not prompt text. Best-effort: a failure here must never block a launch.
      try {
        const added = await ensureVendoredSkills(repoRoot, fsWriter);
        if (added.length > 0) {
          console.log(`Maestro: added vendored coordination skills: ${added.join(", ")}.`);
        }
      } catch (err) {
        console.warn("Maestro: could not ensure vendored skills.", err);
      }

      const fsReader = await makeNodeFsReader();
      const loaded = await loadConductorDir(repoRoot, fsReader).catch(() => null);

      // Refresh the orchestrator's default layer from this fresh read so an edit to
      // config.yaml's `defaults` block (or the scaffold just written) takes effect
      // on this launch without a window reload. Mirrors the activate-time wiring;
      // applyDefaults injects the lead-playbook fallback when no `defaults` exists.
      if (loaded) applyDefaults(orch, loaded.config);

      if (!loaded || loaded.teams.length === 0) {
        void vscode.window.showInformationMessage("Maestro: no teams defined in .conductor/teams/.");
        return;
      }

      if (loaded.errors.length > 0) {
        const msgs = loaded.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
        void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
      }

      let selectedTeam: Team;
      if (name !== undefined) {
        // Launch by name (the button path): find the exact team or warn.
        const match = loaded.teams.find((t) => t.name === name);
        if (!match) {
          void vscode.window.showWarningMessage(`Maestro: team "${name}" not found in .conductor/teams/.`);
          return;
        }
        selectedTeam = match;
      } else {
        const items = teamQuickPickItems(loaded.teams);
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
      }

      // The Library button supplies the task via the roomy in-webview overlay;
      // only the command-palette path (no task) falls back to the single-line box.
      let description = task?.trim();
      if (!description) {
        description = (
          await vscode.window.showInputBox({
            prompt: `Task for team ${selectedTeam.name}`,
            placeHolder: "What should this team work on?",
          })
        )?.trim();
      }
      if (!description) return;

      // The CONDUCTOR always leads. A team is just a scoped roster: the conductor
      // runs over the team's specialists (its sub-agents). The team's OWN `lead`
      // field is ignored entirely; the team never promotes one of its roles to lead.
      //
      // TWO launch models, chosen by the conductor's lead engine:
      //  - COPILOT lead -> FLEET single-session mode (launchFleetTeam): ONE
      //    conductor process whose `/fleet ...` run dispatches the specialists as
      //    in-session sub-agents, surfaced as read-only virtual child cards. NO
      //    process per teammate. The conductor runs on the FLEET_ENGINE_ID adapter.
      //  - ANY OTHER lead (e.g. ACP/gemini, which has no `/fleet`) -> the unchanged
      //    delegate/spawn model (launchConductorTeam): the conductor delegates and
      //    each delegation auto-approves into its own teammate process.
      stage.reveal();
      try {
        if (usesFleet(CONDUCTOR_ROLE)) {
          await launchFleetTeam(selectedTeam, description, CONDUCTOR_ROLE, {
            // Build each teammate's `.agent.md` text here (where repoRoot/fsReader
            // live) so the orchestrator can materialize it into the CONDUCTOR'S
            // worktree via SpawnOptions.agentProfiles. We do NOT write the main
            // repo `.github/agents/` and NEVER the global `~/.copilot/agents/`. The
            // slug name uses slugForRole so it matches the prompt roster.
            buildTeammateProfile: async (role) => {
              const reader = await makeNodeFsReader();
              const { soulDoc, skills } = await resolveRolePreamble(repoRoot, role, reader);
              const content = buildAgentProfile(role, {
                id: "",
                description: "",
                roleName: role.name,
                ...(soulDoc ? { soulDoc } : {}),
                ...(skills ? { skills } : {}),
              });
              return { name: slugForRole(role.name), content };
            },
            registerRole: (role) => orch.registerRole(role),
            slugFor: (name) => slugForRole(name),
            spawn: (roleName, desc, opts) => orch.spawn(roleName, desc, opts),
          });
        } else {
          launchConductorTeam(selectedTeam, description, CONDUCTOR_ROLE, {
            registerRole: (role) => orch.registerRole(role),
            launchTeam: (team, desc, opts) => orch.launchTeam(team, desc, opts),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Maestro: could not launch team: ${message}`);
      }
    };

    // ── Discover controller ───────────────────────────────────────────────────
    // lastMcpInventory is updated each time scan results arrive.
    let lastMcpInventory: McpInventory = { servers: [] };

    const { createDiscoverController } = await import("./discover-controller.js");
    const discoverCtrl = createDiscoverController({
      async scanWorkspace() {
        const reader = await makeNodeFsReader();
        return discoverWorkspace(repoRoot, reader);
      },
      async scanPlugins() {
        const pluginsEnabled = vscode.workspace
          .getConfiguration("maestro")
          .get<boolean>("discoverPlugins", false);
        if (!pluginsEnabled) return { items: [], mcp: { servers: [] }, skipped: [] };
        const reader = await makeNodeFsReader();
        const { homedir } = await import("node:os");
        const pluginResult = await discoverPluginsFn(homedir(), reader);
        // Adapt PluginDiscoverResult → DiscoverResult (different mcp field shape)
        return {
          items: pluginResult.items,
          mcp: { servers: pluginResult.mcpServers },
          skipped: [],
        };
      },
      async headSha() {
        return getHeadSha(repoRoot);
      },
      async writeSkill(_name, item) {
        await gateway.saveSkill(
          {
            name: item.name,
            description: item.description,
            allowedTools: item.declaredTools.length > 0 ? item.declaredTools : undefined,
          },
          item.body,
        );
      },
      mcpInventory() {
        return lastMcpInventory;
      },
      openAnatomyEditor(draft) {
        // Adopt: PERSIST the role immediately (symmetric with adopt-skill's
        // writeSkill) so it really is "added", then refresh the Library so the
        // Agents tab lists it, then open the anatomy editor on the saved role for
        // optional tuning. Before this, adopt opened an UNSAVED draft, so an agent
        // the user did not hand-edit in the form was silently never added.
        void (async () => {
          try {
            await anatomyGateway.writeRole(draft.role);
            // Reload the Library snapshot (re-reads .conductor/roles/) so the new
            // role is in the cached state the Agents tab renders from.
            await library.handle({ type: "open-library" });
          } catch (error) {
            const m = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Maestro: could not adopt agent: ${m}`);
            return;
          }
          const skillReqs = await anatomyGateway.loadSkillRequirements().catch(() => []);
          stage.reveal();
          stage.postAnatomy(buildDraftAnatomyVM(draft, skillReqs));
          void vscode.window.showInformationMessage(
            `Maestro: agent "${draft.role.name}" adopted. Tune it here, or find it in the Library Agents tab.`,
          );
        })();
      },
      openSkillEditor(_item, _provenance) {
        // Adopt -> skills handoff: navigate the router to the Library on the
        // Skills tab so the adopted skill is visible.
        stage.reveal();
        void library.handle({ type: "switch-library-tab", tab: "skills" });
        stage.navigate("library");
        void vscode.window.showInformationMessage(
          "Maestro: skill adopted. The Skills tab now lists it.",
        );
      },
      now() {
        return new Date().toISOString().slice(0, 10);
      },
      emit(msg) {
        lastMcpInventory = msg.mcp;
        stage.postDiscover(msg);
      },
    });

    // The SINGLE inbound dispatcher for the one panel. Built from the pure
    // makeAppRouter factory (unit-tested in app-router.test.ts) so the production
    // and tested code paths are identical. The discover split (5 types) and
    // controller wiring match the old per-panel routing exactly.
    const routeAppMessage = makeAppRouter({
      onBoard: (msg) => handleWebviewMessage(msg),
      onLibrary: (msg) => {
        // launch-team needs the orchestrator (which the library controller has
        // no access to), so the HOST intercepts it BEFORE the controller. The
        // controller's launch-team case is a no-op kept only for exhaustiveness.
        if (msg.type === "launch-team") {
          void launchTeamByName(msg.name, msg.task);
          return;
        }
        // new-role: the webview cannot use window.prompt(), so the HOST collects
        // the agent name via a native input box. Then let the controller seed the
        // default role file first (so the anatomy editor has a real file to load),
        // THEN open the anatomy editor on it. The anatomy role-set-* handlers bail
        // when loadRole is null, so the seed-write must land before we navigate.
        if (msg.type === "new-role") {
          void (async () => {
            const name =
              msg.name?.trim() ||
              (
                await vscode.window.showInputBox({
                  title: "New agent",
                  prompt: "Name the new agent",
                  placeHolder: "e.g. Reviewer",
                })
              )?.trim();
            if (!name) return; // cancelled
            await library.handle({ type: "new-role", name });
            await openAnatomy(name);
            // Mirror the new agent to .github/agents/ so it shows in the Copilot
            // Chat picker (and the CLI). VS Code only picks up new agent files on
            // a window reload, so offer that the first time the file is created.
            const result = await syncRepoCopilotAgent(repoRoot, name);
            if (result?.created) {
              void vscode.window
                .showInformationMessage(
                  `Wrote .github/agents/${name} as a Copilot agent. Reload the window to use it in Copilot Chat.`,
                  "Reload Window",
                )
                .then((choice) => {
                  if (choice === "Reload Window") {
                    void vscode.commands.executeCommand("workbench.action.reloadWindow");
                  }
                });
            }
          })();
          return;
        }
        // delete-role / skill-delete / team-delete: confirm with a native modal
        // (webviews can't use confirm()), then delegate the actual delete.
        if (msg.type === "delete-role" || msg.type === "skill-delete" || msg.type === "team-delete") {
          const noun =
            msg.type === "delete-role" ? "agent" : msg.type === "skill-delete" ? "skill" : "team";
          void (async () => {
            const choice = await vscode.window.showWarningMessage(
              `Delete ${noun} "${msg.name}"? This cannot be undone.`,
              { modal: true },
              "Delete",
            );
            if (choice === "Delete") await library.handle(msg);
          })();
          return;
        }
        void library.handle(msg);
      },
      onDiscover: (msg) => void discoverCtrl.handle(msg),
      onAnatomy: (msg) =>
        void (async () => {
          await anatomy.handle(msg);
          // Keep the .github/agents/ Copilot mirror in sync after a persisted
          // role edit. open-anatomy is a read (opens the editor), so it is the
          // one variant that changes nothing and is skipped.
          if (msg.type !== "open-anatomy") {
            await syncRepoCopilotAgent(repoRoot, msg.roleName);
          }
        })(),
    });

    conducting = { repoRoot, orch, workspaces, cockpit, stage, openAnatomy, launchTeamByName, routeAppMessage };

    // The Conducting Board is the hero surface: open it as soon as a folder is
    // wired up so it is the first thing the user sees (the prototype's entry
    // point). It is empty until an agent is dispatched.
    stage.reveal();
  }

  // Commands and the tree view register unconditionally. Handlers below read the
  // `conducting` closure var; when it is undefined (no folder) they warn instead
  // of throwing.
  context.subscriptions.push(
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
      conducting.stage.reveal();
      conducting.stage.navigate("library");
      // Ensure the library has data: postLibrary (fired by the controller) paints
      // the in-page view. open-library loads the Skills tab snapshot.
      conducting.routeAppMessage({ type: "open-library" });
    }),
    vscode.commands.registerCommand("maestro.openAnatomy", async () => {
      if (!conducting) {
        void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE);
        return;
      }
      const { repoRoot, openAnatomy } = conducting;

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

      await openAnatomy(selectedRole.name);
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
      // No name: the helper shows a quick-pick (or auto-selects the sole team).
      await conducting.launchTeamByName();
    }),
  );

  // If a folder is already open, wire up conducting now (the normal case). If
  // not, the commands above are still registered; they warn until a folder opens.
  // A persistent, always-visible launch point. The Maestro activity-bar container
  // was removed along with the roster tree, so this status bar item is the
  // one-click way back to the Conducting Board (the Command Palette "Maestro: Open
  // Conducting Board" also works). Clicking with no folder open warns, exactly
  // like the command it runs.
  const launchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  launchItem.text = "$(dashboard) Maestro";
  launchItem.tooltip = "Open the Maestro Conducting Board";
  launchItem.command = "maestro.openStage";
  launchItem.show();
  context.subscriptions.push(launchItem);

  // The activity-bar launcher (left strip icon → a slim webview with command
  // links). Registers unconditionally so the icon is always present.
  registerMaestroHomeView(context);

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
