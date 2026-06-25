import type { Agent, ApprovalDecision, DispatchSpec, MergeResult, OrchestratorEvent, SpawnOptions } from "@hallucinate/core";
import type { CockpitState, WebviewToHost } from "@hallucinate/cockpit";
import { initialModel, reduce, selectState, setFocus } from "@hallucinate/cockpit";

/** The slice of Orchestrator the cockpit drives. Keeps the controller unit-testable. */
export interface OrchestratorLike {
  on(listener: (event: OrchestratorEvent) => void): () => void;
  spawn(roleName: string, description: string, opts?: SpawnOptions): Agent;
  dispatch(spec: DispatchSpec): Agent;
  steer(agentId: string, input: string): void;
  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void;
  stop(agentId: string): void;
  merge(agentId: string): Promise<MergeResult>;
  discard(agentId: string): Promise<void>;
  sendBack(agentId: string, feedback: string): Agent;
  retryCleanup(agentId: string): Promise<void>;
  /** Transition a done agent to the terminal "pr-created" state after a PR is opened. */
  markPrCreated(agentId: string): Promise<void>;
  /** Approve a pending delegation: spawns the teammate the lead asked for. */
  approveDelegation(id: string): Agent;
  /** Deny a pending delegation: drops the proposal, nothing spawns. */
  denyDelegation(id: string): void;
}

export interface Cockpit {
  /** Apply one inbound webview message. */
  handle(message: WebviewToHost): void;
  /** Current derived state (for a freshly-created webview). */
  state(): CockpitState;
  /** Unsubscribe from the orchestrator. */
  dispose(): void;
}

/** The out-of-band merge actions the controller delegates to the host. */
export type MergeActionMessage = Extract<
  WebviewToHost,
  { type: "resolve-conflict" | "finish-merge" | "create-pr" }
>;

/**
 * Wire an orchestrator to a state sink. `onState` fires on every change with a
 * full snapshot (the UI is a pure function of state). `onError` receives the
 * message from a rejected async action (merge/discard). `onMergeAction` handles
 * the out-of-band merge actions that need the host (editor/git), narrowed so a
 * renamed protocol variant is a compile error at the call site.
 */
export function createCockpit(
  orch: OrchestratorLike,
  onState: (state: CockpitState) => void,
  onError?: (message: string) => void,
  onMergeAction?: (msg: MergeActionMessage) => void,
  onOpenReview?: (agentId: string) => void,
  /**
   * Host-injected confirm for the destructive "Clear all" bulk discard. Receives
   * the number of ready-to-review runs about to be dropped; resolves true only
   * when the user confirms. Defaulting to "no confirm available" => deny
   * keeps the controller safe and pure (the host wires a real modal).
   */
  confirmClearDone?: (count: number) => Promise<boolean>,
): Cockpit {
  let model = initialModel();
  const push = (): void => onState(selectState(model));
  const unsub = orch.on((event) => {
    model = reduce(model, event);
    push();
  });

  const fail = (error: unknown): void =>
    onError?.(error instanceof Error ? error.message : String(error));

  /**
   * The mutating, agent-targeted verbs that core REFUSES (throws) on a virtual
   * fleet sub-agent. The UI never renders these affordances for a virtual card,
   * but a tampered/stale webview could still post one; dropping them here means
   * the host never asks core to do something it would only throw on. Read-only
   * verbs (focus, open-review) are intentionally NOT listed: they are safe on a
   * virtual card.
   */
  const VIRTUAL_BLOCKED = new Set([
    "steer",
    "approve",
    "stop",
    "merge",
    "discard",
    "sendBack",
    "retry-cleanup",
    "resolve-conflict",
    "finish-merge",
    "create-pr",
  ]);

  /** True when a message targets an agent id whose card is a read-only virtual sub-agent. */
  const targetsVirtual = (message: WebviewToHost): boolean => {
    if (!("agentId" in message) || typeof message.agentId !== "string") return false;
    return model.cards.get(message.agentId)?.virtual === true;
  };

  /**
   * Bulk-discard every ready-to-review (done) card. Reuses the SAME discard code
   * path as the single `case "discard"` (orch.discard drops the worktree +
   * branch and forgets the log). The cockpit reducer auto-clears each card as it
   * transitions to the resolved "discarded" state, so no manual model mutation is
   * needed. Confirms first (destructive: drops multiple un-reviewed worktrees);
   * a no-op when there are no done cards.
   */
  const clearDoneLane = (): void => {
    const doneIds = selectState(model)
      .cards.filter((c) => c.state === "done")
      .map((c) => c.id);
    if (doneIds.length === 0) return;
    void (async () => {
      const ok = confirmClearDone ? await confirmClearDone(doneIds.length) : false;
      if (!ok) return;
      for (const id of doneIds) orch.discard(id).catch(fail);
    })();
  };

  function handle(message: WebviewToHost): void {
    // Defensive: drop a mutating action aimed at a read-only virtual sub-agent
    // before it reaches core (which would throw). The UI suppresses these
    // affordances for virtual cards, so this only ever fires on a stale/tampered
    // message; silently ignoring it is the least-surprising behavior.
    if (VIRTUAL_BLOCKED.has(message.type) && targetsVirtual(message)) return;
    // A synchronous orchestrator call (spawn/steer/approve/stop/sendBack) can
    // throw; wrapping the dispatch routes that to onError instead of letting it
    // escape as an unhandled exception (mirroring how merge/discard route their
    // rejected promises via .catch(fail)).
    try {
      switch (message.type) {
        case "ready":
          push();
          break;
        case "new-task":
          // The "+ New task" funnel is handled entirely host-side (it needs a
          // fresh .hallucinate/ read + orchestrator/stage access). It never drives
          // the cockpit model, so it is a no-op here; this case keeps the switch
          // exhaustive over WebviewToHost.
          break;
        case "focus":
          model = setFocus(model, message.agentId);
          push();
          break;
        case "spawn":
          orch.spawn(message.roleName, message.description, message.goal !== undefined ? { goal: message.goal } : undefined);
          break;
        case "steer":
          orch.steer(message.agentId, message.input);
          break;
        case "approve":
          orch.approve(message.agentId, message.approvalId, message.decision);
          break;
        case "stop":
          orch.stop(message.agentId);
          break;
        case "merge":
          orch.merge(message.agentId).catch(fail);
          break;
        case "discard":
          orch.discard(message.agentId).catch(fail);
          break;
        case "clear-done-lane":
          clearDoneLane();
          break;
        case "sendBack":
          orch.sendBack(message.agentId, message.feedback);
          break;
        case "retry-cleanup":
          orch.retryCleanup(message.agentId).catch(fail);
          break;
        case "dispatch":
          orch.dispatch({
            roleName: message.roleName,
            newRoleName: message.newRoleName,
            engineId: message.engineId,
            model: message.model,
            goal: message.goal,
            description: message.description,
          });
          break;
        case "resolve-conflict":
        case "finish-merge":
        case "create-pr":
          onMergeAction?.(message);
          break;
        case "open-review":
          onOpenReview?.(message.agentId);
          break;
        case "approve-delegation":
          // Approving spawns the teammate (core does the work + emits
          // delegation-resolved, which flows back into the model via reduce).
          orch.approveDelegation(message.id);
          break;
        case "deny-delegation":
          orch.denyDelegation(message.id);
          break;
        default: {
          // A new WebviewToHost variant without a handler is a COMPILE error.
          const _exhaustive: never = message;
          void _exhaustive;
          break;
        }
      }
    } catch (error) {
      fail(error);
    }
  }

  return { handle, state: () => selectState(model), dispose: unsub };
}
