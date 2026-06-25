import { describe, it, expect } from "vitest";
import type { ApprovalDetail, Agent } from "../src/types.js";

describe("ApprovalDetail", () => {
  it("is assignable to Agent.approvalDetail (tool + description)", () => {
    const detail: ApprovalDetail = { tool: "bash", description: "Run: npm test" };
    const partial: Pick<Agent, "approvalDetail"> = { approvalDetail: detail };
    expect(partial.approvalDetail?.tool).toBe("bash");
    expect(partial.approvalDetail?.description).toBe("Run: npm test");
  });

  it("is optional on Agent", () => {
    const partial: Pick<Agent, "approvalDetail"> = {};
    expect(partial.approvalDetail).toBeUndefined();
  });
});

import { describe as describeTeam, it as itTeam, expectTypeOf } from "vitest";
import type { Team, Role } from "../src/types.js";

describeTeam("Team type", () => {
  itTeam("has name and roles fields", () => {
    expectTypeOf<Team>().toMatchTypeOf<{ name: string; roles: Role[] }>();
  });
});

import { describe as describeSkills, it as itSkills, expectTypeOf as expectTypeOfSkills } from "vitest";
import type { Role as RoleSkills, Team as TeamSkills } from "../src/types.js";

describeSkills("Role.skills (P3)", () => {
  itSkills("Role can carry a skills array", () => {
    const role: RoleSkills = {
      name: "Tester",
      instructions: "Run tests.",
      engine: { id: "copilot" },
      autonomy: "manual",
      skills: ["run-tests"],
    };
    expectTypeOfSkills(role.skills).toEqualTypeOf<string[] | undefined>();
  });

  itSkills("Role type accepts optional skills field", () => {
    expectTypeOfSkills<RoleSkills>().toMatchTypeOf<{ skills?: string[] }>();
  });

  itSkills("Team type accepts optional skills field", () => {
    expectTypeOfSkills<TeamSkills>().toMatchTypeOf<{ skills?: string[] }>();
  });
});

import { describe as describeStates, it as itStates, expect as expectStates } from "vitest";
import type { AgentState as AgentStateT, PersistedAgentRecord, Agent as AgentT } from "../src/types.js";

describeStates("M7 types", () => {
  itStates("AgentState includes detached", () => {
    const s: AgentStateT = "detached";
    expectStates(s).toBe("detached");
  });
  itStates("PersistedAgentRecord wraps an Agent snapshot", () => {
    const agent = {
      id: "a1",
      task: { id: "t1", description: "x", roleName: "R" },
      role: { name: "R", instructions: "", engine: { id: "fake" }, autonomy: "manual" as const },
      state: "done" as AgentStateT,
      log: [],
    } satisfies AgentT;
    const rec: PersistedAgentRecord = { agent, workspacePath: "/wt/a1", workspaceBranch: "agent/a1" };
    expectStates(rec.agent.id).toBe("a1");
  });
});

import {
  describe as describeP4Types,
  it as itP4Types,
  expectTypeOf as expectTypeOfP4,
  expect as expectP4,
} from "vitest";
import type {
  Role as RoleP4,
  BuiltinTool,
  ToolGrant,
  SoulDoc,
} from "../src/types.js";

describeP4Types("P4 anatomy types", () => {
  itP4Types("BuiltinTool is the 5-name union", () => {
    const r: BuiltinTool = "Read";
    const e: BuiltinTool = "Edit";
    const ru: BuiltinTool = "Run";
    const s: BuiltinTool = "Search";
    const g: BuiltinTool = "Git";
    expectP4(r).toBe("Read");
    expectP4(e).toBe("Edit");
    expectP4(ru).toBe("Run");
    expectP4(s).toBe("Search");
    expectP4(g).toBe("Git");
  });

  itP4Types("Role accepts optional soul field", () => {
    const role: RoleP4 = {
      name: "Writer",
      instructions: "Write code.",
      engine: { id: "copilot" },
      autonomy: "manual",
      soul: "writer-soul",
    };
    expectTypeOfP4(role.soul).toEqualTypeOf<string | undefined>();
  });

  itP4Types("Role accepts optional tools field (ToolGrant)", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read", "Search"], write: ["Edit"] },
    };
    const role: RoleP4 = {
      name: "Coder",
      instructions: "Write tests.",
      engine: { id: "copilot" },
      autonomy: "manual",
      tools: grant,
    };
    expectTypeOfP4(role.tools).toEqualTypeOf<ToolGrant | undefined>();
  });

  itP4Types("ToolGrant supports mcp entries", () => {
    const grant: ToolGrant = {
      mcp: [{ server: "sec-kit", read: true, write: false }],
    };
    expectP4(grant.mcp?.[0]?.server).toBe("sec-kit");
  });

  itP4Types("SoulDoc requires raw field and allows optional sections", () => {
    const doc: SoulDoc = {
      identity: "I am a helpful coder.",
      principles: "Write clean code.",
      raw: "# Soul\nI am a helpful coder.",
    };
    expectP4(doc.raw).toContain("Soul");
    expectTypeOfP4(doc.redLines).toEqualTypeOf<string | undefined>();
  });
});
