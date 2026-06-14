# M8: Roles/Teams as `.conductor/` YAML

**Date:** 2026-06-14
**Branch:** `m8-yaml-config`
**Slug:** `m8-yaml-config`
**Status:** Plan (not yet implemented)

---

## Upstream assumptions / contract

M8 is independent of M5/M6/M7/M9. It shares three files with other milestones. This section states the ADDITIVE deltas M8 contributes and the assumptions it makes about current `main`:

**Assumptions about `main`:**
- `packages/core/src/types.ts` exports `Role`, `OrchestratorConfig`, `Agent`, `AgentState`, and all types described in the roadmap. No `Team` type exists yet.
- `packages/core/src/index.ts` re-exports everything from `types.ts` via `export * from "./types.js"`.
- `packages/extension/src/extension.ts` has a hardcoded `DEFAULT_ROLE` constant and a `maestro.spawnAgent` command that calls `cockpit.handle({ type: "spawn", roleName: DEFAULT_ROLE.name, description })`.
- No `.conductor/` directory exists in the extension's host workspace by default.
- pnpm workspace root is at `/packages` with a shared `pnpm-workspace.yaml`.

**Additive deltas M8 contributes to shared files:**

1. `packages/core/src/types.ts`: add `Team` interface (two new lines). No other type changes.
2. `packages/core/src/index.ts`: no change needed; `Team` is exported automatically via `export * from "./types.js"`.
3. `packages/extension/src/extension.ts` (`activate()`): load roles from `.conductor/` via `@maestro/config`, register loaded roles, add role QuickPick before the description prompt in `maestro.spawnAgent`. `DEFAULT_ROLE` stays as the fallback when `.conductor/` does not exist. No removal of existing logic, only additions.

**Contract to M9:** M8 does not touch workspace or merge logic. M9 may add `resolveMerge` etc. to `@maestro/workspace`; no collision.

**Contract to M5:** M8 does not register the ACP adapter. `Role.engine.id` validation warns on unknown engine ids (including future `acp`) but does not hard-fail. When M5 adds the ACP adapter the existing YAML configs that reference `engine: { id: acp }` will silently start working.

---

## Goal

Deliver versioned, shareable agent setup via YAML files committed inside the user's repo. A new `@maestro/config` package reads and writes `.conductor/teams/*.yaml`, `.conductor/roles/*.yaml`, `.conductor/config.yaml`, validates the parsed data with a small hand-rolled validator (no heavy schema dep), and exports typed `Role[]`, `Team[]`, and `OrchestratorConfig`. The extension loads roles on `activate()`, shows a role QuickPick in the spawn command, and runs a first-run scaffolder to write starter YAML when no `.conductor/` directory is present.

---

## Architecture

```
packages/config/
  src/
    types.ts          pure parsed types + validation result types
    parser.ts         YAML text -> validated Role | Team | OrchestratorConfig
    serializer.ts     Role | Team -> YAML text
    validator.ts      hand-rolled shape checker, clear error messages
    loader.ts         fs loader (injectable FsReader), aggregates .conductor/ tree
    scaffolder.ts     writes starter .conductor/ when none exists
    index.ts          public re-exports

  test/
    parser.test.ts
    serializer.test.ts
    validator.test.ts
    loader.test.ts
    scaffolder.test.ts

  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts

packages/core/src/types.ts   (additive delta: +Team interface)

packages/extension/src/extension.ts   (additive delta: load roles + QuickPick)
```

### Team type location decision

`Team` belongs in `@maestro/core/src/types.ts`, not in `@maestro/config`.

Justification: `Role` already lives in core because the Orchestrator uses it at runtime (`registerRole(role: Role)`). `Team` is an equally fundamental domain concept: it is a named grouping of roles that the Orchestrator will eventually use to spawn coordinated sets of agents (or that the UI uses to group cards). Keeping domain types co-located prevents a dependency inversion where `@maestro/core` would need to import from `@maestro/config` to understand a Team. `@maestro/config` is the I/O layer (YAML in, typed objects out); it depends on core, not the other way around. Adding `Team` to core is a two-line additive change with no breaking surface.

### `yaml` dependency

`yaml` (the `npm` package `yaml`, currently v2.x) is the one external runtime dep added to `@maestro/config`. Justification: hand-rolling a YAML parser is out of scope and fragile. `yaml` is a mature, zero-dependency, ESM-compatible library that handles multi-document files, comments, and the full YAML 1.2 spec. It is already a transitive dep in many Node.js ecosystems. Alternative (`js-yaml`) is CommonJS-first and more awkward under NodeNext moduleResolution. `yaml` v2 ships with proper TypeScript types.

### Injectable fs pattern

`loader.ts` and `scaffolder.ts` accept a `FsReader` / `FsWriter` interface so every unit test runs fully offline (no real disk I/O). Real fs calls are isolated to a thin `nodeFsReader` / `nodeFsWriter` that wraps `node:fs/promises`. This mirrors the `GitRunner` pattern used in `@maestro/workspace`.

### Engine id validation strategy

The validator warns (returns a `ValidationWarning`) when `role.engine.id` is not in a known set (`copilot` is the only known id on `main`; M5 will add `acp`). It does NOT hard-fail. The config package exports a `KNOWN_ENGINE_IDS` constant that extension code can update without touching the validator logic. This keeps YAML configs forward-compatible with engines added in later milestones.

---

## Tech Stack

- TypeScript, ESM, NodeNext moduleResolution (same as all other packages)
- `"strict": true`, `"noUncheckedIndexedAccess": true`
- `yaml` v2 (runtime dep)
- `@maestro/core: workspace:*` (for `Role`, `Team`, `OrchestratorConfig` types)
- Vitest for tests
- No VS Code imports (pure Node.js package)

---

## File Structure

### New package: `packages/config/`

