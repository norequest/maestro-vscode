import { mkdir, readFile, appendFile, readdir, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { isSafeAgentId, safeAgentFileName, type PersistenceBackend } from "./persistence.js";

/**
 * Production backend: one JSONL file per agent under
 * `.hallucinate/.runtime/<agentId>.jsonl` in the workspace root. The directory is
 * gitignored and created lazily on first write.
 *
 * Security note: these logs persist raw agent scrollback (model output and tool
 * I/O), which may contain secrets. They are local-only and gitignored; do not
 * commit, ship, or transmit them.
 */
export class FsPersistenceBackend implements PersistenceBackend {
  private readonly dir: string;

  constructor(repoRoot: string) {
    this.dir = join(repoRoot, ".hallucinate", ".runtime");
  }

  private filePath(agentId: string): string {
    // Allowlist the id (safeAgentFileName throws on anything unsafe), then
    // assert the resolved path is still inside this.dir (defense in depth
    // against any future change to the naming scheme).
    const filePath = join(this.dir, safeAgentFileName(agentId));
    const root = resolve(this.dir) + sep;
    if (!resolve(filePath).startsWith(root)) {
      throw new Error(`[Hallucinate persistence] path escapes runtime dir: ${agentId}`);
    }
    return filePath;
  }

  async read(agentId: string): Promise<string> {
    try {
      return await readFile(this.filePath(agentId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  async append(agentId: string, line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.filePath(agentId), line, "utf8");
  }

  async listAgentIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries
        .filter((e) => e.endsWith(".jsonl"))
        .map((e) => e.slice(0, -".jsonl".length))
        // On-disk names are trusted only as far as the allowlist: drop anything
        // an external process could have planted that is not a safe id.
        .filter(isSafeAgentId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async remove(agentId: string): Promise<void> {
    try {
      await unlink(this.filePath(agentId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}
