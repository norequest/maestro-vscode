/** Pure unified-diff parser. Never throws on malformed input. */

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFileChange {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted";
  adds: number;
  dels: number;
  hunks: DiffHunk[];
}

export interface DiffStat {
  adds: number;
  dels: number;
}

export interface ParsedDiff {
  files: DiffFileChange[];
  stat: DiffStat;
}

// Match @@ -oldStart[,oldLines] +newStart[,newLines] @@
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/;

export function parseUnifiedDiff(patch: string): ParsedDiff {
  if (!patch || !patch.trim()) {
    return { files: [], stat: { adds: 0, dels: 0 } };
  }

  const files: DiffFileChange[] = [];

  // Split on "diff --git" boundary to get per-file sections.
  // Each section starts right after "diff --git ..." line.
  const sections = patch.split(/^(?=diff --git )/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    const sectionLines = section.split("\n");
    let i = 0;

    // Skip the "diff --git a/... b/..." header line
    const diffLine = sectionLines[i];
    if (!diffLine || !diffLine.startsWith("diff --git ")) {
      // This is not a valid diff section, skip
      continue;
    }
    i++;

    let oldPath: string | undefined;
    let newPath: string | undefined;

    // Parse optional extended headers (index, similarity, rename, mode, etc.)
    // and the --- / +++ lines
    while (i < sectionLines.length) {
      const line = sectionLines[i]!;
      if (line.startsWith("--- ")) {
        const raw = line.slice(4);
        oldPath = raw === "/dev/null" ? "/dev/null" : raw.replace(/^[ab]\//, "");
        i++;
      } else if (line.startsWith("+++ ")) {
        const raw = line.slice(4);
        newPath = raw === "/dev/null" ? "/dev/null" : raw.replace(/^[ab]\//, "");
        i++;
        break; // +++ is always last before hunks
      } else if (line.startsWith("@@")) {
        // No --- / +++ found (binary or unusual), stop
        break;
      } else {
        // extended header lines (index ..., mode ..., rename ..., etc.)
        i++;
      }
    }

    // Determine status
    let status: "added" | "modified" | "deleted";
    if (oldPath === "/dev/null") {
      status = "added";
    } else if (newPath === "/dev/null") {
      status = "deleted";
    } else {
      status = "modified";
    }

    // Derive path: prefer new path for added/modified, old path for deleted
    const path =
      status === "deleted"
        ? (oldPath ?? newPath ?? "unknown")
        : (newPath ?? oldPath ?? "unknown");

    const oldPathResult =
      status === "modified" && oldPath && oldPath !== path ? oldPath : undefined;

    // Parse hunks
    const hunks: DiffHunk[] = [];
    let fileAdds = 0;
    let fileDels = 0;

    while (i < sectionLines.length) {
      const line = sectionLines[i]!;
      const hunkMatch = HUNK_HEADER_RE.exec(line);
      if (!hunkMatch) {
        // Not a hunk header, skip (could be a trailing binary marker, etc.)
        i++;
        continue;
      }

      const oldStart = parseInt(hunkMatch[1]!, 10);
      // omitted count defaults to 1
      const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3]!, 10);
      const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      const header = line;
      i++;

      const hunkLines: DiffLine[] = [];
      let oldNo = oldStart;
      let newNo = newStart;

      while (i < sectionLines.length) {
        const l = sectionLines[i]!;
        // Stop this hunk if we hit the next hunk header or a new diff section
        if (l.startsWith("@@") || l.startsWith("diff --git ")) {
          break;
        }

        if (l.startsWith("+") && !l.startsWith("+++")) {
          hunkLines.push({ kind: "add", text: l.slice(1), newNo: newNo++ });
          fileAdds++;
        } else if (l.startsWith("-") && !l.startsWith("---")) {
          hunkLines.push({ kind: "del", text: l.slice(1), oldNo: oldNo++ });
          fileDels++;
        } else if (l.startsWith(" ") || l === "") {
          // Context line (leading space) or blank line within hunk
          hunkLines.push({ kind: "context", text: l.startsWith(" ") ? l.slice(1) : l, oldNo: oldNo++, newNo: newNo++ });
        } else {
          // Unclassifiable line (e.g. "\\ No newline at end of file"), skip
        }

        i++;
      }

      hunks.push({ header, oldStart, oldLines, newStart, newLines, lines: hunkLines });
    }

    files.push({
      path,
      ...(oldPathResult !== undefined ? { oldPath: oldPathResult } : {}),
      status,
      adds: fileAdds,
      dels: fileDels,
      hunks,
    });
  }

  const stat: DiffStat = files.reduce(
    (acc, f) => ({ adds: acc.adds + f.adds, dels: acc.dels + f.dels }),
    { adds: 0, dels: 0 }
  );

  return { files, stat };
}