```
packages/config/
  src/
    types.ts
    validator.ts
    parser.ts
    serializer.ts
    loader.ts
    scaffolder.ts
    index.ts
  test/
    fixtures/
      valid-role.yaml
      valid-team.yaml
      valid-config.yaml
      missing-fields-role.yaml
      unknown-engine-role.yaml
    validator.test.ts
    parser.test.ts
    serializer.test.ts
    loader.test.ts
    scaffolder.test.ts
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
```

### Shared file deltas

- `packages/core/src/types.ts`: +`Team` interface (additive, no changes to existing types)
- `packages/extension/src/extension.ts`: `activate()` delta — load config, register roles, role QuickPick (additive, `DEFAULT_ROLE` kept as fallback)

---

## Tasks

### Task 1: Add `Team` to `@maestro/core` types (additive)

**Why first:** `@maestro/config` imports `Team` from core. Core must have it before config compiles.

- [ ] Write a failing test in `packages/core/test/types.test.ts` that imports `Team` from `@maestro/core` and asserts its shape:

```typescript
// packages/core/test/types.test.ts  (append to existing file or new file)
import { describe, it, expectTypeOf } from "vitest";
import type { Team, Role } from "@maestro/core";

describe("Team type", () => {
  it("has name and roles fields", () => {
    expectTypeOf<Team>().toMatchTypeOf<{ name: string; roles: Role[] }>();
  });
});
```

Run: `pnpm --filter @maestro/core test` -> red (Team not exported).

- [ ] Add `Team` to `packages/core/src/types.ts` (additive delta, insert after the `Role` interface):

```typescript
/** A named group of roles that can be dispatched together. */
export interface Team {
  name: string;
  roles: Role[];
}
```

`Team` is exported automatically via the existing `export * from "./types.js"` in `index.ts`. No change to `index.ts` needed.

Run: `pnpm --filter @maestro/core test` -> all green (core 47 -> 48+ tests).

- [ ] Commit: `feat(core): add Team interface to types (additive, M8)`

---

### Task 2: Scaffold `packages/config/` package

- [ ] Create the directory structure and config files, mirroring `packages/workspace` exactly:

`packages/config/package.json`:
```json
{
  "name": "@maestro/config",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": {
    "@maestro/core": "workspace:*",
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/config/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

`packages/config/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/config/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] Create a minimal `packages/config/src/index.ts` that exports nothing yet (stub so typecheck passes):

```typescript
export const MAESTRO_CONFIG_VERSION = "0.0.0";
```

- [ ] Run `pnpm install` from the repo root to link the new package in the workspace (pnpm 10 requires an explicit install step after adding a new `package.json`).

- [ ] Verify: `pnpm --filter @maestro/config typecheck` passes and `pnpm --filter @maestro/config test` runs (0 tests, no failure).

- [ ] Commit: `feat(config): scaffold @maestro/config package`

---

### Task 3: Hand-rolled validator

The validator is the foundation. It runs on already-parsed JavaScript objects (not raw YAML strings) and returns structured results so the parser can surface clear error messages.

**Types (`packages/config/src/types.ts`):**

```typescript
export interface ValidationOk<T> {
  ok: true;
  value: T;
  warnings: ValidationWarning[];
}

export interface ValidationError {
  ok: false;
  errors: string[];
  warnings: ValidationWarning[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationError;

export interface ValidationWarning {
  field: string;
  message: string;
}

/** Engine ids known at build time. Forward-compat: unknown ids produce warnings, not errors. */
export const KNOWN_ENGINE_IDS = new Set<string>(["copilot"]);
```

**Validator (`packages/config/src/validator.ts`):**

```typescript
import type { Role, Team, OrchestratorConfig } from "@maestro/core";
import type { ValidationResult, ValidationWarning } from "./types.js";
import { KNOWN_ENGINE_IDS } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

export function validateRole(raw: unknown): ValidationResult<Role> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["role must be an object"], warnings };
  }

  if (!isString(raw["name"]) || raw["name"].trim() === "") {
    errors.push("role.name must be a non-empty string");
  }
  if (!isString(raw["instructions"]) || raw["instructions"].trim() === "") {
    errors.push("role.instructions must be a non-empty string");
  }

  const engine = raw["engine"];
  if (!isRecord(engine)) {
    errors.push("role.engine must be an object with an id field");
  } else {
    if (!isString(engine["id"]) || engine["id"].trim() === "") {
      errors.push("role.engine.id must be a non-empty string");
    } else if (!KNOWN_ENGINE_IDS.has(engine["id"])) {
      warnings.push({
        field: "engine.id",
        message: `unknown engine id "${engine["id"]}"; known ids: ${[...KNOWN_ENGINE_IDS].join(", ")}. This may work once the engine adapter is registered.`,
      });
    }
    if (engine["model"] !== undefined && !isString(engine["model"])) {
      errors.push("role.engine.model must be a string if provided");
    }
  }

  const autonomy = raw["autonomy"];
  const validAutonomy = ["manual", "auto-approve-safe", "yolo"];
  if (!isString(autonomy) || !validAutonomy.includes(autonomy)) {
    errors.push(`role.autonomy must be one of: ${validAutonomy.join(", ")}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const engineRecord = raw["engine"] as Record<string, unknown>;
  const role: Role = {
    name: (raw["name"] as string).trim(),
    instructions: raw["instructions"] as string,
    engine: {
      id: (engineRecord["id"] as string).trim(),
      ...(engineRecord["model"] !== undefined
        ? { model: engineRecord["model"] as string }
        : {}),
    },
    autonomy: raw["autonomy"] as Role["autonomy"],
  };

  return { ok: true, value: role, warnings };
}

