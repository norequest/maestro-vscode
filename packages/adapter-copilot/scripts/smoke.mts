// Run: MAESTRO_LIVE=1 COPILOT_GITHUB_TOKEN=... pnpm --filter @maestro/adapter-copilot smoke
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotAdapter } from "../dist/index.js";

if (process.env.MAESTRO_LIVE !== "1") {
  console.log("Skipping live smoke test (set MAESTRO_LIVE=1 to run).");
  process.exit(0);
}

// Throwaway git repo so the agent has a worktree to act on.
const dir = mkdtempSync(join(tmpdir(), "maestro-copilot-smoke-"));
execSync("git init -q && git commit -q --allow-empty -m init", { cwd: dir });

const adapter = new CopilotAdapter();
const health = await adapter.health();
console.log("health:", health);
if (!health.ok) process.exit(1);

const session = adapter.start(
  { id: "t", description: "Create a file HELLO.md containing 'Hello from Maestro'.", roleName: "R" },
  { agentId: "a", path: dir, branch: "smoke" },
  {
    name: "R",
    instructions: "Make the smallest possible change.",
    engine: { id: "copilot", model: "claude-sonnet-4.6" },
    autonomy: "yolo",
  },
);

for await (const event of session.events) {
  console.log(`[${event.kind}]`, JSON.stringify(event).slice(0, 200));
}
console.log("Smoke complete. Inspect the worktree:", dir);
console.log("Diff:\n", execSync("git -C " + dir + " status --porcelain").toString());
