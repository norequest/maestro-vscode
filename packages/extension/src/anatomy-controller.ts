/**
 * Anatomy controller: holds the current role anatomy in memory, handles
 * inbound AnatomyToHost messages, routes every write through an injected
 * AnatomyGateway (the seam over @hallucinate/config + node fs), so it unit-tests
 * against a FAKE gateway with zero disk I/O.
 *
 * After every write it reloads, rebuilds the AnatomyVM, and calls onSnapshot.
 *
 * NO node imports in this file.
 */

import type { Role, ToolGrant } from "@hallucinate/core";
import { countGrants } from "@hallucinate/core";
import { skillNeedsGrant } from "@hallucinate/config";
import type { AnatomyVM, AnatomyToHost } from "./anatomy-protocol.js";

// ─── AnatomyGateway seam ─────────────────────────────────────────────────────

/**
 * Injectable gateway interface over @hallucinate/config + node fs.
 * The REAL implementation wires to disk; tests use a fake with no I/O.
 */
export interface AnatomyGateway {
  loadRole(roleName: string): Promise<Role | null>;
  /** Returns "" when the role has no soul, or the soul file does not exist. */
  loadSoulBody(roleName: string): Promise<string>;
  /** Returns declared requirements (allowedTools) for each known skill. */
  loadSkillRequirements(): Promise<{ name: string; allowedTools?: string[] }[]>;
  /** Serialize and write the role to .hallucinate/roles/<name>.yaml. */
  writeRole(role: Role): Promise<void>;
  /**
   * Write the soul body to .hallucinate/souls/<roleName>.md.
   * Also sets role.soul to the roleName if it was absent, then writes the role.
   */
  writeSoul(roleName: string, body: string): Promise<void>;
  /**
   * Gate for the engine-id guard (R6): returns true only for ids in
   * KNOWN_ENGINE_IDS (currently "copilot" | "acp").
   */
  isKnownEngineId(id: string): boolean;
}

// ─── Handle ───────────────────────────────────────────────────────────────────

export interface AnatomyHandle {
  handle(msg: AnatomyToHost): Promise<void>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a full AnatomyVM from the gateway. Loads role, soul body, and skill
 * requirements; computes toolsSummary + per-skill gap.
 */
async function buildVM(
  gw: AnatomyGateway,
  roleName: string
): Promise<AnatomyVM | null> {
  const [role, soulBody, skillReqs] = await Promise.all([
    gw.loadRole(roleName),
    gw.loadSoulBody(roleName),
    gw.loadSkillRequirements(),
  ]);

  if (!role) return null;

  const toolsSummary = countGrants(role.tools);

  // Compute per-skill gap
  const skills = (role.skills ?? []).map((name) => {
    const req = skillReqs.find((s) => s.name === name);
    const gap = skillNeedsGrant(req?.allowedTools, role.tools);
    return { name, allowedTools: req?.allowedTools, gap };
  });

  // Known skills NOT currently attached, for the "+ Add skill" picker.
  const attached = new Set(role.skills ?? []);
  const availableSkills = skillReqs
    .filter((s) => !attached.has(s.name))
    .map((s) => ({ name: s.name, ...(s.allowedTools !== undefined ? { allowedTools: s.allowedTools } : {}) }));

  const vm: AnatomyVM = {
    roleName: role.name,
    instructions: role.instructions,
    engineId: role.engine.id,
    model: role.engine.model,
    autonomy: role.autonomy,
    soulName: role.soul,
    soulBody,
    tools: role.tools,
    toolsSummary,
    skills,
    availableSkills,
  };

  return vm;
}

/**
 * Ensure a ToolGrant structure exists, returning the original or a fresh empty one.
 */
function ensureGrant(tools: ToolGrant | undefined): ToolGrant {
  return tools ?? {};
}

// ─── createAnatomyController ──────────────────────────────────────────────────

/**
 * Create the anatomy controller. Holds the current role in memory; each
 * `handle()` call mutates that state and calls `onSnapshot` with the new VM,
 * or `onError` when a mutation is refused (e.g. unknown engine id).
 *
 * @param gw - The anatomy gateway (real or fake).
 * @param onSnapshot - Called with the new AnatomyVM after every state change.
 * @param onError - Called when a mutation is refused; receives an error message.
 */
export function createAnatomyController(
  gw: AnatomyGateway,
  onSnapshot: (vm: AnatomyVM) => void,
  onError?: (message: string) => void
): AnatomyHandle {
  // The last successfully loaded role name, so we can reload after mutations.
  let currentRoleName: string | null = null;

  async function reload(): Promise<void> {
    if (!currentRoleName) return;
    const vm = await buildVM(gw, currentRoleName);
    if (vm) onSnapshot(vm);
  }

  async function handle(msg: AnatomyToHost): Promise<void> {
    switch (msg.type) {
      case "open-anatomy": {
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-set-instructions": {
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const updated: Role = { ...role, instructions: msg.instructions };
        await gw.writeRole(updated);
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-set-tools": {
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const updated: Role = { ...role, tools: msg.tools };
        await gw.writeRole(updated);
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-set-autonomy": {
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const updated: Role = { ...role, autonomy: msg.autonomy };
        await gw.writeRole(updated);
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-set-engine": {
        // R6: refuse unknown engine ids
        if (!gw.isKnownEngineId(msg.engineId)) {
          const errMsg = `Unknown engine id: "${msg.engineId}". Refusing to write.`;
          if (onError) onError(errMsg);
          return;
        }
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const updated: Role = {
          ...role,
          engine: { id: msg.engineId, model: msg.model },
        };
        await gw.writeRole(updated);
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-set-soul": {
        // writeSoul handles both writing the soul.md AND patching role.soul
        await gw.writeSoul(msg.roleName, msg.soul);
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "grant-tool": {
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const grant = ensureGrant(role.tools);
        const builtins = grant.builtins ?? {};

        if (msg.write) {
          // Add to write list only (WRITE is added ONLY when write === true)
          const existing = builtins.write ?? [];
          const next = existing.includes(msg.tool as never)
            ? existing
            : ([...existing, msg.tool] as typeof existing);
          const updatedBuiltins = { ...builtins, write: next };
          const updated: Role = { ...role, tools: { ...grant, builtins: updatedBuiltins } };
          await gw.writeRole(updated);
        } else {
          // Add to read list only (never silently adds write)
          const existing = builtins.read ?? [];
          const next = existing.includes(msg.tool as never)
            ? existing
            : ([...existing, msg.tool] as typeof existing);
          const updatedBuiltins = { ...builtins, read: next };
          const updated: Role = { ...role, tools: { ...grant, builtins: updatedBuiltins } };
          await gw.writeRole(updated);
        }

        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-attach-skill": {
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const existing = role.skills ?? [];
        // Dedup-append: only add the skill if it is not already attached.
        const next = existing.includes(msg.skillName)
          ? existing
          : [...existing, msg.skillName];
        await gw.writeRole({ ...role, skills: next });
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      case "role-detach-skill": {
        const role = await gw.loadRole(msg.roleName);
        if (!role) return;
        const next = (role.skills ?? []).filter((s) => s !== msg.skillName);
        await gw.writeRole({ ...role, skills: next });
        currentRoleName = msg.roleName;
        await reload();
        return;
      }

      default: {
        // Exhaustiveness guard: a new AnatomyToHost variant is a loud compile error.
        const _exhaustive: never = msg;
        void _exhaustive;
        return;
      }
    }
  }

  return { handle };
}
