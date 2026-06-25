# Maestro P4: Agent Anatomy (Soul and Tools) Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Drive every task red -> green -> commit, one subagent per task, full gate green at each commit.

> Part of the [roadmap](./README.md). UX spec: [03](../2026-06-16-conducting-board-design/03-agents-teams-and-anatomy.md), [04](../2026-06-16-conducting-board-design/04-reusable-skills.md).

---

## Goal

Turn the enriched agent anatomy into real behavior. P3 made `Role.skills?` a first-class library object and inlined resolved skill bodies with a minimal append so skills worked end to end. P4 finishes the anatomy:

1. **Soul** (`Role.soul?`): a `.conductor/souls/<name>.md` reference resolving to plain markdown (Identity / Principles / Voice / Priorities / Red lines), loaded, parsed, serialized, and round-tripped through the M8 config layer (R6).
2. **Tools** (`Role.tools?: ToolGrant`): the granular grant model with read and write tracked apart, **write off by default** (absent grant means no access, absent write means read-only). Validator, serializer, and a small `"N granted, M can write"` selector.
3. **Composition-at-spawn** (seam R3, **P4 is the single owner now**): one ordered system preamble, Soul -> Instructions -> Tools -> Skills -> Task, assembled once and threaded into the Copilot adapter `buildArgs` and the ACP adapter `session/new` (the `initialize` `systemPrompt`). This **replaces** P3's minimal skills append (the duplication is removed; this assembler becomes the source of truth). The preamble frames soul **red lines** as overriding task instructions.
4. **The anatomy editor** (the big drawn screen): the full editor webview with the left anatomy sub-rail (Identity / Soul / Instructions / Tools / Skills / Engine / Autonomy, each a status dot) over a single scroll canvas (twin Soul + Instructions markdown editors, the Tools permission grid, the Skills section with the Add-skill grant-gate, engine pills, the autonomy segmented control). Opens from the Library Agents tab (seam R4) and from a board card drawer "edit".
5. **CardVM anatomy row**: populate the placeholder fields P1 added (`soul` boolean, `toolsCount`, `skills`) from the resolved Role so the board and library card anatomy rows render the soul / tools / skills summary.
6. **Protocol**: role-edit messages (`role-set-soul`, `role-set-tools`, `role-set-instructions`, `role-set-engine`, `role-set-autonomy`, `grant-tool`), `isWebviewMessage` updated, exhaustive switches extended, all persisted through the config serializer (R6).

Definition of done: `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` all green; the Self-Review maps every design-doc requirement to its task.

---

## Architecture

The brain-vs-shell split holds. The composition logic is **pure** and lives in `@maestro/core` (it is the single source of truth both adapters call). The soul and tools persistence lives in `@maestro/config` next to the M8 validator/serializer/loader. The editor is webview UI in `@maestro/extension`, with all writes routed through the config serializer.

```
@maestro/core
  src/types.ts          + Role.soul?, Role.tools? (ToolGrant), SoulDoc shape, BuiltinTool union
  src/compose.ts        NEW. composePreamble(parts) -> ordered preamble string (THE single owner, R3)
  src/tools-select.ts   NEW. pure selectors: countGrants(tools) -> { granted, canWrite }

@maestro/config
  src/souls.ts          NEW. parseSoul / serializeSoul (markdown sections), loadSoul (injectable fs)
  src/validator.ts      + validateTools(raw) (write off by default), soul as by-name warning
  src/serializer.ts     + tools round-trip on the role YAML; serializeSoul writes souls/<name>.md
  src/loader.ts         + resolve soul + tools onto the loaded Role; build souls index
  src/grant-gate.ts     NEW. pure predicate: skillNeedsGrant(skill, role.tools) -> GrantGap | null

@maestro/cockpit
  src/protocol.ts       + role-edit message variants, anatomy fields on CardVM, isWebviewMessage update
  src/reducer.ts        populate soul / toolsCount / skills on CardVM from the resolved Role

@maestro/extension
  src/anatomy/*.ts       NEW. anatomy-editor host controller + webview (vanilla TS, graphite palette R2)
  src/controller.ts      + handle role-edit + grant-tool messages, persist via @maestro/config
  src/extension.ts       open editor from Library Agents tab + board card drawer "edit"

adapter-copilot/src/args.ts    buildArgs calls core composePreamble, threads it into -p (was task.description only)
adapter-acp/src/adapter.ts     AcpSession opts.instructions becomes the composed preamble
adapter-acp/src/session.ts     start() sends preamble as systemPrompt, task.description as the first user_turn
```

### Where the preamble is assembled today (grounded in the real code)

- **Copilot** (`packages/adapter-copilot/src/args.ts`, `buildArgs`): the argv is `["-C", workspace.path, "-p", task.description, "-s", "--no-ask-user", "--allow-all"]`. `role.instructions` is **not** sent today; only `task.description` rides in `-p`. P4 threads the composed preamble (Soul, Instructions, Tools, Skills, Task) into the `-p` value. `buildArgs(task, workspace, role, outputFormat)` already receives `role`, so no signature change is required to reach soul/tools/skills.
- **ACP** (`packages/adapter-acp/src/adapter.ts` -> `AcpSession`, then `packages/adapter-acp/src/session.ts` `start()` -> `packages/adapter-acp/src/messages.ts` `buildInitialize`): the adapter passes `instructions: role.instructions` into `AcpSession`; `start()` calls `buildInitialize({ instructions, ... })`, which maps `instructions` straight to `params.systemPrompt`, then `buildUserTurn(task.description)`. P4 makes the value passed as `instructions` be the **composed preamble minus the Task**, and keeps the Task delivered as the first `user_turn`. (The ACP "session/new" of the design maps to this `initialize` + first `user_turn` pair in the shipped code.)

