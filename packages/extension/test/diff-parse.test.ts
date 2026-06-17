import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../src/diff-parse.js";

describe("parseUnifiedDiff", () => {
  it("empty patch returns no files and zero stat", () => {
    const result = parseUnifiedDiff("");
    expect(result.files).toHaveLength(0);
    expect(result.stat).toEqual({ adds: 0, dels: 0 });
  });

  it("whitespace-only patch returns no files and zero stat", () => {
    const result = parseUnifiedDiff("   \n\t\n");
    expect(result.files).toHaveLength(0);
    expect(result.stat).toEqual({ adds: 0, dels: 0 });
  });

  it("single modified file: classifies lines as context/del/add/add/context, adds 2, dels 1, oldStart/newStart 1", () => {
    const patch = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc..def 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " context line",
      "-deleted line",
      "+added line 1",
      "+added line 2",
      " context end",
    ].join("\n");

    const result = parseUnifiedDiff(patch);
    expect(result.files).toHaveLength(1);

    const file = result.files[0]!;
    expect(file.status).toBe("modified");
    expect(file.adds).toBe(2);
    expect(file.dels).toBe(1);
    expect(result.stat).toEqual({ adds: 2, dels: 1 });

    // One hunk
    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);

    const kinds = hunk.lines.map((l) => l.kind);
    expect(kinds).toEqual(["context", "del", "add", "add", "context"]);
  });

  it("hunk header without counts defaults count to 1", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -5 +5 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = parseUnifiedDiff(patch);
    expect(result.files).toHaveLength(1);
    const hunk = result.files[0]!.hunks[0]!;
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newLines).toBe(1);
  });

  it("added file (old is /dev/null) => status 'added'", () => {
    const patch = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");

    const result = parseUnifiedDiff(patch);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.status).toBe("added");
    expect(result.files[0]!.adds).toBe(2);
    expect(result.files[0]!.dels).toBe(0);
  });

  it("deleted file (new is /dev/null) => status 'deleted'", () => {
    const patch = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line one",
      "-line two",
    ].join("\n");

    const result = parseUnifiedDiff(patch);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.status).toBe("deleted");
    expect(result.files[0]!.dels).toBe(2);
    expect(result.files[0]!.adds).toBe(0);
  });

  it("multi-file patch: parses every file and aggregates stat {adds:3, dels:1}", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-old",
      "+new1",
      "+new2",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,2 @@",
      " ctx",
      "+extra",
    ].join("\n");

    const result = parseUnifiedDiff(patch);
    expect(result.files).toHaveLength(2);
    expect(result.stat).toEqual({ adds: 3, dels: 1 });
  });

  it("malformed input does NOT throw", () => {
    expect(() => parseUnifiedDiff("garbage\nnot a diff\n@@ broken")).not.toThrow();
    expect(() => parseUnifiedDiff("@@ -1,0 +1,0 @@\n+line")).not.toThrow();
    expect(() => parseUnifiedDiff("diff --git a/x b/x\n@@ -1 +1 @@\n+line")).not.toThrow();
  });

  it("line number tracking: context advances both, add advances newNo, del advances oldNo", () => {
    const patch = [
      "diff --git a/z.ts b/z.ts",
      "--- a/z.ts",
      "+++ b/z.ts",
      "@@ -10,3 +10,3 @@",
      " ctx",
      "-removed",
      "+inserted",
      " ctx2",
    ].join("\n");

    const result = parseUnifiedDiff(patch);
    const hunk = result.files[0]!.hunks[0]!;

    // context at old=10, new=10
    expect(hunk.lines[0]!.oldNo).toBe(10);
    expect(hunk.lines[0]!.newNo).toBe(10);

    // del at old=11
    expect(hunk.lines[1]!.kind).toBe("del");
    expect(hunk.lines[1]!.oldNo).toBe(11);
    expect(hunk.lines[1]!.newNo).toBeUndefined();

    // add at new=11
    expect(hunk.lines[2]!.kind).toBe("add");
    expect(hunk.lines[2]!.newNo).toBe(11);
    expect(hunk.lines[2]!.oldNo).toBeUndefined();

    // context at old=12, new=12
    expect(hunk.lines[3]!.oldNo).toBe(12);
    expect(hunk.lines[3]!.newNo).toBe(12);
  });
});