export function validateTeam(
  raw: unknown,
  knownRoles: Map<string, Role>,
): ValidationResult<Team> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["team must be an object"], warnings };
  }

  if (!isString(raw["name"]) || raw["name"].trim() === "") {
    errors.push("team.name must be a non-empty string");
  }

  if (!Array.isArray(raw["roles"])) {
    errors.push("team.roles must be an array of role name strings");
  } else {
    for (const item of raw["roles"]) {
      if (!isString(item)) {
        errors.push(`team.roles entries must be strings; got ${JSON.stringify(item)}`);
      } else if (!knownRoles.has(item)) {
        warnings.push({
          field: "roles",
          message: `role "${item}" is referenced in team but not found in loaded roles; the role file may not exist yet`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const roleNames = (raw["roles"] as unknown[]).filter(isString);
  const roles: Role[] = roleNames.map((n) => knownRoles.get(n)).filter((r): r is Role => r !== undefined);

  return {
    ok: true,
    value: { name: (raw["name"] as string).trim(), roles },
    warnings,
  };
}

export function validateOrchestratorConfig(raw: unknown): ValidationResult<OrchestratorConfig> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["config must be an object"], warnings };
  }

  const max = raw["maxParallelAgents"];
  if (max !== undefined) {
    if (!isNumber(max) || !Number.isInteger(max) || max < 1) {
      errors.push("config.maxParallelAgents must be a positive integer if provided");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    value: {
      maxParallelAgents: isNumber(max) ? max : 3,
    },
    warnings,
  };
}
```

**Tests (`packages/config/test/validator.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { validateRole, validateTeam, validateOrchestratorConfig } from "../src/validator.js";
import type { Role } from "@maestro/core";

const validRoleRaw = {
  name: "Implementer",
  instructions: "Make the change.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

describe("validateRole", () => {
  it("accepts a valid role", () => {
    const result = validateRole(validRoleRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Implementer");
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("accepts a role with an optional model field", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "copilot", model: "gpt-4o" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.engine.model).toBe("gpt-4o");
    }
  });

  it("warns on an unknown engine id (does not hard-fail)", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "acp" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]?.message).toContain("acp");
    }
  });

  it("errors on missing name", () => {
    const result = validateRole({ ...validRoleRaw, name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("errors on missing instructions", () => {
    const result = validateRole({ ...validRoleRaw, instructions: "" });
    expect(result.ok).toBe(false);
  });

  it("errors on invalid autonomy", () => {
    const result = validateRole({ ...validRoleRaw, autonomy: "full-auto" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("autonomy"))).toBe(true);
    }
  });

  it("errors when engine is missing", () => {
    const { engine: _e, ...rest } = validRoleRaw;
    const result = validateRole(rest);
    expect(result.ok).toBe(false);
  });

  it("errors on non-object input", () => {
    const result = validateRole("not an object");
    expect(result.ok).toBe(false);
  });
});

describe("validateTeam", () => {
  const implementerRole: Role = {
    name: "Implementer",
    instructions: "Make the change.",
    engine: { id: "copilot" },
    autonomy: "auto-approve-safe",
  };
  const knownRoles = new Map<string, Role>([["Implementer", implementerRole]]);

  it("accepts a valid team", () => {
    const result = validateTeam({ name: "Feature Team", roles: ["Implementer"] }, knownRoles);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.roles).toHaveLength(1);
    }
  });

  it("warns when a referenced role is not yet loaded", () => {
    const result = validateTeam({ name: "Team", roles: ["Reviewer"] }, knownRoles);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("errors when roles is not an array", () => {
    const result = validateTeam({ name: "Team", roles: "Implementer" }, knownRoles);
    expect(result.ok).toBe(false);
  });
});

describe("validateOrchestratorConfig", () => {
  it("accepts an empty object and defaults maxParallelAgents to 3", () => {
    const result = validateOrchestratorConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maxParallelAgents).toBe(3);
    }
  });

  it("accepts a valid config", () => {
    const result = validateOrchestratorConfig({ maxParallelAgents: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maxParallelAgents).toBe(5);
    }
  });

  it("errors on non-integer maxParallelAgents", () => {
    const result = validateOrchestratorConfig({ maxParallelAgents: 0 });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] Run `pnpm --filter @maestro/config test` -> red (no src files yet).
- [ ] Create `packages/config/src/types.ts` with the types above.
- [ ] Create `packages/config/src/validator.ts` with the implementation above.
- [ ] Update `packages/config/src/index.ts` to export from both:

```typescript
export const MAESTRO_CONFIG_VERSION = "0.0.0";
export * from "./types.js";
export * from "./validator.js";
```

- [ ] Run `pnpm --filter @maestro/config test` -> all green.
- [ ] Commit: `feat(config): hand-rolled validator for Role, Team, OrchestratorConfig`

---

### Task 4: YAML parser (string -> validated objects)

The parser takes raw YAML text (already read from disk or provided in tests as a literal string) and returns typed, validated results. It depends on the `yaml` package and the validator from Task 3.

**Parser (`packages/config/src/parser.ts`):**

```typescript
import { parse as parseYaml } from "yaml";
import { validateRole, validateTeam, validateOrchestratorConfig } from "./validator.js";
import type { ValidationResult, ValidationWarning } from "./types.js";
import type { Role, Team, OrchestratorConfig } from "@maestro/core";

export interface ParseRoleResult {
  role: ValidationResult<Role>;
  source: string;
}

export interface ParseTeamResult {
  team: ValidationResult<Team>;
  source: string;
}

export interface ParseConfigResult {
  config: ValidationResult<OrchestratorConfig>;
  source: string;
}

export function parseRoleYaml(
  yamlText: string,
  source: string,
  knownRoles?: Map<string, Role>,
): ParseRoleResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      source,
      role: {
        ok: false,
        errors: [`YAML parse error in ${source}: ${String(err)}`],
        warnings: [],
      },
    };
  }
  return { source, role: validateRole(raw) };
}

export function parseTeamYaml(
  yamlText: string,
  source: string,
  knownRoles: Map<string, Role>,
): ParseTeamResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      source,
      team: {
        ok: false,
        errors: [`YAML parse error in ${source}: ${String(err)}`],
        warnings: [],
      },
    };
  }
  return { source, team: validateTeam(raw, knownRoles) };
}

export function parseConfigYaml(yamlText: string, source: string): ParseConfigResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      source,
      config: {
        ok: false,
        errors: [`YAML parse error in ${source}: ${String(err)}`],
        warnings: [],
      },
    };
  }
  return { source, config: validateOrchestratorConfig(raw) };
}
```

**Tests (`packages/config/test/parser.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { parseRoleYaml, parseTeamYaml, parseConfigYaml } from "../src/parser.js";
import type { Role } from "@maestro/core";

const VALID_ROLE_YAML = `
name: Implementer
instructions: Make the requested change in this worktree.
engine:
  id: copilot
autonomy: auto-approve-safe
`;

const VALID_TEAM_YAML = `
name: Feature Team
roles:
  - Implementer
`;

const VALID_CONFIG_YAML = `
maxParallelAgents: 4
`;

const MISSING_FIELD_YAML = `
instructions: Something
engine:
  id: copilot
autonomy: manual
`;

const UNKNOWN_ENGINE_YAML = `
name: ACP Reviewer
instructions: Review via ACP.
engine:
  id: acp
autonomy: manual
`;

const BAD_YAML = `
name: [unclosed bracket
`;

describe("parseRoleYaml", () => {
  it("parses a valid role YAML string", () => {
    const result = parseRoleYaml(VALID_ROLE_YAML, "roles/implementer.yaml");
    expect(result.role.ok).toBe(true);
    if (result.role.ok) {
      expect(result.role.value.name).toBe("Implementer");
      expect(result.role.value.autonomy).toBe("auto-approve-safe");
    }
  });

  it("returns errors for missing name field", () => {
    const result = parseRoleYaml(MISSING_FIELD_YAML, "roles/bad.yaml");
    expect(result.role.ok).toBe(false);
    if (!result.role.ok) {
      expect(result.role.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("returns warnings (not errors) for unknown engine id", () => {
    const result = parseRoleYaml(UNKNOWN_ENGINE_YAML, "roles/acp-reviewer.yaml");
    expect(result.role.ok).toBe(true);
    if (result.role.ok) {
      expect(result.role.warnings.length).toBeGreaterThan(0);
      expect(result.role.value.engine.id).toBe("acp");
    }
  });

  it("returns a parse error for malformed YAML", () => {
    const result = parseRoleYaml(BAD_YAML, "roles/broken.yaml");
    expect(result.role.ok).toBe(false);
    if (!result.role.ok) {
      expect(result.role.errors[0]).toContain("YAML parse error");
    }
  });
});

describe("parseTeamYaml", () => {
  const knownRoles = new Map<string, Role>([
    [
      "Implementer",
      {
        name: "Implementer",
        instructions: "Make the change.",
        engine: { id: "copilot" },
        autonomy: "auto-approve-safe",
      },
    ],
  ]);

  it("parses a valid team YAML string", () => {
    const result = parseTeamYaml(VALID_TEAM_YAML, "teams/feature.yaml", knownRoles);
    expect(result.team.ok).toBe(true);
    if (result.team.ok) {
      expect(result.team.value.name).toBe("Feature Team");
      expect(result.team.value.roles).toHaveLength(1);
    }
  });

  it("warns on an unknown role reference", () => {
    const yaml = `name: Team\nroles:\n  - Reviewer\n`;
    const result = parseTeamYaml(yaml, "teams/team.yaml", knownRoles);
    expect(result.team.ok).toBe(true);
    if (result.team.ok) {
      expect(result.team.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("parseConfigYaml", () => {
  it("parses a valid config YAML", () => {
    const result = parseConfigYaml(VALID_CONFIG_YAML, "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.maxParallelAgents).toBe(4);
    }
  });

  it("defaults maxParallelAgents to 3 when not specified", () => {
    const result = parseConfigYaml("{}", "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.maxParallelAgents).toBe(3);
    }
  });
});
```

- [ ] Run `pnpm --filter @maestro/config test` -> red (parser.ts missing).
- [ ] Create `packages/config/src/parser.ts`.
- [ ] Add to `packages/config/src/index.ts`:

```typescript
export * from "./parser.js";
```

- [ ] Run `pnpm --filter @maestro/config test` -> all green.
- [ ] Commit: `feat(config): YAML parser for roles, teams, and orchestrator config`

---

### Task 5: YAML serializer (Role/Team -> string)

The serializer is the write-back path: it converts in-memory `Role` and `Team` objects back to YAML text. It is used by the scaffolder and potentially by future UI-driven config editing.

**Serializer (`packages/config/src/serializer.ts`):**

```typescript
import { stringify as stringifyYaml } from "yaml";
import type { Role, Team } from "@maestro/core";

/**
 * Serialize a Role to a YAML string suitable for writing to .conductor/roles/<name>.yaml.
 * Produces clean, human-readable output with no extra blank lines.
 */
export function serializeRole(role: Role): string {
  const doc: Record<string, unknown> = {
    name: role.name,
    instructions: role.instructions,
    engine: role.engine.model
      ? { id: role.engine.id, model: role.engine.model }
      : { id: role.engine.id },
    autonomy: role.autonomy,
  };
  return stringifyYaml(doc, { lineWidth: 120 });
}

/**
 * Serialize a Team to a YAML string suitable for writing to .conductor/teams/<name>.yaml.
 * Role references are stored as name strings (resolved at load time).
 */
export function serializeTeam(team: Team): string {
  const doc: Record<string, unknown> = {
    name: team.name,
    roles: team.roles.map((r) => r.name),
  };
  return stringifyYaml(doc, { lineWidth: 120 });
}
```

**Tests (`packages/config/test/serializer.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { serializeRole, serializeTeam } from "../src/serializer.js";
import { parseRoleYaml, parseTeamYaml } from "../src/parser.js";
import type { Role, Team } from "@maestro/core";

const implementer: Role = {
  name: "Implementer",
  instructions: "Make the requested change in this worktree.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

const reviewer: Role = {
  name: "Reviewer",
  instructions: "Review the diff and leave comments.",
  engine: { id: "copilot", model: "gpt-4o" },
  autonomy: "manual",
};

const team: Team = {
  name: "Feature Team",
  roles: [implementer, reviewer],
};

describe("serializeRole", () => {
  it("produces YAML that round-trips back to an equivalent Role", () => {
    const yaml = serializeRole(implementer);
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.name).toBe(implementer.name);
      expect(parsed.role.value.autonomy).toBe(implementer.autonomy);
      expect(parsed.role.value.engine.id).toBe(implementer.engine.id);
    }
  });

  it("includes the model field when present", () => {
    const yaml = serializeRole(reviewer);
    expect(yaml).toContain("model: gpt-4o");
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.engine.model).toBe("gpt-4o");
    }
  });

  it("omits the model field when absent", () => {
    const yaml = serializeRole(implementer);
    expect(yaml).not.toContain("model:");
  });
});

describe("serializeTeam", () => {
  it("produces YAML that round-trips back to an equivalent Team", () => {
    const yaml = serializeTeam(team);
    const knownRoles = new Map<string, Role>([
      [implementer.name, implementer],
      [reviewer.name, reviewer],
    ]);
    const parsed = parseTeamYaml(yaml, "test", knownRoles);
    expect(parsed.team.ok).toBe(true);
    if (parsed.team.ok) {
      expect(parsed.team.value.name).toBe(team.name);
      expect(parsed.team.value.roles.map((r) => r.name)).toEqual([
        implementer.name,
        reviewer.name,
      ]);
    }
  });
});
```

- [ ] Run `pnpm --filter @maestro/config test` -> red (serializer.ts missing).
- [ ] Create `packages/config/src/serializer.ts`.
- [ ] Add to `packages/config/src/index.ts`:

```typescript
export * from "./serializer.js";
```

- [ ] Run `pnpm --filter @maestro/config test` -> all green.
- [ ] Commit: `feat(config): YAML serializer for Role and Team`

---

### Task 6: Thin fs loader (injectable FsReader)

The loader discovers `.conductor/roles/*.yaml`, `.conductor/teams/*.yaml`, and `.conductor/config.yaml` in a given workspace root, reads each file, and aggregates the parsed results. All file I/O is behind a `FsReader` interface so unit tests run with an in-memory fake.

**Loader (`packages/config/src/loader.ts`):**

```typescript
import * as nodePath from "node:path";
import { parseRoleYaml, parseTeamYaml, parseConfigYaml } from "./parser.js";
import type { Role, Team, OrchestratorConfig } from "@maestro/core";
import type { ValidationWarning } from "./types.js";

/** Minimal async fs interface; injectable for offline testing. */
export interface FsReader {
  /** Returns file contents as a UTF-8 string. Throws if the file does not exist. */
  readFile(path: string): Promise<string>;
  /** Returns base names of files with the given extension inside a directory, or [] if the dir does not exist. */
  listFiles(dir: string, ext: string): Promise<string[]>;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
}

export interface LoadResult {
  roles: Role[];
  teams: Team[];
  config: OrchestratorConfig;
  warnings: Array<{ source: string; warnings: ValidationWarning[] }>;
  errors: Array<{ source: string; errors: string[] }>;
}

export const DEFAULT_CONFIG: OrchestratorConfig = { maxParallelAgents: 3 };

export async function loadConductorDir(
  workspaceRoot: string,
  fs: FsReader,
): Promise<LoadResult> {
  const conductorDir = nodePath.join(workspaceRoot, ".conductor");
  const rolesDir = nodePath.join(conductorDir, "roles");
  const teamsDir = nodePath.join(conductorDir, "teams");
  const configPath = nodePath.join(conductorDir, "config.yaml");

  const result: LoadResult = {
    roles: [],
    teams: [],
    config: { ...DEFAULT_CONFIG },
    warnings: [],
    errors: [],
  };

  if (!(await fs.exists(conductorDir))) {
    return result;
  }

  // Load roles first (teams reference roles by name).
  const roleFiles = await fs.listFiles(rolesDir, ".yaml");
  for (const file of roleFiles) {
    const filePath = nodePath.join(rolesDir, file);
    const source = nodePath.relative(workspaceRoot, filePath);
    try {
      const text = await fs.readFile(filePath);
      const parsed = parseRoleYaml(text, source);
      if (parsed.role.ok) {
        result.roles.push(parsed.role.value);
        if (parsed.role.warnings.length > 0) {
          result.warnings.push({ source, warnings: parsed.role.warnings });
        }
      } else {
        result.errors.push({ source, errors: parsed.role.errors });
      }
    } catch (err) {
      result.errors.push({ source, errors: [`Failed to read file: ${String(err)}`] });
    }
  }

  // Build role map for team resolution.
  const knownRoles = new Map<string, Role>(result.roles.map((r) => [r.name, r]));

  // Load teams.
  const teamFiles = await fs.listFiles(teamsDir, ".yaml");
  for (const file of teamFiles) {
    const filePath = nodePath.join(teamsDir, file);
    const source = nodePath.relative(workspaceRoot, filePath);
    try {
      const text = await fs.readFile(filePath);
      const parsed = parseTeamYaml(text, source, knownRoles);
      if (parsed.team.ok) {
        result.teams.push(parsed.team.value);
        if (parsed.team.warnings.length > 0) {
          result.warnings.push({ source, warnings: parsed.team.warnings });
        }
      } else {
        result.errors.push({ source, errors: parsed.team.errors });
      }
    } catch (err) {
      result.errors.push({ source, errors: [`Failed to read file: ${String(err)}`] });
    }
  }

  // Load orchestrator config.
  if (await fs.exists(configPath)) {
    try {
      const text = await fs.readFile(configPath);
      const parsed = parseConfigYaml(text, ".conductor/config.yaml");
      if (parsed.config.ok) {
        result.config = parsed.config.value;
        if (parsed.config.warnings.length > 0) {
          result.warnings.push({
            source: ".conductor/config.yaml",
            warnings: parsed.config.warnings,
          });
        }
      } else {
        result.errors.push({
          source: ".conductor/config.yaml",
          errors: parsed.config.errors,
        });
      }
    } catch (err) {
      result.errors.push({
        source: ".conductor/config.yaml",
        errors: [`Failed to read config: ${String(err)}`],
      });
    }
  }

  return result;
}

/**
 * A real FsReader backed by node:fs/promises.
 * Import lazily in extension code so the module remains testable.
 */
export async function makeNodeFsReader(): Promise<FsReader> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  return {
    async readFile(p: string): Promise<string> {
      return fs.readFile(p, "utf-8");
    },
    async listFiles(dir: string, ext: string): Promise<string[]> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries
          .filter((e) => e.isFile() && e.name.endsWith(ext))
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    },
    async exists(p: string): Promise<boolean> {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

**Tests (`packages/config/test/loader.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { loadConductorDir, DEFAULT_CONFIG, type FsReader } from "../src/loader.js";

function makeFakeFs(files: Record<string, string>): FsReader {
  return {
    async readFile(p: string): Promise<string> {
      const content = files[p];
      if (content === undefined) throw new Error(`File not found: ${p}`);
      return content;
    },
    async listFiles(dir: string, ext: string): Promise<string[]> {
      return Object.keys(files)
        .filter((p) => p.startsWith(dir + "/") && p.endsWith(ext))
        .map((p) => p.slice(dir.length + 1))
        .sort();
    },
    async exists(p: string): Promise<boolean> {
      if (Object.keys(files).some((f) => f === p || f.startsWith(p + "/"))) {
        return true;
      }
      return false;
    },
  };
}

const ROOT = "/repo";
const ROLES_DIR = `${ROOT}/.conductor/roles`;
const TEAMS_DIR = `${ROOT}/.conductor/teams`;
const CONFIG_PATH = `${ROOT}/.conductor/config.yaml`;

const IMPLEMENTER_YAML = `
name: Implementer
instructions: Make the requested change.
engine:
  id: copilot
autonomy: auto-approve-safe
`.trim();

const TEAM_YAML = `
name: Feature Team
roles:
  - Implementer
`.trim();

const CONFIG_YAML = `
maxParallelAgents: 5
`.trim();

describe("loadConductorDir", () => {
  it("returns defaults when .conductor/ does not exist", async () => {
    const fs = makeFakeFs({});
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(0);
    expect(result.teams).toHaveLength(0);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.errors).toHaveLength(0);
  });

  it("loads a valid role file", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0]?.name).toBe("Implementer");
    expect(result.errors).toHaveLength(0);
  });

  it("loads a valid team file after roles", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${TEAMS_DIR}/feature.yaml`]: TEAM_YAML,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]?.name).toBe("Feature Team");
    expect(result.teams[0]?.roles).toHaveLength(1);
  });

  it("loads orchestrator config", async () => {
    const fs = makeFakeFs({
      [`${CONFIG_PATH}`]: CONFIG_YAML,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.config.maxParallelAgents).toBe(5);
  });

  it("collects errors on invalid YAML without throwing", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/broken.yaml`]: "name: [unclosed",
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toContain("broken.yaml");
    expect(result.roles).toHaveLength(0);
  });

  it("collects errors on structurally invalid role without throwing", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/bad-role.yaml`]: "instructions: no name\nengine:\n  id: copilot\nautonomomy: manual",
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.roles).toHaveLength(0);
  });

  it("collects multiple role files in alphabetical order", async () => {
    const reviewerYaml = `
name: Reviewer
instructions: Review the diff.
engine:
  id: copilot
autonomy: manual
`.trim();

    const fs = makeFakeFs({
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${ROLES_DIR}/reviewer.yaml`]: reviewerYaml,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(2);
    expect(result.roles.map((r) => r.name)).toContain("Implementer");
    expect(result.roles.map((r) => r.name)).toContain("Reviewer");
  });
});
```

- [ ] Run `pnpm --filter @maestro/config test` -> red (loader.ts missing).
- [ ] Create `packages/config/src/loader.ts`.
- [ ] Add to `packages/config/src/index.ts`:

```typescript
export * from "./loader.js";
```

- [ ] Run `pnpm --filter @maestro/config test` -> all green.
- [ ] Commit: `feat(config): fs loader with injectable FsReader`

---

### Task 7: First-run scaffolder

The scaffolder writes a starter `.conductor/` tree (a default Implementer role + config.yaml) when the directory does not already exist. It is called from `activate()` on first use. Like the loader, it uses an injectable `FsWriter` for offline testing.

**Scaffolder (`packages/config/src/scaffolder.ts`):**

```typescript
import * as nodePath from "node:path";
import { serializeRole } from "./serializer.js";
import type { Role } from "@maestro/core";