Both adapters call the same `composePreamble` from `@maestro/core`, so the order and the red-lines framing are identical on both engines and are guarded once by the conformance suite plus per-adapter assertions.

### Skill-body resolution boundary (R3 handoff from P3)

P3 owns resolving a `Role.skills` name to its SKILL.md body (the loader builds `SkillManifest[]` and a name -> body map). P4 does **not** re-implement skill resolution; `composePreamble` accepts already-resolved skill bodies as an input array. P4's only change to P3's skills behavior is to **remove** P3's standalone minimal append and route the resolved bodies through `composePreamble` instead, so there is exactly one place text gets assembled.

---

## Scope

### IN (P4 owns)

- `Role.soul?` and the souls loader / parser / serializer (`.conductor/souls/<name>.md`, R6).
- `Role.tools?: ToolGrant` with write off by default; validator + serializer + the `"N granted, M can write"` selector.
- The single ordered `composePreamble` (Soul -> Instructions -> Tools -> Skills -> Task) with the red-lines precedence framing, wired into both adapters; **P3's minimal append removed** (R3).
- The full anatomy editor webview (sub-rail + scroll canvas, twin editors, Tools grid, Skills section).
- The Add-skill grant-gate (seam R5) as a pure predicate plus its inline expansion UI (Grant / Attach-without-granting / Cancel).
- CardVM anatomy population (`soul`, `toolsCount`, `skills`).
- Role-edit protocol messages + `grant-tool`; `isWebviewMessage` + exhaustive switches updated; persistence via the config serializer (R6).

### OUT (deferred, with owning phase)

- Discover / adopt of foreign souls/roles/skills and the adopt autonomy clamp: **P5**.
- The full-width diff / merge review screen: **P6**.
- MCP server **enumeration** at editor-open time (the live set of connected servers is a workspace concern, design 03 open question 5). P4 models MCP grants in `ToolGrant.mcp` and renders any servers passed in, but does not discover them; sourcing the list is **P5**.
- Marketplace / community publishing: out of all current phases.
- **Team charter red-lines union** (design 03 "Shared souls and team charters"): primarily **P5/team work**. P4 includes it only as the small optional stretch in Task 11 (`composePreamble` already takes a `redLineOverlay` parameter so the union is a one-line caller change later); if not cheap, defer.

### Depends on

P3 (skills as a library object, the Library shell with the Agents tab, the resolved-skill-body map, the P1 CardVM placeholder fields and the board card drawer). P4 also builds on M8 (`@maestro/config`) for the YAML round-trip and on the M5/M6 conformance suite for the two-adapter preamble guard.

---

## File Structure

```
packages/core/
  src/
    types.ts            (delta) + Role.soul?, Role.tools?, ToolGrant, BuiltinTool, SoulDoc
    compose.ts          NEW
    tools-select.ts     NEW
    index.ts            (delta) re-export compose + tools-select
  test/
    compose.test.ts     NEW
    tools-select.test.ts NEW

packages/config/
  src/
    souls.ts            NEW
    grant-gate.ts       NEW
    validator.ts        (delta) validateTools + soul by-name warning
    serializer.ts       (delta) tools on role YAML + serializeSoul
    loader.ts           (delta) resolve soul + tools onto Role, souls index
    index.ts            (delta)
  test/
    souls.test.ts       NEW
    grant-gate.test.ts  NEW
    validator.test.ts   (delta) tools defaults
    serializer.test.ts  (delta) tools round-trip
    loader.test.ts      (delta) soul + tools resolution

packages/cockpit/
  src/
    protocol.ts         (delta) role-edit messages, CardVM anatomy fields, isWebviewMessage
    reducer.ts          (delta) populate soul / toolsCount / skills
  test/
    protocol.test.ts    (delta) new variants guarded
    reducer.test.ts     (delta) anatomy population

packages/extension/
  src/
    anatomy/
      anatomy-controller.ts   NEW (pure host controller, fake config writer in tests)
      anatomy-view.ts         NEW (vanilla TS webview, graphite palette R2)
      anatomy-protocol.ts     NEW (host<->webview messages for the editor)
    controller.ts             (delta) role-edit + grant-tool handlers, persist via config
    extension.ts              (delta) open-editor wiring (Library tab + board drawer)
  test/
    anatomy-controller.test.ts NEW
```

No new runtime deps. `@maestro/config` already depends on `yaml` (M8); souls are plain markdown, no YAML frontmatter, so no parser dep is added.

---

## Tasks

Order: pure core first (types, compose, selectors), then config persistence, then cockpit data, then the extension editor, then the two-adapter wiring, then the grant-gate UI, last the optional charter stretch. Each task is red -> green -> commit. Commit messages end with the `Co-Authored-By` trailer.

---

### Task 1: `Role.soul?`, `Role.tools?`, `ToolGrant`, `BuiltinTool`, `SoulDoc` in core types

**Files:** `packages/core/src/types.ts`, `packages/core/test/types.test.ts`

The shapes are the canonical ones from design 07 section 3a (the source of truth). `ToolGrant` tracks read and write as **separate lists**, so write is structurally off unless an entry is added.

