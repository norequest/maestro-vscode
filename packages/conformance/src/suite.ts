import { describe, it, expect } from "vitest";
import {
  Orchestrator,
  FakeWorkspaceProvider,
  isTerminalState,
  composePreamble,
  renderToolsForPreamble,
} from "@maestro/core";
import type { EngineAdapter, Role, AgentEvent, SoulDoc } from "@maestro/core";

/**
 * A factory the per-adapter conformance test provides. It returns a fresh
 * adapter plus driver hooks the suite calls AFTER the agent reaches `working`:
 * the adapter must not emit anything until driven.
 */
export type AdapterFactory = () => {
  adapter: EngineAdapter;
  /** Drive the adapter to emit a terminal `done` event. */
  completeSuccessfully(): void;
  /** Drive the adapter to emit a terminal `error` event. */
  failWithError(): void;
  /** Drive the adapter to emit at least one `output` event. */
  emitOutput(text: string): void;
};

function makeRole(engineId: string): Role {
  return {
    name: "Implementer",
    instructions: "do the thing",
    engine: { id: engineId },
    autonomy: "yolo",
  };
}

function waitForTerminal(orch: Orchestrator, agentId: string): Promise<void> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    const check = () => {
      const a = orch.getAgent(agentId);
      if (a && isTerminalState(a.state)) {
        unsub?.();
        resolve();
      }
    };
    unsub = orch.on(check);
    check();
  });
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) {
        unsub?.();
        resolve();
      }
    };
    unsub = orch.on(check);
    check();
  });
}

/**
 * The shared adapter conformance suite. Every adapter calls this from its own
 * conformance test, passing a label and a factory. Turns "add an engine = write
 * one adapter" into a machine-checked guarantee.
 */
export function runConformanceSuite(label: string, factory: AdapterFactory): void {
  describe(`${label} conformance`, () => {
    it("declares id and capabilities", () => {
      const { adapter } = factory();
      expect(typeof adapter.id).toBe("string");
      expect(adapter.id.length).toBeGreaterThan(0);
      const c = adapter.capabilities;
      expect(typeof c.streaming).toBe("boolean");
      expect(typeof c.structuredEvents).toBe("boolean");
      expect(typeof c.approvals).toBe("boolean");
      expect(typeof c.steerable).toBe("boolean");
    });

    it("health() resolves to a HealthStatus", async () => {
      const { adapter } = factory();
      const h = await adapter.health();
      expect(typeof h.ok).toBe("boolean");
    });

    it("streams events then terminates with done or error", async () => {
      const { adapter, completeSuccessfully, emitOutput } = factory();
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerRole(makeRole(adapter.id));
      orch.registerAdapter(adapter);

      const events: AgentEvent[] = [];
      orch.on((e) => {
        if (e.kind === "agent-event") events.push(e.event);
      });

      const agent = orch.spawn("Implementer", "task");
      await waitForState(orch, agent.id, "working");

      emitOutput("doing work\n");
      completeSuccessfully();

      await waitForTerminal(orch, agent.id);

      const final = orch.getAgent(agent.id);
      expect(final).toBeDefined();
      expect(["done", "error"]).toContain(final!.state);
      // Both Copilot (unstructured) and ACP (structured) emit `output` events, so
      // a real output carrying the emitted text must reach the stream. Asserting
      // the text rules out a no-op `emitOutput` slipping through on length alone.
      expect(
        events.some((e) => e.kind === "output" && e.text.includes("doing work")),
      ).toBe(true);
      // Capability-aware: structured-event adapters must also emit a status event;
      // unstructured adapters (e.g. Copilot) just need to stream something.
      if (adapter.capabilities.structuredEvents) {
        expect(events.some((e) => e.kind === "status")).toBe(true);
      } else {
        expect(events.length).toBeGreaterThan(0);
      }
    });

    it("maps an engine failure to a terminal error state and ends the stream", async () => {
      const { adapter, failWithError } = factory();
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerRole(makeRole(adapter.id));
      orch.registerAdapter(adapter);

      const agent = orch.spawn("Implementer", "task");
      await waitForState(orch, agent.id, "working");

      failWithError();

      // waitForTerminal resolves only if the stream terminates; a hang would
      // surface as a test timeout, which is exactly the regression we guard.
      await waitForTerminal(orch, agent.id);

      const final = orch.getAgent(agent.id);
      expect(final).toBeDefined();
      // Capability-agnostic: every adapter must surface an engine failure as `error`.
      expect(final!.state).toBe("error");
    });

    it("honors stop(): agent reaches stopped, stream ends without error", async () => {
      const { adapter } = factory();
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerRole(makeRole(adapter.id));
      orch.registerAdapter(adapter);

      const agent = orch.spawn("Implementer", "task");
      await waitForState(orch, agent.id, "working");
      orch.stop(agent.id);

      await waitForTerminal(orch, agent.id);
      const final = orch.getAgent(agent.id);
      expect(final).toBeDefined();
      expect(final!.state).toBe("stopped");
    });

    it("reports capabilities truthfully (boolean flags, no lies)", () => {
      const { adapter } = factory();
      expect(typeof adapter.capabilities.approvals).toBe("boolean");
      expect(typeof adapter.capabilities.steerable).toBe("boolean");
    });

    it("resolver populates task.soulDoc so soul red lines are available to the adapter", async () => {
      const { adapter, completeSuccessfully } = factory();
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());

      const roleWithSoul: Role = {
        name: "Implementer",
        instructions: "do the thing",
        engine: { id: adapter.id },
        autonomy: "yolo",
        soul: "guardian",
      };
      orch.registerRole(roleWithSoul);
      orch.registerAdapter(adapter);

      // Inject a resolver that returns a soul with red lines.
      const fakeSoul: SoulDoc = {
        redLines: "never delete production data",
        raw: "## Red lines\nnever delete production data",
      };
      orch.setPreambleResolver(async () => ({ soulDoc: fakeSoul }));

      const agent = orch.spawn("Implementer", "add caching");
      await waitForState(orch, agent.id, "working");

      // The task on the live agent must have soulDoc populated by the resolver.
      const liveAgent = orch.getAgent(agent.id);
      expect(liveAgent?.task.soulDoc?.redLines).toBe("never delete production data");

      // Both adapters use composePreamble which places Soul before Task.
      // Verify the ordering invariant holds in the composed preamble.
      const rendered = composePreamble({
        soul: liveAgent!.task.soulDoc,
        instructions: roleWithSoul.instructions,
        tools: renderToolsForPreamble(roleWithSoul.tools),
        skills: liveAgent!.task.skills,
        task: "add caching",
      });
      const redLinePos = rendered.indexOf("never delete production data");
      const taskPos = rendered.indexOf("add caching");
      expect(redLinePos).toBeGreaterThanOrEqual(0);
      expect(taskPos).toBeGreaterThan(redLinePos);

      completeSuccessfully();
      await waitForTerminal(orch, agent.id);
    });
  });
}
