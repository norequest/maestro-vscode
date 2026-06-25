import type { DiscoveredItem, McpInventory } from "@maestro/config";

/** Which tab is active in the Library panel. */
export type LibraryTab = "agents" | "teams" | "skills" | "discover";

/** A single skill's renderable data in the Library panel. */
export interface SkillCardVM {
  name: string;
  description: string;
  /** DECLARED requirements, never a grant (R5). */
  allowedTools?: string[];
  /** "plugin" triggers a From-plugin badge (adoption is P5; default "authored"). */
  source: "authored" | "plugin";
  /** Blast radius: which roles use this skill. Amber at length >= 3. */
  usedBy: { roleName: string; engineId: string }[];
}

/** A team being edited in the team editor; name === "" signals create-mode. */
export interface TeamEditVM {
  name: string;
  /** The role names selected as this team's members. */
  roleNames: string[];
  /** The team's shared goal/charter text. */
  goal?: string;
}

/** The whole Library snapshot, a pure function of config state. */
export interface LibrarySnapshot {
  tab: LibraryTab;
  skills: SkillCardVM[];
  /** Read-only Agents tab data. */
  roles: { name: string; engineId: string; skills: string[] }[];
  /** Read-only Teams tab data. */
  teams: { name: string; roleNames: string[] }[];
  /** Open skill editor; name === "" signals create-mode. */
  editing?: SkillCardVM;
  /** Open team editor; name === "" signals create-mode. */
  editingTeam?: TeamEditVM;
  /** Open Add-skill picker bound to a role. */
  picker?: { roleName: string };
}

/** Messages the extension host sends INTO the Library webview. */
export type HostToLibrary =
  | { type: "library-state"; snapshot: LibrarySnapshot }
  | {
      type: "discover-results";
      items: DiscoveredItem[];
      mcp: McpInventory;
      scanError?: string;
      /** Sources (item.source) the user has already adopted this session, so the card shows an adopted state. */
      adoptedSources?: string[];
    };

/** Messages the Library webview sends OUT to the extension host. */
export type LibraryToHost =
  | { type: "open-library" }
  | { type: "switch-library-tab"; tab: LibraryTab }
  | { type: "skill-create" }
  | { type: "skill-save"; name: string; description: string; body: string; allowedTools?: string[] }
  | { type: "skill-delete"; name: string }
  // Group 1 (Agents tab): seed a default role then open its anatomy editor; delete a role.
  // name is optional: the webview omits it and the host collects it via a native
  // input box (VS Code webviews can't use window.prompt()).
  | { type: "new-role"; name?: string }
  | { type: "delete-role"; name: string }
  // Group 2 (Teams tab): open a blank team editor, save a team, delete a team.
  | { type: "team-create" }
  | { type: "team-save"; name: string; roleNames: string[]; goal?: string }
  | { type: "team-delete"; name: string }
  // Group 3 (Teams tab): launch a team by name (intercepted by the extension host).
  // `task` is the multi-line task collected by the in-webview overlay. When present
  // the host skips its showInputBox; when absent (palette path) the host prompts.
  | { type: "launch-team"; name: string; task?: string }
  | { type: "attach-skill"; roleName: string; skillName: string }
  | { type: "detach-skill"; roleName: string; skillName: string }
  | { type: "scan-repo" }
  | { type: "scan-plugins" }
  | { type: "adopt-agent"; itemId: string }
  | { type: "adopt-skill"; itemId: string }
  | { type: "browse-source"; itemId: string };

// ─── Runtime guard ────────────────────────────────────────────────────────────

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptStringArray(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((item) => isString(item));
}

const LIBRARY_TABS = new Set<string>(["agents", "teams", "skills", "discover"]);

/**
 * Pure runtime guard for the Library webview->host boundary. The webview is a
 * separate, potentially-compromised JS context, so its postMessage payloads are
 * untrusted `unknown`. This narrows them to a real LibraryToHost, letting the
 * host drop anything malformed before it reaches the controller.
 */
export function isLibraryMessage(msg: unknown): msg is LibraryToHost {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (!isString(m["type"])) return false;
  const type = m["type"];

  switch (type) {
    case "open-library":
    case "skill-create":
    case "team-create":
      return true;
    case "switch-library-tab":
      return isString(m["tab"]) && LIBRARY_TABS.has(m["tab"] as string);
    case "skill-save":
      return (
        isString(m["name"]) &&
        isString(m["description"]) &&
        isString(m["body"]) &&
        isOptStringArray(m["allowedTools"])
      );
    case "new-role":
      // name is optional (host prompts when omitted); when present it must be a string.
      return m["name"] === undefined || isString(m["name"]);
    case "skill-delete":
    case "delete-role":
    case "team-delete":
      return isString(m["name"]);
    case "launch-team":
      // task is optional (palette path omits it; the overlay includes it).
      return isString(m["name"]) && (m["task"] === undefined || isString(m["task"]));
    case "team-save":
      return (
        isString(m["name"]) &&
        isOptStringArray(m["roleNames"]) &&
        Array.isArray(m["roleNames"]) &&
        (m["goal"] === undefined || isString(m["goal"]))
      );
    case "attach-skill":
    case "detach-skill":
      return isString(m["roleName"]) && isString(m["skillName"]);
    case "scan-repo":
    case "scan-plugins":
      return true;
    case "adopt-agent":
    case "adopt-skill":
    case "browse-source":
      return isString(m["itemId"]);
    default:
      return false;
  }
}