```typescript
/** The five built-in capability names the anatomy Tools grid renders. */
export type BuiltinTool = "Read" | "Edit" | "Run" | "Search" | "Git";

/** A granular tool grant. Read and write are tracked APART; write is off by
 *  default because absence of a write entry means read-only. */
export interface ToolGrant {
  builtins?: {
    /** Read-capable built-ins the agent may use. */
    read?: ("Read" | "Search")[];
    /** Write-capable built-ins. OFF by default; must be granted explicitly. */
    write?: ("Edit" | "Run" | "Git")[];
  };
  /** Named MCP servers, each scoped read vs write. */
  mcp?: Array<{ server: string; read?: boolean; write?: boolean }>;
}

/** A parsed soul.md: stable identity across tasks. Sections per design 03. */
export interface SoulDoc {
  identity?: string;
  principles?: string;
  voice?: string;
  priorities?: string;
  /** Actions the agent will never take, regardless of instructions (Tier 1). */
  redLines?: string;
  /** The full raw markdown, kept so a round-trip never loses content. */
  raw: string;
}
```

`Role` gains two optional fields (additive, absence === today's behavior):

```typescript
export interface Role {
  name: string;
  instructions: string;
  engine: { id: string; model?: string };
  autonomy: "manual" | "auto-approve-safe" | "yolo";
  soul?: string;     // resolves .conductor/souls/<soul>.md
  tools?: ToolGrant;
  skills?: string[]; // added in P3; listed here for completeness
}
```

- [ ] Red: append to `packages/core/test/types.test.ts` a `expectTypeOf` test asserting `Role` accepts optional `soul: string` and `tools: ToolGrant`, and that `BuiltinTool` is the 5-name union. Run `pnpm --filter @maestro/core test` -> red.
- [ ] Green: add the types to `packages/core/src/types.ts` (after `Role`). They export via the existing `export * from "./types.js"`. Run -> green.
- [ ] Commit: `feat(core): add Role.soul, Role.tools (ToolGrant), BuiltinTool, SoulDoc (P4)`

---

### Task 2: `composePreamble` (the single ordered assembler, R3)

**Files:** `packages/core/src/compose.ts`, `packages/core/test/compose.test.ts`, `packages/core/src/index.ts`

This is THE source of truth for the system preamble. It is pure (string in, string out), takes already-resolved inputs (soul text, instructions, a rendered tools summary, resolved skill bodies, the task), and assembles them in the fixed order with explicit headers. The **red-lines framing** is a clearly-headed section near the top stating that red lines override task instructions.

```typescript
import type { SoulDoc } from "./types.js";

export interface PreambleParts {
  /** Parsed soul, if the role carries one. */
  soul?: SoulDoc;
  /** Role.instructions (the standing task description). */
  instructions: string;
  /** Human-readable tool grant lines (from renderToolsForPreamble). Empty -> omitted. */
  tools?: string;
  /** Resolved SKILL.md bodies in attach order. Empty -> the Skills section is omitted. */
  skills?: string[];
  /** The concrete dispatch task. */
  task: string;
  /** OPTIONAL team-charter red lines unioned in (Task 11 stretch). Tighten-only. */
  redLineOverlay?: string;
}

/**
 * Assemble the system preamble in the fixed order:
 *   Soul -> Instructions -> Tools -> Skills -> Task.
 * Soul red lines are framed FIRST inside the Soul block under an explicit
 * "RED LINES (these override the task; never violate them)" header, so the
 * engine reads the precedence before it reads the work.
 *
 * Precedence contract (documented, not runtime-enforced):
 *  - Soul RED LINES outrank task instructions (Tier 1, non-overridable).
 *  - Soul principles / priorities are overridable defaults (Tier 2): they shape
 *    behavior when the task is silent, but an explicit conflicting instruction wins.
 */
export function composePreamble(parts: PreambleParts): string {
  const blocks: string[] = [];

  if (parts.soul || parts.redLineOverlay) {
    blocks.push(renderSoulBlock(parts.soul, parts.redLineOverlay));
  }
  blocks.push(`# Instructions\n${parts.instructions.trim()}`);
  if (parts.tools && parts.tools.trim().length > 0) {
    blocks.push(`# Tools (granted permissions; you may use only these)\n${parts.tools.trim()}`);
  }
  if (parts.skills && parts.skills.length > 0) {
    blocks.push(`# Skills (standing procedures)\n${parts.skills.map((s) => s.trim()).join("\n\n")}`);
  }
  blocks.push(`# Task\n${parts.task.trim()}`);
  return blocks.join("\n\n");
}
```

`renderSoulBlock` emits, in order: a heading, the RED LINES section first (the union of soul red lines and any `redLineOverlay`), then identity, voice, principles, priorities. The literal phrase "override the task" must appear so the precedence is unmistakable in the text.

- [ ] Red: `packages/core/test/compose.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { composePreamble } from "../src/compose.js";
import type { SoulDoc } from "../src/index.js";

const soul: SoulDoc = {
  identity: "A careful test author.",
  principles: "Prefer small focused commits.",
  redLines: "Never weaken a test to make it pass.",
  raw: "...",
};

