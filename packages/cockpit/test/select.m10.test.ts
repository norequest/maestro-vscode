import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, OrchestratorEvent } from "@hallucinate/core";
import type { TileSize, TileWarmth } from "../src/protocol.js";
import { initialModel, reduce } from "../src/reducer.js";
import { selectAttention, selectFloor, selectHistory, selectState, selectTeams } from "../src/select.js";
import { teamHue } from "../src/crest.js";

/** A role override with a distinct name + engine, to prove header fields come from the LEAD card. */
function role(name: string, engineId: string): Agent["role"] {
  return { name, instructions: "", engine: { id: engineId }, autonomy: "auto-approve-safe" };
}

function agent(id: string, state: Agent["state"], over: Partial<Agent> = {}): Agent {
  return {
    id,
    task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state,
    log: [],
    ...over,
  };
}
const added = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });

describe("selectAttention (M10 attention queue)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("orders conflict before awaiting-approval (most-urgent first)", () => {
    vi.setSystemTime(1_000);
    let m = initialModel();
    m = reduce(m, added(agent("a1", "awaiting-approval")));
    m = reduce(m, added(agent("a2", "conflict")));

    const att = selectAttention(m);
    expect(att.map((a) => a.id)).toEqual(["a2", "a1"]);
    // Each entry carries the renderable fields the bar needs.
    const conflict = att[0]!;
    expect(conflict.kind).toBe("conflict");
    expect(conflict.state).toBe("conflict");
    expect(conflict.roleName).toBe("Implementer");
    expect(conflict.since).toBe(1_000);
  });

  it("tie-breaks same-kind cards by oldest needsYouSince first (since beats id)", () => {
    // "zebra" enters attention first (older `since`); "apple" enters later.
    // Alphabetical id order would put "apple" first, so a since-first result
    // proves `since` dominates the id tie-break.
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent("zebra", "awaiting-approval")));
    vi.setSystemTime(2_000);
    m = reduce(m, added(agent("apple", "awaiting-approval")));

    const att = selectAttention(m);
    expect(att.map((a) => a.id)).toEqual(["zebra", "apple"]);
    expect(att.map((a) => a.since)).toEqual([1_000, 2_000]);
  });

  it("returns [] when nothing needs attention, and selectState.attention reflects it", () => {
    const m = reduce(initialModel(), added(agent("a1", "working")));
    expect(selectAttention(m)).toEqual([]);
    expect(selectState(m).attention).toEqual([]);
  });

  it("maps each attention state to the right kind", () => {
    const cases: ReadonlyArray<[Agent["state"], string]> = [
      ["awaiting-approval", "approval"],
      ["conflict", "conflict"],
      ["done", "review"],
      ["error", "error"],
      ["detached", "detached"],
      ["merge-cleanup-failed", "cleanup"],
    ];
    for (const [state, kind] of cases) {
      const m = reduce(initialModel(), added(agent("a1", state)));
      const att = selectAttention(m);
      expect(att).toHaveLength(1);
      expect(att[0]!.kind).toBe(kind);
      expect(att[0]!.state).toBe(state);
    }
  });

  it("carries the pending approval id and detail for an approval entry", () => {
    const m = reduce(
      initialModel(),
      added(
        agent("a1", "awaiting-approval", {
          pendingApprovalId: "ap-7",
          approvalDetail: { tool: "Run", description: "rm -rf build" },
        }),
      ),
    );
    const att = selectAttention(m);
    expect(att[0]!.pendingApprovalId).toBe("ap-7");
    expect(att[0]!.approvalDetail).toEqual({ tool: "Run", description: "rm -rf build" });
  });
});

