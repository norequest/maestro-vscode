import type { Role } from "@hallucinate/core";

/** The subset of a dispatch message this helper reads. */
export interface DispatchLike {
  roleName?: string;
}

export interface DispatchPrepDeps {
  /** Load all saved roles from .hallucinate/ (resolve to [] on failure is fine). */
  loadRoles: () => Promise<Role[]>;
  /** Register a role with the orchestrator (idempotent: overwrites by name). */
  registerRole: (role: Role) => void;
}

/**
 * The board's "New agent" composer sends only a role NAME. The orchestrator's
 * registry, however, holds only the built-in default role, so dispatching a
 * saved custom agent by name would fail to resolve (or fall back to a generic
 * role) and the agent would run WITHOUT its soul/instructions.
 *
 * This loads the named role's full anatomy (soul + instructions + skills +
 * tools) from .hallucinate/ and registers it before the dispatch is forwarded,
 * mirroring what the hallucinate.spawnAgent command already does. Best-effort: an
 * ad-hoc dispatch (no roleName), an unknown name, or a load failure are all
 * no-ops, leaving the existing dispatch behavior intact.
 */
export async function prepareSavedRoleDispatch(
  msg: DispatchLike,
  deps: DispatchPrepDeps,
): Promise<void> {
  if (msg.roleName === undefined) return;
  const roles = await deps.loadRoles().catch(() => [] as Role[]);
  const role = roles.find((r) => r.name === msg.roleName);
  if (role) deps.registerRole(role);
}