describe("composePreamble", () => {
  it("orders the blocks Soul -> Instructions -> Tools -> Skills -> Task", () => {
    const out = composePreamble({
      soul,
      instructions: "Review the diff.",
      tools: "Read (read-only). Git (write).",
      skills: ["# run-tests\nRun the suite."],
      task: "Fix the failing spec in foo.test.ts.",
    });
    const iSoul = out.indexOf("careful test author");
    const iInstr = out.indexOf("Review the diff");
    const iTools = out.indexOf("read-only");
    const iSkill = out.indexOf("run-tests");
    const iTask = out.indexOf("Fix the failing spec");
    expect(iSoul).toBeLessThan(iInstr);
    expect(iInstr).toBeLessThan(iTools);
    expect(iTools).toBeLessThan(iSkill);
    expect(iSkill).toBeLessThan(iTask);
  });

  it("frames red lines as overriding the task, before the instructions", () => {
    const out = composePreamble({ soul, instructions: "x", task: "y" });
    const iRed = out.indexOf("Never weaken a test");
    const iInstr = out.indexOf("# Instructions");
    expect(iRed).toBeLessThan(iInstr);
    expect(out).toMatch(/override the task/i);
  });

  it("omits Soul, Tools, and Skills sections when absent (back-compat with bare role)", () => {
    const out = composePreamble({ instructions: "Do the thing.", task: "Now." });
    expect(out).not.toContain("# Tools");
    expect(out).not.toContain("# Skills");
    expect(out.indexOf("# Instructions")).toBeLessThan(out.indexOf("# Task"));
  });

  it("unions a team-charter red-line overlay into the red lines block", () => {
    const out = composePreamble({
      soul,
      instructions: "x",
      task: "y",
      redLineOverlay: "Never push directly to main.",
    });
    expect(out).toContain("Never weaken a test");
    expect(out).toContain("Never push directly to main");
  });
});
```

Run `pnpm --filter @maestro/core test` -> red.
- [ ] Green: implement `compose.ts` + `renderSoulBlock`; add `export * from "./compose.js"` to `index.ts`. Run -> green.
- [ ] Commit: `feat(core): composePreamble single ordered assembler with red-line framing (P4, R3)`

---

### Task 3: tool-grant selectors and preamble rendering

**Files:** `packages/core/src/tools-select.ts`, `packages/core/test/tools-select.test.ts`, `packages/core/src/index.ts`

Two pure helpers over `ToolGrant`. `countGrants` powers the editor's `"N granted, M can write"` summary and the CardVM `toolsCount`. `renderToolsForPreamble` produces the human-readable tool lines `composePreamble` inlines. **Write off by default** is the structural invariant: a `ToolGrant` with only `builtins.read` reports `canWrite: 0`.

```typescript
import type { ToolGrant } from "./types.js";

export interface GrantCount {
  /** Distinct tools the agent may touch at all (read or write, built-in or MCP). */
  granted: number;
  /** Distinct tools the agent may WRITE with (write built-ins + write MCP servers). */
  canWrite: number;
}

export function countGrants(tools: ToolGrant | undefined): GrantCount {
  if (!tools) return { granted: 0, canWrite: 0 };
  const reads = new Set(tools.builtins?.read ?? []);
  const writes = new Set(tools.builtins?.write ?? []);
  const mcp = tools.mcp ?? [];
  const granted =
    new Set<string>([...reads, ...writes]).size +
    mcp.filter((m) => m.read || m.write).length;
  const canWrite = writes.size + mcp.filter((m) => m.write).length;
  return { granted, canWrite };
}

/** Render grants as constraint lines for the preamble. Read-only tools say so;
 *  write grants are tagged "(write)" so the engine treats them as mutating. */
export function renderToolsForPreamble(tools: ToolGrant | undefined): string { /* ... */ }
```

- [ ] Red: `tools-select.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { countGrants } from "../src/tools-select.js";
import type { ToolGrant } from "../src/index.js";

describe("countGrants", () => {
  it("reports zero for an absent grant", () => {
    expect(countGrants(undefined)).toEqual({ granted: 0, canWrite: 0 });
  });
  it("counts read-only built-ins as granted but not writable (write off by default)", () => {
    const t: ToolGrant = { builtins: { read: ["Read", "Search"] } };
    expect(countGrants(t)).toEqual({ granted: 2, canWrite: 0 });
  });
  it("counts a write built-in toward both granted and canWrite", () => {
    const t: ToolGrant = { builtins: { read: ["Read"], write: ["Git"] } };
    expect(countGrants(t)).toEqual({ granted: 2, canWrite: 1 });
  });
  it("counts MCP servers with write scope toward canWrite", () => {
    const t: ToolGrant = { mcp: [{ server: "sec-kit", read: true, write: true }] };
    expect(countGrants(t)).toEqual({ granted: 1, canWrite: 1 });
  });
});
```

Run -> red. Implement, export, run -> green.
- [ ] Commit: `feat(core): countGrants + renderToolsForPreamble selectors, write off by default (P4)`

---

### Task 4: souls loader / parser / serializer in config

**Files:** `packages/config/src/souls.ts`, `packages/config/test/souls.test.ts`, `packages/config/src/index.ts`

A soul is plain markdown at `.conductor/souls/<name>.md` with `## Identity / ## Principles / ## Voice / ## Priorities / ## Red lines` sections (design 03). `parseSoul` splits on `##` headers into a `SoulDoc` (tolerant: unknown headers are kept in `raw`, missing sections are `undefined`). `serializeSoul` writes the canonical section order back. `loadSoul` reads a named file behind the same injectable `FsReader` the M8 loader uses (offline tests, no disk).

```typescript
import type { SoulDoc } from "@maestro/core";
import type { FsReader } from "./loader.js";
import * as nodePath from "node:path";

export function parseSoul(markdown: string): SoulDoc { /* split on ^## headers */ }
export function serializeSoul(soul: SoulDoc): string { /* canonical section order */ }

export async function loadSoul(
  workspaceRoot: string,
  soulName: string,
  fs: FsReader,
): Promise<{ soul: SoulDoc; source: string } | { error: string; source: string }> { /* ... */ }
```

- [ ] Red: `souls.test.ts` covers: parse extracts each section by header; an unknown header survives into `raw`; `serializeSoul(parseSoul(md))` round-trips the five known sections; `loadSoul` returns an error object (not a throw) when the file is missing (mirrors the validateTeam by-name warning model).

```typescript
import { describe, it, expect } from "vitest";
import { parseSoul, serializeSoul } from "../src/souls.js";

const MD = `## Identity
A careful reviewer.