describe("selectTeams (M10 Phase D: lead-grouped teams)", () => {
  it("groups a lead's children into one id-sorted group, with header fields", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working")));
    // Add the children out of id order to prove memberIds gets sorted.
    m = reduce(m, added(agent("c2", "working", { parentId: "lead" })));
    m = reduce(m, added(agent("c1", "working", { parentId: "lead" })));

    // All three working (count > 1) collapses to the "all working" rollup; tone is live.
    expect(selectTeams(m)).toEqual([
      {
        leadId: "lead",
        memberIds: ["c1", "c2"],
        leadRoleName: "Implementer",
        leadEngineId: "copilot",
        statusLabel: "all working",
        tone: "live",
        hue: teamHue("lead"),
      },
    ]);
  });

  it("forms no group for a child whose parent is not on the board", () => {
    const m = reduce(initialModel(), added(agent("orphan", "working", { parentId: "ghost" })));
    expect(selectTeams(m)).toEqual([]);
  });

  it("emits no group for a childless lead", () => {
    const m = reduce(initialModel(), added(agent("solo", "working")));
    expect(selectTeams(m)).toEqual([]);
  });

  it("orders multiple groups by leadId ascending, members id-sorted", () => {
    let m = initialModel();
    // Scrambled insertion order; leads and members must both come out sorted.
    m = reduce(m, added(agent("beta", "working")));
    m = reduce(m, added(agent("alpha", "working")));
    m = reduce(m, added(agent("b2", "working", { parentId: "beta" })));
    m = reduce(m, added(agent("b1", "working", { parentId: "beta" })));
    m = reduce(m, added(agent("a1", "working", { parentId: "alpha" })));

    expect(selectTeams(m)).toEqual([
      {
        leadId: "alpha",
        memberIds: ["a1"],
        leadRoleName: "Implementer",
        leadEngineId: "copilot",
        statusLabel: "all working",
        tone: "live",
        hue: teamHue("alpha"),
      },
      {
        leadId: "beta",
        memberIds: ["b1", "b2"],
        leadRoleName: "Implementer",
        leadEngineId: "copilot",
        statusLabel: "all working",
        tone: "live",
        hue: teamHue("beta"),
      },
    ]);
  });

  it("takes leadRoleName/leadEngineId from the LEAD card, not the children", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working", { role: role("Lead", "copilot-fleet") })));
    m = reduce(m, added(agent("c1", "working", { parentId: "lead", role: role("Implementer", "copilot") })));

    const [g] = selectTeams(m);
    expect(g!.leadRoleName).toBe("Lead");
    expect(g!.leadEngineId).toBe("copilot-fleet");
  });

  it("rolls statusLabel up to the single bucket when all share it (3 ready to review)", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "done")));
    m = reduce(m, added(agent("c1", "done", { parentId: "lead" })));
    m = reduce(m, added(agent("c2", "done", { parentId: "lead" })));

    const [g] = selectTeams(m);
    expect(g!.statusLabel).toBe("3 ready to review");
    expect(g!.tone).toBe("warm");
  });

  it("rolls statusLabel up to the top two buckets by urgency, ' · ' joined", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working")));
    m = reduce(m, added(agent("c1", "done", { parentId: "lead" })));
    m = reduce(m, added(agent("c2", "working", { parentId: "lead" })));

    const [g] = selectTeams(m);
    // ready (1) outranks working (2) in the rollup order.
    expect(g!.statusLabel).toBe("1 ready to review · 2 working");
    expect(g!.tone).toBe("warm"); // done(warm) is more urgent than working(live)
  });

  it("collapses to 'all working' only when every member works and there is more than one", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working")));
    m = reduce(m, added(agent("c1", "working", { parentId: "lead" })));

    const [g] = selectTeams(m);
    expect(g!.statusLabel).toBe("all working");
    expect(g!.tone).toBe("live");
  });

  it("derives tone as the most-urgent warmth across lead and members (conflict -> hot)", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working")));
    m = reduce(m, added(agent("c1", "conflict", { parentId: "lead" })));

    const [g] = selectTeams(m);
    expect(g!.tone).toBe("hot");
    expect(g!.statusLabel).toBe("1 needs you · 1 working");
  });

  it("does not mutate the input model or its cards Map", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working")));
    m = reduce(m, added(agent("c2", "working", { parentId: "lead" })));
    m = reduce(m, added(agent("c1", "working", { parentId: "lead" })));

    const sizeBefore = m.cards.size;
    const snapshot = JSON.stringify([...m.cards.entries()]);
    selectTeams(m);
    expect(m.cards.size).toBe(sizeBefore);
    expect(JSON.stringify([...m.cards.entries()])).toBe(snapshot);
  });
});

