import type { Agent, ApprovalDecision, MergeResult, OrchestratorEvent } from "@maestro/core";
import type { CockpitState, WebviewToHost } from "@maestro/cockpit";
import { initialModel, reduce, selectState, setFocus } from "@maestro/cockpit";

/** The slice of Orchestrator the cockpit drives. Keeps the controller unit-testable. */
export interface OrchestratorLike {
  on(listener: (event: OrchestratorEvent) => void): () => void;
  spawn(roleName: string, description: string): Agent;
  steer(agentId: string, input: string): void;
  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void;
  stop(agentId: string): void;
  merge(agentId: string): Promise<MergeResult>;
  discard(agentId: string): Promise<void>;
  sendBack(agentId: string, feedback: string): Agent;
  retryCleanup(agentId: string): Promise<void>;
}

export interface Cockpit {
  /** Apply one inbound webview message. */
  handle(message: WebviewToHost): void;
  /** Current derived state (for a freshly-created webview). */
  state(): CockpitState;
  /** Unsubscribe from the orchestrator. */
  dispose(): void;
}

/**
 * Wire an orchestrator to a state sink. `onState` fires on every change with a
 * full snapshot (the UI is a pure function of state). `onError` receives the
 * message from a rejected async action (merge/discard).
 */
export function createCockpit(
  orch: OrchestratorLike,
  onState: (state: CockpitState) => void,
  onError?: (message: string) => void,
  onMergeAction?: (msg: WebviewToHost) => void,
): Cockpit {
  let model = initialModel();
  const push = (): void => onState(selectState(model));
  const unsub = orch.on((event) => {
    model = reduce(model, event);
    push();
  });

  const fail = (error: unknown): void =>
    onError?.(error instanceof Error ? error.message : String(error));

  function handle(message: WebviewToHost): void {
    switch (message.type) {
      case "ready":
        push();
        break;
      case "focus":
        model = setFocus(model, message.agentId);
        push();
        break;
      case "spawn":
        orch.spawn(message.roleName, message.description);
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
      case "sendBack":
        orch.sendBack(message.agentId, message.feedback);
        break;
      case "retry-cleanup":
        orch.retryCleanup(message.agentId).catch(fail);
        break;
      case "resolve-conflict":
      case "finish-merge":
      case "create-pr":
        onMergeAction?.(message);
        break;
    }
  }

  return { handle, state: () => selectState(model), dispose: unsub };
}