## Red lines
Never approve a diff you did not read.
`;

describe("parseSoul", () => {
  it("extracts known sections by header", () => {
    const s = parseSoul(MD);
    expect(s.identity).toContain("careful reviewer");
    expect(s.redLines).toContain("Never approve");
  });
  it("round-trips through serializeSoul", () => {
    const again = parseSoul(serializeSoul(parseSoul(MD)));
    expect(again.identity).toContain("careful reviewer");
    expect(again.redLines).toContain("Never approve");
  });
});
```

Run -> red. Implement, export from `index.ts`, run -> green.
- [ ] Commit: `feat(config): soul markdown parser/serializer/loader for .conductor/souls (P4, R6)`

---

### Task 5: validate + serialize + load `Role.tools` and the `soul` reference

**Files:** `packages/config/src/validator.ts`, `packages/config/src/serializer.ts`, `packages/config/src/loader.ts`, plus `test/validator.test.ts`, `test/serializer.test.ts`, `test/loader.test.ts`

Extend the M8 config layer additively (no existing behavior removed):

- **validator:** a `validateTools(raw)` that accepts the `ToolGrant` shape, rejects unknown built-in names, and treats a missing `write` block as **read-only** (write off by default). `validateRole` calls it when `tools` is present and accepts an optional `soul` string. An unknown `soul` name is **not** validated here (the file may not exist yet); like `Team.roles`, resolution is a loader-time by-name warning, never a hard error.
- **serializer:** `serializeRole` emits the `tools:` block and `soul:` field when present, omits them when absent (so bare roles serialize byte-identically to M8). The `ToolGrant` shape round-trips: read list, write list, mcp array.
- **loader:** after parsing a role, if it has `soul`, call `loadSoul`; a missing soul file pushes a `ValidationWarning` (not an error) and leaves `Role.soul` as the bare name. `tools` is already on the parsed role. Build a `souls` index on `LoadResult` for the editor.

- [ ] Red: append to `validator.test.ts`:

```typescript
it("treats a tools grant with no write block as read-only (write off by default)", () => {
  const r = validateRole({ ...validRoleRaw, tools: { builtins: { read: ["Read"] } } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.tools?.builtins?.write ?? []).toHaveLength(0);
});
it("rejects an unknown built-in tool name", () => {
  const r = validateRole({ ...validRoleRaw, tools: { builtins: { write: ["Deploy"] } } });
  expect(r.ok).toBe(false);
});
it("accepts an optional soul reference without resolving it", () => {
  const r = validateRole({ ...validRoleRaw, soul: "reviewer" });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.soul).toBe("reviewer");
});
```

Append to `serializer.test.ts` a round-trip: `parseRoleYaml(serializeRole(roleWithTools))` preserves the read list, the write list, the mcp array, and the `soul` name; a role with no tools/soul produces YAML with no `tools:` or `soul:` key.

Append to `loader.test.ts`: a role referencing `soul: reviewer` with a present `souls/reviewer.md` resolves with no warning; with the file absent, the load **warns** and keeps the role.

Run `pnpm --filter @maestro/config test` -> red.
- [ ] Green: implement the three deltas. Run -> green.
- [ ] Commit: `feat(config): validate/serialize/load Role.tools and soul reference (P4, R6)`

---

### Task 6: the grant-gate predicate (seam R5)

**Files:** `packages/config/src/grant-gate.ts`, `packages/config/test/grant-gate.test.ts`, `packages/config/src/index.ts`

A pure predicate that diffs a skill's declared `allowedTools` against a role's current `ToolGrant`. If the skill needs a tool the role lacks (especially **write**, which is off by default), it returns a `GrantGap` describing exactly what is missing; otherwise `null`. This is the structural heart of seam R5: attaching a skill is never a back door to write access. No UI here; the UI (Task 9) renders the gap.

```typescript
import type { ToolGrant } from "@maestro/core";

export interface GrantGap {
  /** Built-in tools the skill needs that the role cannot WRITE with yet. */
  missingWrite: string[];
  /** Built-in tools the skill needs that the role cannot even READ yet. */
  missingRead: string[];
  /** MCP servers the skill needs that the role has not been granted. */
  missingMcp: string[];
}

/** Parse a skill's allowed-tools (e.g. "Git(write)", "Read", "mcp:sec-kit")
 *  and return the gap against the role's grant, or null if fully covered. */
export function skillNeedsGrant(
  allowedTools: string[] | undefined,
  tools: ToolGrant | undefined,
): GrantGap | null { /* ... */ }
```

- [ ] Red: `grant-gate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { skillNeedsGrant } from "../src/grant-gate.js";
import type { ToolGrant } from "@maestro/core";

describe("skillNeedsGrant", () => {
  it("returns null when the skill needs nothing", () => {
    expect(skillNeedsGrant([], { builtins: { read: ["Read"] } })).toBeNull();
  });
  it("flags Git(write) as a gap when the role has only Git read or nothing", () => {
    const gap = skillNeedsGrant(["Git(write)"], { builtins: { read: ["Read"] } });
    expect(gap?.missingWrite).toContain("Git");
  });
  it("does NOT flag a write the role already has (no false gate)", () => {
    const gap = skillNeedsGrant(["Git(write)"], { builtins: { write: ["Git"] } });
    expect(gap).toBeNull();
  });
  it("flags a missing MCP server", () => {
    const gap = skillNeedsGrant(["mcp:sec-kit"], undefined);
    expect(gap?.missingMcp).toContain("sec-kit");
  });
});
```

