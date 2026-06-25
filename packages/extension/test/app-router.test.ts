import { describe, expect, it } from "vitest";
import { makeAppRouter, type AppRouterHandlers } from "../src/app-router.js";
import type { AppToHost } from "../src/app-protocol.js";

function makeSpyHandlers(): {
  handlers: AppRouterHandlers;
  calls: { board: AppToHost[]; library: AppToHost[]; discover: AppToHost[]; anatomy: AppToHost[] };
} {
  const calls = {
    board: [] as AppToHost[],
    library: [] as AppToHost[],
    discover: [] as AppToHost[],
    anatomy: [] as AppToHost[],
  };
  const handlers: AppRouterHandlers = {
    onBoard: (m) => calls.board.push(m),
    onLibrary: (m) => calls.library.push(m),
    onDiscover: (m) => calls.discover.push(m),
    onAnatomy: (m) => calls.anatomy.push(m),
  };
  return { handlers, calls };
}

describe("makeAppRouter", () => {
  it("routes a cockpit (board) message to onBoard", () => {
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "merge", agentId: "a1" } as AppToHost);
    expect(calls.board).toHaveLength(1);
    expect(calls.library).toHaveLength(0);
    expect(calls.anatomy).toHaveLength(0);
  });

  it("routes a plain library message (switch-library-tab) to onLibrary, not onDiscover", () => {
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "switch-library-tab", tab: "skills" } as AppToHost);
    expect(calls.library).toHaveLength(1);
    expect(calls.discover).toHaveLength(0);
  });

  it("routes the five discover library messages to onDiscover, not onLibrary", () => {
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "scan-repo" } as AppToHost);
    route({ type: "scan-plugins" } as AppToHost);
    route({ type: "adopt-agent", itemId: "x" } as AppToHost);
    route({ type: "adopt-skill", itemId: "y" } as AppToHost);
    route({ type: "browse-source", itemId: "z" } as AppToHost);
    expect(calls.discover).toHaveLength(5);
    expect(calls.library).toHaveLength(0);
  });

  it("routes the new library messages (launch-team, new-role, delete-role, team-*) to onLibrary", () => {
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "launch-team", name: "Squad" } as AppToHost);
    route({ type: "new-role", name: "Reviewer" } as AppToHost);
    route({ type: "delete-role", name: "Tester" } as AppToHost);
    route({ type: "team-create" } as AppToHost);
    route({ type: "team-save", name: "Squad", roleNames: ["A"] } as AppToHost);
    route({ type: "team-delete", name: "Squad" } as AppToHost);
    expect(calls.library).toHaveLength(6);
    expect(calls.discover).toHaveLength(0);
    expect(calls.board).toHaveLength(0);
  });

  it("routes the discover-dispatch agent-card path as a board dispatch message (not library)", () => {
    // Group 4: the webview turns a discover-dispatch click into a real board
    // dispatch message, which the router sends to onBoard.
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "dispatch", newRoleName: "code-reviewer", engineId: "copilot", description: "x" } as AppToHost);
    expect(calls.board).toHaveLength(1);
    expect(calls.library).toHaveLength(0);
  });

  it("routes an anatomy message to onAnatomy", () => {
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "open-anatomy", roleName: "Tester" } as AppToHost);
    expect(calls.anatomy).toHaveLength(1);
    expect(calls.board).toHaveLength(0);
    expect(calls.library).toHaveLength(0);
  });

  it("drops a message no guard accepts (defense in depth)", () => {
    const { handlers, calls } = makeSpyHandlers();
    const route = makeAppRouter(handlers);
    route({ type: "nonsense" } as unknown as AppToHost);
    expect(calls.board).toHaveLength(0);
    expect(calls.library).toHaveLength(0);
    expect(calls.discover).toHaveLength(0);
    expect(calls.anatomy).toHaveLength(0);
  });
});