/** Minimal async fs interface for writing; injectable for offline testing. */
export interface FsWriter {
  /** Write text to a file, creating parent directories as needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Returns true if the path exists. */
  exists(path: string): Promise<boolean>;
  /** Create a directory and all parents. No-op if it already exists. */
  mkdir(path: string): Promise<void>;
}

export const STARTER_ROLE: Role = {
  name: "Implementer",
  instructions:
    "You are an implementer. Make the requested change in this worktree. " +
    "Commit your changes when done. Do not modify files outside the scope of the task.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

const STARTER_CONFIG_YAML = `# Maestro orchestrator configuration
# See .conductor/roles/ to define roles and .conductor/teams/ to group them.
maxParallelAgents: 3
`;

/**
 * Write a starter .conductor/ directory if it does not already exist.
 * Returns true if scaffolding was performed, false if .conductor/ was already present.
 */
export async function scaffoldIfMissing(
  workspaceRoot: string,
  fs: FsWriter,
): Promise<boolean> {
  const conductorDir = nodePath.join(workspaceRoot, ".conductor");

  if (await fs.exists(conductorDir)) {
    return false;
  }

  const rolesDir = nodePath.join(conductorDir, "roles");
  const teamsDir = nodePath.join(conductorDir, "teams");

  await fs.mkdir(rolesDir);
  await fs.mkdir(teamsDir);

  const implementerPath = nodePath.join(rolesDir, "implementer.yaml");
  await fs.writeFile(implementerPath, serializeRole(STARTER_ROLE));

  const configPath = nodePath.join(conductorDir, "config.yaml");
  await fs.writeFile(configPath, STARTER_CONFIG_YAML);

  return true;
}

/**
 * A real FsWriter backed by node:fs/promises.
 */
export async function makeNodeFsWriter(): Promise<FsWriter> {
  const fs = await import("node:fs/promises");

  return {
    async writeFile(p: string, content: string): Promise<void> {
      const dir = (await import("node:path")).dirname(p);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(p, content, "utf-8");
    },
    async exists(p: string): Promise<boolean> {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(p: string): Promise<void> {
      await fs.mkdir(p, { recursive: true });
    },
  };
}
```

**Tests (`packages/config/test/scaffolder.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { scaffoldIfMissing, STARTER_ROLE } from "../src/scaffolder.js";
import type { FsWriter } from "../src/scaffolder.js";
import { parseRoleYaml } from "../src/parser.js";

function makeFakeWriter(): { writer: FsWriter; written: Map<string, string>; dirs: Set<string> } {
  const written = new Map<string, string>();
  const dirs = new Set<string>();
  const existingDirs = new Set<string>();

  const writer: FsWriter = {
    async writeFile(p: string, content: string): Promise<void> {
      written.set(p, content);
    },
    async exists(p: string): Promise<boolean> {
      if (existingDirs.has(p)) return true;
      for (const k of written.keys()) {
        if (k === p || k.startsWith(p + "/")) return true;
      }
      return false;
    },
    async mkdir(p: string): Promise<void> {
      dirs.add(p);
    },
  };

  return { writer, written, dirs };
}

const ROOT = "/repo";

describe("scaffoldIfMissing", () => {
  it("writes a starter implementer role and config when .conductor/ is absent", async () => {
    const { writer, written } = makeFakeWriter();
    const scaffolded = await scaffoldIfMissing(ROOT, writer);

    expect(scaffolded).toBe(true);
    expect([...written.keys()].some((k) => k.includes("roles/implementer.yaml"))).toBe(true);
    expect([...written.keys()].some((k) => k.includes("config.yaml"))).toBe(true);
  });

  it("the written role YAML parses back to STARTER_ROLE", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const roleEntry = [...written.entries()].find(([k]) => k.includes("implementer.yaml"));
    expect(roleEntry).toBeDefined();
    const [, yaml] = roleEntry!;
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.name).toBe(STARTER_ROLE.name);
      expect(parsed.role.value.autonomy).toBe(STARTER_ROLE.autonomy);
    }
  });

  it("returns false and writes nothing when .conductor/ already exists", async () => {
    const { writer, written } = makeFakeWriter();
    // Pre-seed a file so .conductor/ appears to exist.
    written.set(`${ROOT}/.conductor/roles/existing.yaml`, "name: Existing\n");

    const scaffolded = await scaffoldIfMissing(ROOT, writer);
    expect(scaffolded).toBe(false);
    // No new files added.
    expect(written.size).toBe(1);
  });

  it("creates the roles and teams subdirectories", async () => {
    const { writer, dirs } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    expect([...dirs].some((d) => d.includes("roles"))).toBe(true);
    expect([...dirs].some((d) => d.includes("teams"))).toBe(true);
  });
});
```

- [ ] Run `pnpm --filter @maestro/config test` -> red (scaffolder.ts missing).
- [ ] Create `packages/config/src/scaffolder.ts`.
- [ ] Add to `packages/config/src/index.ts`:

```typescript
export * from "./scaffolder.js";
```

- [ ] Run `pnpm --filter @maestro/config test` -> all green.
- [ ] Commit: `feat(config): first-run scaffolder writes starter .conductor/ directory`

---

### Task 8: Finalize `packages/config/src/index.ts`

All source modules are implemented. Consolidate the public API in `index.ts` and verify the full build.

**Final `packages/config/src/index.ts`:**

```typescript
export const MAESTRO_CONFIG_VERSION = "0.0.0";