Run -> red. Implement, export, run -> green.
- [ ] Commit: `feat(config): skillNeedsGrant grant-gate predicate, write never auto-granted (P4, R5)`

---

### Task 7: CardVM anatomy fields + reducer population

**Files:** `packages/cockpit/src/protocol.ts`, `packages/cockpit/src/reducer.ts`, `packages/cockpit/test/reducer.test.ts`

P1 added placeholder anatomy fields to `CardVM`. P4 populates them from the resolved Role so the board and library card rows render `☽ soul · 🔧 N · ◆ skill +M`. The fields:

```typescript
// CardVM additions (P1 declared them; P4 fills them):
soul: boolean;            // role.soul !== undefined
toolsCount: number;       // countGrants(role.tools).granted
toolsCanWrite: number;    // countGrants(role.tools).canWrite  (drives the amber 🔧)
skills: string[];         // role.skills ?? []
```

`cardFromAgent` reads `agent.role` and fills them via `countGrants` (imported from `@maestro/core`). The renderer (extension) shows the compact row only when at least one enrichment is present (`soul || toolsCount > 0 || skills.length > 0`), per design 03.

- [ ] Red: `reducer.test.ts` adds a case: an `agent-added` whose `role` carries `soul: "x"`, `tools: { builtins: { read: ["Read"], write: ["Git"] } }`, and `skills: ["run-tests"]` produces a CardVM with `soul: true`, `toolsCount: 2`, `toolsCanWrite: 1`, `skills: ["run-tests"]`. A bare role produces `soul: false`, `toolsCount: 0`, `skills: []`. Run -> red.
- [ ] Green: extend `cardFromAgent`. Run `pnpm --filter @maestro/cockpit test` -> green.
- [ ] Commit: `feat(cockpit): populate CardVM soul/toolsCount/skills anatomy row from Role (P4)`

---

### Task 8: role-edit + grant-tool protocol messages and `isWebviewMessage`

**Files:** `packages/cockpit/src/protocol.ts`, `packages/cockpit/test/protocol.test.ts`

Add the editor's outbound messages to `WebviewToHost`. All carry a `roleName` (the role being edited), not an `agentId` (anatomy edits target the reusable template, not a running agent):

```typescript
  | { type: "role-set-soul"; roleName: string; soul: string }            // soul.md body
  | { type: "role-set-instructions"; roleName: string; instructions: string }
  | { type: "role-set-tools"; roleName: string; tools: ToolGrant }
  | { type: "role-set-engine"; roleName: string; engineId: string; model?: string }
  | { type: "role-set-autonomy"; roleName: string; autonomy: "manual" | "auto-approve-safe" | "yolo" }
  | { type: "grant-tool"; roleName: string; tool: string; write: boolean }  // used by the grant-gate
```

`isWebviewMessage` is extended: a `ROLE_NAME_TYPES` set parallel to `AGENT_ID_TYPES` requires `roleName: string`; the `switch` gains a case per new type validating its payload (`role-set-tools` validates `tools` is an object; `role-set-engine` validates `engineId` is a string and `model` is string-or-absent; `role-set-autonomy` validates the three-value union; `grant-tool` validates `tool` string + `write` boolean). The `default` exhaustiveness branch is preserved so a future unhandled variant is a compile error.

- [ ] Red: `protocol.test.ts` asserts `isWebviewMessage` accepts each well-formed new message and rejects malformed ones (missing `roleName`, bad `autonomy`, `tools` not an object, `grant-tool` with non-boolean `write`). Also assert a `role-set-*` with an extra unknown field still validates (forward-compat) but a missing required field does not. Run -> red.
- [ ] Green: extend the union, `ROLE_NAME_TYPES`, and the switch. Run -> green.
- [ ] Commit: `feat(cockpit): role-edit + grant-tool protocol messages, isWebviewMessage guard (P4)`

---

### Task 9: the anatomy editor (host controller + webview)

**Files:** `packages/extension/src/anatomy/anatomy-controller.ts`, `packages/extension/src/anatomy/anatomy-view.ts`, `packages/extension/src/anatomy/anatomy-protocol.ts`, `packages/extension/test/anatomy-controller.test.ts`, plus deltas to `controller.ts` and `extension.ts`

Keep the pure-brain/thin-shell split exactly as M4 did: a vscode-free `anatomy-controller.ts` (unit-testable with a fake config writer) and a separate `anatomy-view.ts` that owns the DOM. The view is **vanilla TS bundled by esbuild as an IIFE**, on the **graphite palette (R2)**, not `var(--vscode-*)`.

**The host controller** receives the role-edit and `grant-tool` messages, applies them to an in-memory `Role`, and persists each change through `@maestro/config`:
- `role-set-soul` -> `serializeSoul` -> write `.conductor/souls/<name>.md` (R6); if the role had no `soul`, set `role.soul = <name>` and re-serialize the role YAML.
- `role-set-instructions` / `role-set-engine` (engine id checked against `KNOWN_ENGINE_IDS`, R6) / `role-set-autonomy` / `role-set-tools` -> mutate the `Role` -> `serializeRole` -> write `.conductor/roles/<name>.yaml`.
- `grant-tool` -> add the tool to `role.tools.builtins.read` or `.write` (or the mcp entry) -> `serializeRole` -> write. This is the grant arm of the grant-gate (Task 6 computes the gap; this applies the grant).

All writes go through the injected config writer, and the path is contained to `.conductor/` (symlink containment + KNOWN_ENGINE_IDS preserved, R6). The controller never writes outside `.conductor/`.

