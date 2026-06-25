import { describe as d7, it as i7, expect as e7 } from "vitest";
import { initialModel as im7, reduce as r7 } from "../src/reducer.js";
import type { Agent as A7 } from "@hallucinate/core";

d7("reducer M7: detached attention", () => {
  i7("flags a detached card as attention", () => {
    const agent: A7 = {
      id: "a1",
      task: { id: "t1", description: "x", roleName: "R" },
      role: { name: "R", instructions: "", engine: { id: "fake" }, autonomy: "manual" },
      state: "detached",
      log: [],
    };
    const m = r7(im7(), { kind: "agent-added", agent });
    e7(m.cards.get("a1")!.attention).toBe(true);
  });
});