// Validation result types and constants.
export * from "./types.js";

// Core logic: validate, parse, serialize, load, scaffold.
export * from "./validator.js";
export * from "./parser.js";
export * from "./serializer.js";
export * from "./loader.js";
export * from "./scaffolder.js";
```

- [ ] Run `pnpm --filter @maestro/config typecheck` -> passes.
- [ ] Run `pnpm --filter @maestro/config build` -> emits `dist/`.
- [ ] Run `pnpm --filter @maestro/config test` -> all green (expect ~30+ tests across 5 files).
- [ ] Commit: `feat(config): finalize public API in index.ts and verify build`

---

### Task 9: Extension `activate()` delta — load roles and role QuickPick

This is the only change to a file outside `packages/config/`. It is a PURELY ADDITIVE delta to `packages/extension/src/extension.ts`. `DEFAULT_ROLE` is kept unchanged as the fallback. The extension gets `@maestro/config` added to its `esbuild` bundle (the extension's `build.mjs` handles this automatically since `@maestro/config` is a workspace package; add it to `package.json` dependencies).

**Step 1:** Add `@maestro/config` to `packages/extension/package.json` dependencies:

```json
"@maestro/config": "workspace:*"
```

**Step 2:** The additive delta to `packages/extension/src/extension.ts`. Below is the exact diff description (additive only, no existing lines removed):

Add two imports at the top (after the existing imports):

```typescript
import { loadConductorDir, makeNodeFsReader, scaffoldIfMissing, makeNodeFsWriter } from "@maestro/config";
```

Replace the `maestro.spawnAgent` command registration with an extended version that:
1. Scaffolds `.conductor/` on first run (silently, no blocking await on the critical path -- do it before the input box).
2. Loads roles from `.conductor/`.
3. If roles were loaded (length > 0), shows a QuickPick to select a role.
4. If no roles loaded (no `.conductor/` or all files had errors), falls back to `DEFAULT_ROLE`.
5. Shows the description input box.
6. Spawns with the selected role.

The revised `maestro.spawnAgent` command (replace only the `registerCommand("maestro.spawnAgent", ...)` block; everything else in `activate()` is unchanged):

```typescript
vscode.commands.registerCommand("maestro.spawnAgent", async () => {
  // First-run: scaffold .conductor/ if absent (fire and forget; errors are non-fatal).
  const fsWriter = await makeNodeFsWriter();
  const scaffolded = await scaffoldIfMissing(repoRoot, fsWriter).catch(() => false);

  // Load roles from .conductor/.
  const fsReader = await makeNodeFsReader();
  const loaded = await loadConductorDir(repoRoot, fsReader).catch(() => null);

  let selectedRole = DEFAULT_ROLE;

  if (loaded && loaded.roles.length > 0) {
    // Surface any load errors as a warning (non-blocking).
    if (loaded.errors.length > 0) {
      const msgs = loaded.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
      void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
    }

    if (loaded.roles.length === 1) {
      // Only one role -- no need to ask.
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
      if (!picked) return; // User cancelled.
      selectedRole = picked.role;
    }
  }

  const description = await vscode.window.showInputBox({
    prompt: `Task for ${selectedRole.name}`,
    placeHolder: "e.g. Add a --version flag to the CLI",
  });
  if (!description) return;

  // Ensure the role is registered in the orchestrator.
  // registerRole is idempotent if the role was already registered.
  orch.registerRole(selectedRole);

  stage.reveal();
  try {
    cockpit.handle({ type: "spawn", roleName: selectedRole.name, description });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Maestro: could not spawn agent: ${message}`);
  }
}),
```

Also: the initial `orch.registerRole(DEFAULT_ROLE)` call that already exists in `activate()` stays in place -- it ensures the fallback role is always registered even if no `.conductor/` exists.

Note on `registerRole` idempotency: the current `Orchestrator.registerRole` stores roles in a `Map<name, Role>`. Calling it with the same name twice overwrites; that is the correct behavior when a YAML file redefines a role's instructions.

- [ ] Make the changes to `packages/extension/src/extension.ts` and `packages/extension/package.json`.
- [ ] Run `pnpm --filter @maestro/extension typecheck` -> passes (no VS Code runtime needed for typecheck).
- [ ] Run the full gate: `pnpm -r test` -> all green (112+ existing tests plus the ~30 new config tests).
- [ ] Run `pnpm --filter @maestro/extension build` -> esbuild bundles without errors.
- [ ] Commit: `feat(extension): load roles from .conductor/ with QuickPick and first-run scaffolder`

---

### Task 10: Add `.conductor/` fixture files (optional, aids manual F5 testing)

These are not test fixtures (those are inline YAML strings in the test files). These are real example files a developer can inspect when they `F5` the extension in a workspace that has no `.conductor/` yet. The scaffolder will create them automatically, but committing examples to `packages/extension/test-fixtures/` makes the expected YAML shape visible in the repo.

- [ ] Create `packages/extension/test-fixtures/.conductor/roles/implementer.yaml`:

```yaml
name: Implementer
instructions: >-
  You are an implementer. Make the requested change in this worktree.
  Commit your changes when done. Do not modify files outside the scope of the task.
engine:
  id: copilot
autonomy: auto-approve-safe
```

- [ ] Create `packages/extension/test-fixtures/.conductor/config.yaml`:

```yaml
# Maestro orchestrator configuration
maxParallelAgents: 3
```

- [ ] Commit: `docs(extension): add .conductor/ example fixtures for manual testing`

---

## Self-Review Checklist

- [ ] `Team` is in `@maestro/core/src/types.ts` (not in config), justification documented.
- [ ] `DEFAULT_ROLE` is kept in `extension.ts` and registered unconditionally; it is the fallback when `.conductor/` is absent or all files fail to parse.
- [ ] All validator / parser / loader / scaffolder logic is unit-tested with NO real disk I/O (injectable `FsReader` / `FsWriter`).
- [ ] Unknown engine ids produce a `ValidationWarning`, not an error. The `KNOWN_ENGINE_IDS` set is exported so M5 can add `"acp"` without touching the validator.
- [ ] The `yaml` dep is justified (v2, ESM-compatible, no hand-rolling).
- [ ] No em dashes anywhere in plan prose, code, comments, or commit messages.
- [ ] Every task ends with a commit; commit messages end with the `Co-Authored-By` trailer.
- [ ] `packages/config` mirrors `packages/workspace` exactly in `package.json` scripts, `tsconfig.json`, `tsconfig.build.json`, and `vitest.config.ts`.
- [ ] The extension `activate()` delta is additive: existing `orch.registerRole(DEFAULT_ROLE)` call is retained, existing command is replaced in-place (not duplicated), no other lines are removed.
- [ ] Shared file deltas are described as additive patches, not full rewrites.
- [ ] `makeNodeFsReader` / `makeNodeFsWriter` use dynamic `import()` so they do not pull Node.js `fs` into test environments where it is mocked.
- [ ] `pnpm install` is called after adding the new `package.json` (pnpm 10 requirement).
- [ ] Full gate `pnpm -r test` remains green at every commit.
- [ ] `registerRole` is called for the selected role inside the spawn command to handle roles loaded from YAML that were not pre-registered at activate time.
- [ ] Teams are loaded and available in `LoadResult` for future UI use (roster grouping, M4+ iteration) even though M8 does not yet wire them into the cockpit.