**The webview** draws the full screen per design 03:
- **Left anatomy sub-rail** (Identity / Soul / Instructions / Tools / Skills / Engine / Autonomy), each a status dot: filled when the section has content, hollow otherwise. Clicking smooth-scrolls the canvas.
- **Scroll canvas:** Identity (name + description + read-only `engine · autonomy` line); twin **Soul** and **Instructions** markdown editors; the **Tools** permission grid (Built-in group with a Read toggle and a Write toggle per row, the Write toggle carrying an amber `#f0a030` "can write" badge and **off by default**; an MCP collapsible sub-group; a right-aligned `"N granted · M can write"` summary computed from `countGrants`, the can-write count turning amber when M > 0); the **Skills** section with `◆` chips and the `+ Add skill` button (Task 10 adds the grant-gate to the picker); **Engine** pills (one active); the **Autonomy** segmented control (Manual / Auto-approve safe / Full auto).
- Every toggle / field change posts the matching `role-set-*` message; the webview never writes disk.

- [ ] Red: `anatomy-controller.test.ts` with a fake config writer (records writes, never touches disk). Assert:
  - `role-set-tools` with a write grant serializes a role YAML whose `tools.builtins.write` includes the tool, written to `.conductor/roles/<name>.yaml`.
  - `role-set-soul` writes `.conductor/souls/<name>.md` with the body and, on a previously-soul-less role, sets `soul:` in the role YAML.
  - `role-set-engine` with an id NOT in `KNOWN_ENGINE_IDS` is refused (no write) and surfaces an error (R6).
  - `grant-tool { tool: "Git", write: true }` adds `Git` to the write list and persists.
  - the `"N granted, M can write"` summary the controller exposes matches `countGrants`.

  Run `pnpm --filter @maestro/extension test` -> red.
- [ ] Green: implement the controller, the protocol, and the view; wire `controller.ts` to dispatch the new messages to `anatomy-controller`; wire `extension.ts` to open the editor from the Library Agents tab (seam R4) and from the board card drawer "edit". Run -> green; `pnpm --filter @maestro/extension build` emits both bundles.
- [ ] Commit: `feat(extension): anatomy editor (sub-rail + canvas, tools grid) persisting via config (P4, R2/R6)`

---

### Task 10: the Add-skill grant-gate UI (seam R5)

**Files:** `packages/extension/src/anatomy/anatomy-view.ts` (Add-skill picker modal), `packages/extension/src/anatomy/anatomy-controller.ts`, `packages/extension/test/anatomy-controller.test.ts`

P3 shipped an Add-skill picker that attaches a skill but, lacking the tools model, could only show the skill's declared requirements. P4 wires in the gate now that `Role.tools` exists. On attach, the host runs `skillNeedsGrant` (Task 6). If it returns a gap, the picker row **expands inline** (3px amber `#f0a030` left border) and replaces the description with `<skill> needs <Tool>(write). This agent does not have it yet.` plus three buttons:
1. **Grant `<Tool>(write)` to `<Agent>`** -> posts `grant-tool` -> controller adds the grant, persists, then completes the attach; row collapses.
2. **Attach without granting** -> attaches but flags the chip amber until resolved.
3. **Cancel** -> collapses the row, no change.

Only one row expands at a time. The gate is the loudest amber in the system because it prevents a silent privilege escalation.

- [ ] Red: extend `anatomy-controller.test.ts`: attaching a skill whose `allowedTools` is `["Git(write)"]` to a role with only `Read` returns a gate (no silent grant, no write added); the explicit `grant-tool` path then adds `Git` write and persists; the "attach without granting" path attaches and records the amber-flag state without granting. Run -> red.
- [ ] Green: implement the gate branch in the controller + the inline-expansion UI in the view. Run -> green.
- [ ] Commit: `feat(extension): Add-skill grant-gate, write never silently granted (P4, R5)`

---

### Task 11: wire `composePreamble` into both adapters; remove P3's minimal append (R3)

**Files:** `packages/adapter-copilot/src/args.ts`, `packages/adapter-copilot/test/args.test.ts`, `packages/adapter-acp/src/adapter.ts`, `packages/adapter-acp/src/session.ts`, `packages/adapter-acp/test/session.test.ts`, `packages/conformance/*`