describe("selectFloor (M10 Phase D: salience-ordered Floor tiles)", () => {
  it("returns [] for an empty model", () => {
    expect(selectFloor(initialModel())).toEqual([]);
  });

  it("derives size + warmth purely from state", () => {
    const cases: ReadonlyArray<[Agent["state"], TileWarmth, TileSize]> = [
      ["conflict", "hot", "lg"],
      ["awaiting-approval", "warm", "lg"],
      ["working", "live", "md"],
      ["stopped", "idle", "sm"],
    ];
    for (const [state, warmth, size] of cases) {
      const m = reduce(initialModel(), added(agent("a1", state)));
      expect(selectFloor(m)).toEqual([{ id: "a1", size, warmth, child: false }]);
    }
  });

  it("orders tiles most-urgent first by salience rank", () => {
    let m = initialModel();
    // Added scrambled; salience must re-sort them.
    m = reduce(m, added(agent("w", "working"))); // rank 6
    m = reduce(m, added(agent("c", "conflict"))); // rank 0
    m = reduce(m, added(agent("ap", "awaiting-approval"))); // rank 3
    m = reduce(m, added(agent("s", "stopped"))); // rank 8
    // conflict(0) before approval(3) before working(6) before stopped(8).
    expect(selectFloor(m).map((t) => t.id)).toEqual(["c", "ap", "w", "s"]);
  });

  it("ranks done (ready-to-review) ahead of working per the salience map", () => {
    let m = initialModel();
    m = reduce(m, added(agent("w", "working"))); // rank 6
    m = reduce(m, added(agent("d", "done"))); // rank 5: needs your review
    expect(selectFloor(m).map((t) => t.id)).toEqual(["d", "w"]);
  });

  it("tie-breaks equal-rank tiles by oldest needsYouSince first, then id", () => {
    vi.useFakeTimers();
    try {
      // "zebra" waits first (older), "apple" waits later. Id order alone would
      // put "apple" first, so a since-first result proves since beats id.
      vi.setSystemTime(1_000);
      let m = reduce(initialModel(), added(agent("zebra", "awaiting-approval")));
      vi.setSystemTime(2_000);
      m = reduce(m, added(agent("apple", "awaiting-approval")));

      expect(selectFloor(m).map((t) => t.id)).toEqual(["zebra", "apple"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nests each child immediately after its lead, lead at child:false, child keeping its own size/warmth", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working"))); // live/md
    m = reduce(m, added(agent("c1", "conflict", { parentId: "lead" }))); // hot/lg
    m = reduce(m, added(agent("c2", "stopped", { parentId: "lead" }))); // idle/sm
    m = reduce(m, added(agent("z", "done"))); // separate top-level, rank 5

    // Top-level sorted by salience: z(done, 5) before lead(working, 6). Each
    // child sits right after its lead in id order, with its OWN warmth/size.
    expect(selectFloor(m)).toEqual([
      { id: "z", size: "lg", warmth: "warm", child: false },
      { id: "lead", size: "md", warmth: "live", child: false },
      { id: "c1", size: "lg", warmth: "hot", child: true },
      { id: "c2", size: "sm", warmth: "idle", child: true },
    ]);
  });

  it("emits a full delegation chain depth-first: lead, child, grandchild, each once", () => {
    // A -> B -> C is a 3-level chain; a one-level expansion would drop C.
    let m = initialModel();
    m = reduce(m, added(agent("A", "working")));
    m = reduce(m, added(agent("B", "working", { parentId: "A" })));
    m = reduce(m, added(agent("C", "working", { parentId: "B" })));

    expect(selectFloor(m)).toEqual([
      { id: "A", size: "md", warmth: "live", child: false },
      { id: "B", size: "md", warmth: "live", child: true },
      { id: "C", size: "md", warmth: "live", child: true },
    ]);
  });

  it("output is a permutation of model.cards (no drop, no dup) with a grandchild present", () => {
    let m = initialModel();
    m = reduce(m, added(agent("A", "working")));
    m = reduce(m, added(agent("B", "working", { parentId: "A" })));
    m = reduce(m, added(agent("C", "working", { parentId: "B" })));
    m = reduce(m, added(agent("solo", "conflict")));

    const floor = selectFloor(m);
    expect(floor).toHaveLength(m.cards.size);
    expect(floor.map((t) => t.id).sort()).toEqual([...m.cards.keys()].sort());
  });

  it("breaks a malformed parentId cycle: each card appears exactly once, no infinite loop", () => {
    let m = initialModel();
    m = reduce(m, added(agent("A", "working", { parentId: "B" })));
    m = reduce(m, added(agent("B", "working", { parentId: "A" })));

    const floor = selectFloor(m);
    expect(floor).toHaveLength(2);
    expect(floor.map((t) => t.id).sort()).toEqual(["A", "B"]);
  });
});

describe("selectState integration (M10 Phase D: floor + teams)", () => {
  it("returns floor and teams equal to the standalone selectors", () => {
    let m = initialModel();
    m = reduce(m, added(agent("lead", "working")));
    m = reduce(m, added(agent("c1", "conflict", { parentId: "lead" })));
    m = reduce(m, added(agent("solo", "done")));

    const st = selectState(m);
    expect(st.floor).toEqual(selectFloor(m));
    expect(st.teams).toEqual(selectTeams(m));
  });

  it("always populates floor and teams (teams empty for a single childless agent)", () => {
    const m = reduce(initialModel(), added(agent("a1", "working")));
    const st = selectState(m);
    expect(st.floor).toEqual([{ id: "a1", size: "md", warmth: "live", child: false }]);
    expect(st.teams).toEqual([]);
  });
});

describe("selectHistory (M10 Phase F)", () => {
  it("returns recorded entries newest-first (highest seq first)", () => {
    let m = initialModel();
    m = reduce(m, added(agent("a1", "working")));
    m = reduce(m, added(agent("a2", "working")));
    m = reduce(m, added(agent("a3", "working")));
    expect(selectHistory(m).map((e) => e.seq)).toEqual([3, 2, 1]);
  });

  it("does not mutate model.history (it stays oldest-first after the call)", () => {
    let m = initialModel();
    m = reduce(m, added(agent("a1", "working")));
    m = reduce(m, added(agent("a2", "working")));
    selectHistory(m);
    expect(m.history.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("returns [] for an empty model", () => {
    expect(selectHistory(initialModel())).toEqual([]);
  });
});
