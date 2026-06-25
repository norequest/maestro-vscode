import type { Role } from "@maestro/core";
import type { SkillManifest } from "./skill-types.js";

/** A queryable reverse index from skill name to the roles that declare it. */
export interface SkillIndex {
  /**
   * Returns every role that lists `name` in its `skills` array.
   * Returns [] for skills that no role references.
   */
  usedBy(name: string): Role[];
  /**
   * Returns the count of roles that list `name` in their `skills` array.
   * Returns 0 for unreferenced skills.
   *
   * A role that references a skill name for which NO manifest exists is
   * counted by NAME (a dangling reference still shows its blast radius).
   */
  usedByCount(name: string): number;
  /** Returns the complete map from skill name to the roles that use it. */
  all(): Map<string, Role[]>;
}

/**
 * Builds a reverse index (skill name -> roles) from a list of roles and a list
 * of loaded manifests.
 *
 * Roles that declare a skill name for which no manifest was loaded are still
 * indexed by NAME. This ensures that deleting or renaming a skill shows the
 * full blast radius of dependent roles rather than silently hiding them.
 */
export function buildSkillIndex(
  roles: Role[],
  _manifests: SkillManifest[],
): SkillIndex {
  // We deliberately ignore _manifests when building the index: the index is
  // keyed by the NAME declared in role.skills, not by which manifests happened
  // to load successfully. Missing manifests are a load warning, not a reason
  // to hide the dependency.
  const map = new Map<string, Role[]>();

  for (const role of roles) {
    if (!role.skills || role.skills.length === 0) continue;
    for (const skillName of role.skills) {
      const existing = map.get(skillName);
      if (existing) {
        existing.push(role);
      } else {
        map.set(skillName, [role]);
      }
    }
  }

  return {
    usedBy(name: string): Role[] {
      return map.get(name) ?? [];
    },
    usedByCount(name: string): number {
      return map.get(name)?.length ?? 0;
    },
    all(): Map<string, Role[]> {
      return new Map(map);
    },
  };
}