This is where the data becomes behavior, on both engines, guarded by the conformance suite. The adapters already receive `role`, so soul/tools/skills are reachable; resolved skill bodies arrive via the same channel P3 used (the orchestrator/adapter already has the role; the resolved-body map from P3's loader is passed alongside, or skills are pre-resolved onto the task by the orchestrator). `composePreamble` is called once.

- **Copilot** (`args.ts`, `buildArgs`): replace the bare `task.description` in `-p` with `composePreamble({ soul, instructions: role.instructions, tools: renderToolsForPreamble(role.tools), skills: resolvedSkillBodies, task: task.description })`. The argv becomes `["-C", workspace.path, "-p", <preamble>, "-s", "--no-ask-user", "--allow-all"]` (everything else byte-identical so the worktree isolation and json-mode flag are untouched).
- **ACP** (`adapter.ts` + `session.ts`): the value passed as `AcpSessionOptions.instructions` becomes `composePreamble({ ..., task: "" })` **minus** the Task block (the Task is still delivered as the first `user_turn` via `buildUserTurn(task.description)` in `start()`), OR the full preamble as `systemPrompt` with the task echoed in the user turn. The chosen convention (preamble-as-systemPrompt, task-as-first-user-turn) is asserted in the test. Soul red lines therefore land in `params.systemPrompt` ahead of any turn.
- **Remove** P3's standalone minimal skills append wherever it lived (the loader-side or adapter-side inline), so `composePreamble` is the sole assembler (R3). Grep for the P3 append and delete it; its skills test is re-pointed at the composed output.

- [ ] Red: `args.test.ts` (Copilot) asserts the `-p` value contains the soul red line BEFORE the instructions BEFORE the task, and that a role with a tools grant has the tool lines present; a bare role still produces a `-p` whose payload equals (instructions + task) with no empty Soul/Tools/Skills headers. `session.test.ts` (ACP) asserts the `initialize` `systemPrompt` carries the composed preamble (soul first), and the first `user_turn` carries the task. Add a `conformance` assertion that both adapters place soul red lines ahead of the task. Run the affected suites -> red.
- [ ] Green: implement both wirings; delete the P3 append; re-point the P3 skills test. Run `pnpm --filter @maestro/adapter-copilot test`, `pnpm --filter @maestro/adapter-acp test`, `pnpm --filter @maestro/conformance test` -> green.
- [ ] Commit: `feat(adapters): composePreamble in Copilot buildArgs and ACP systemPrompt; drop P3 append (P4, R3)`

**Optional stretch (cheap-only):** team-charter red-lines union. `composePreamble` already accepts `redLineOverlay`; the only added work is the caller resolving `.conductor/teams/<team>/charter.md` red lines and passing them in at `launchTeam`-time, tighten-only. If a charter loader is not already present from team work, **defer to P5** rather than grow P4.

---

### Task 12: full gate + Self-Review

- [ ] Run the repo-root gate: `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`. All green; both extension bundles emit.
- [ ] Walk the Self-Review checklist below; map each design-doc requirement to its task; list deferrals.
- [ ] Commit: `chore(p4): full gate green, self-review complete (P4)`

---

## Self-Review

Design-doc requirement to task mapping (design 03 + 04, plus seams R2/R3/R5/R6):

- [ ] **Soul as a `.conductor/souls/<name>.md` reference** (03 "Anatomy Section: Soul", "Shared souls"): Tasks 1 (type), 4 (parser/serializer/loader), 5 (role `soul:` reference + by-name warning, R6).
- [ ] **Tools grant, read/write split, write off by default** (03 "Anatomy Section: Tools", 07 section 6a): Tasks 1 (`ToolGrant`), 3 (`countGrants` proves write-off), 5 (validate read-only when no write block), 9 (grid with amber can-write + summary).
- [ ] **`"N granted · M can write"` summary** (03 Tools "Live summary"): Task 3 selector, Task 9 render (amber when M > 0).
- [ ] **Composition-at-spawn, fixed order Soul -> Instructions -> Tools -> Skills -> Task** (03 "Composition order", 07 section 5, seam R3): Task 2 (the assembler), Task 11 (both adapters + P3 append removed). P4 is the single owner.
- [ ] **Red-lines precedence framed in the preamble** (03 "Two tiers", 07 section 5): Task 2 (red lines first, "override the task" phrase). Documented contract: Tier 1 red lines outrank task instructions; Tier 2 principles/priorities are overridable defaults.
- [ ] **Precise adapter assembly points** (07 section 5): Copilot `args.ts buildArgs` `-p` payload (was `task.description` only, no `role.instructions`); ACP `adapter.ts` -> `session.ts start()` -> `messages.ts buildInitialize` `params.systemPrompt`, task as first `user_turn`. Cited in Architecture and Task 11.
- [ ] **The full anatomy editor** (03 "Agent Anatomy Editor", sub-rail + canvas): Task 9 (sub-rail status dots, twin editors, tools grid, engine pills, autonomy segmented control), opened from Library Agents tab (R4) and board card drawer.
- [ ] **Add-skill grant-gate, Grant / Attach-without-granting / Cancel** (04 "Signature interaction", seam R5): Task 6 (pure predicate), Task 10 (inline amber expansion + the three actions). Write is never silently granted.
- [ ] **CardVM anatomy row populated** (03 "Compact Anatomy Row"): Task 7 (`soul`, `toolsCount`, `toolsCanWrite`, `skills` from the resolved Role; amber 🔧 when can-write > 0).
- [ ] **Role-edit protocol + persistence via the config serializer** (seam R6): Task 8 (messages + `isWebviewMessage` + exhaustive switch), Task 9 (writes through `@maestro/config`, `.conductor` containment + `KNOWN_ENGINE_IDS`).

Invariants held:
- [ ] `isWebviewMessage` updated for every new variant; the `default` branch keeps the exhaustive-switch compile guard (cockpit + extension controller).
- [ ] Write off by default: a `ToolGrant` with no `write` block is read-only at every layer (type, validator, `countGrants`, grid render, grant-gate).
- [ ] `.conductor` symlink containment preserved; engine ids stay hard-allowlisted via `KNOWN_ENGINE_IDS` (R6); all role/soul/tools writes go through `@maestro/config` (R6).
- [ ] Graphite palette (R2) on the anatomy editor webview, not `var(--vscode-*)`.
- [ ] No em dashes anywhere in prose, code, comments, or commit messages; commit messages carry the `Co-Authored-By` trailer.
- [ ] Bare roles (no soul, no tools, no skills) serialize byte-identically to M8 and produce a preamble equal to instructions + task, so P4 is fully back-compatible.

Deferred, with owning phase:
- [ ] Discover / adopt of foreign souls/roles/skills + the adopt autonomy clamp (07 section 6c): **P5**.
- [ ] MCP server enumeration at editor-open (03 open question 5): grants are modeled and rendered here; sourcing the live server list is **P5**.
- [ ] Full-width diff / merge review screen (06): **P6**.
- [ ] Team-charter red-lines union beyond the `redLineOverlay` hook: **P5 / team work** (P4 leaves the parameter ready; see Task 11 stretch).
- [ ] Marketplace / community publishing: out of all current phases.
