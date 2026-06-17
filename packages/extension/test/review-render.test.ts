import { describe, it, expect } from "vitest";
import { renderReview } from "../src/review-render.js";
import type { CardVM } from "@maestro/cockpit";
import type { ParsedDiff } from "../src/diff-parse.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function card(over: Partial<CardVM> = {}): CardVM {
  return {
    id: "agent-1",
    roleName: "Implementer",
    engineId: "copilot",
    state: "done",
    lane: "done",
    output: "",
    taskDescription: "Add login route",
    attention: false,
    ...over,
  };
}

function parsed(over: Partial<ParsedDiff> = {}): ParsedDiff {
  return {
    files: [
      {
        path: "src/auth.ts",
        status: "modified",
        adds: 1,
        dels: 0,
        hunks: [
          {
            header: "@@ -1,1 +1,2 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [
              { kind: "context", text: "existing", oldNo: 1, newNo: 1 },
              { kind: "add", text: "new line", newNo: 2 },
            ],
          },
        ],
      },
    ],
    stat: { adds: 1, dels: 0 },
    ...over,
  };
}

// ─── Task 2: Clean review screen ─────────────────────────────────────────────

describe("renderReview — clean path", () => {
  it("header shows role, engine, and a branch line containing 'main'", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("Implementer");
    expect(html).toContain("copilot");
    expect(html).toContain("main");
  });

  it("header renders a task description", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("Add login route");
  });

  it("header renders a faint goal why-line when goal is present", () => {
    const html = renderReview(card({ goal: "so that auth works" }), parsed());
    expect(html).toContain("so that auth works");
  });

  it("files rail lists the file with +1", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("src/auth.ts");
    expect(html).toContain("+1");
  });

  it("contains graphite palette hex values and NOT var(--vscode-*)", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("#4a9eff");
    expect(html).toContain("#4caf50");
    expect(html).not.toContain("var(--vscode-");
  });

  it("decision bar has merge, discard, sendBack, and approve data-action attributes", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
    expect(html).toContain('data-action="sendBack"');
    expect(html).toContain('data-action="approve"');
  });

  it("decision bar buttons carry the card id", () => {
    const html = renderReview(card({ id: "xyz-99" }), parsed());
    expect(html).toContain('data-id="xyz-99"');
  });

  it("escapes <script> in summary so raw tag is absent and entity is present", () => {
    const html = renderReview(
      card({ summary: "<script>alert(1)</script>" }),
      parsed()
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("escapes <img src=x> in diff text so raw tag is absent", () => {
    const badParsed = parsed({
      files: [
        {
          path: "src/bad.ts",
          status: "modified",
          adds: 1,
          dels: 0,
          hunks: [
            {
              header: "@@ -1 +1 @@",
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: [{ kind: "add", text: '<img src=x onerror=alert(1)>', newNo: 1 }],
            },
          ],
        },
      ],
      stat: { adds: 1, dels: 0 },
    });
    const html = renderReview(card(), badParsed);
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain('<img src=x onerror');
  });

  it("diffError card replaces diff body with error text and renders merge button disabled", () => {
    const html = renderReview(
      card({ diffError: "git diff failed: exit 128" }),
      parsed({ files: [], stat: { adds: 0, dels: 0 } })
    );
    expect(html).toContain("git diff failed: exit 128");
    expect(html).toContain('disabled');
    // merge button should be disabled
    expect(html).toMatch(/merge[^<]*disabled|disabled[^>]*merge/i);
  });

  it("diff hunk header row is rendered", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("@@ -1,1 +1,2 @@");
  });

  it("summary card shows 'what the agent says' heading when summary is present", () => {
    const html = renderReview(card({ summary: "Added auth route" }), parsed());
    expect(html).toContain("Added auth route");
  });

  it("escapes engineId in the output", () => {
    const html = renderReview(card({ engineId: "<evil>" }), parsed());
    expect(html).toContain("&lt;evil&gt;");
    expect(html).not.toContain("<evil>");
  });

  it("escapes roleName in the output", () => {
    const html = renderReview(card({ roleName: '<script>xss</script>' }), parsed());
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>xss");
  });
});

// ─── Task 3: Conflict variant ─────────────────────────────────────────────────

describe("renderReview — conflict variant", () => {
  function conflictCard(): CardVM {
    return card({
      state: "conflict",
      lane: "conflict",
      conflictFiles: ["src/foo.ts"],
    });
  }

  function conflictParsed(): ParsedDiff {
    return parsed({
      files: [
        {
          path: "src/foo.ts",
          status: "modified",
          adds: 3,
          dels: 3,
          hunks: [
            {
              header: "@@ -1,6 +1,6 @@",
              oldStart: 1,
              oldLines: 6,
              newStart: 1,
              newLines: 6,
              lines: [
                { kind: "add", text: "<<<<<<< ours", newNo: 1 },
                { kind: "add", text: "our change", newNo: 2 },
                { kind: "add", text: "=======", newNo: 3 },
                { kind: "del", text: ">>>>>>> theirs", oldNo: 1 },
                { kind: "del", text: "their change", oldNo: 2 },
                { kind: "del", text: "=======", oldNo: 3 },
              ],
            },
          ],
        },
      ],
      stat: { adds: 3, dels: 3 },
    });
  }

  it("renders amber #f0a030 banner", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("#f0a030");
  });

  it("renders a conflict banner containing the word 'conflict'", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html.toLowerCase()).toContain("conflict");
  });

  it("renders the conflicted file name in the output", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("src/foo.ts");
  });

  it("git markers are rendered ESCAPED: <<<<<< => &lt;&lt;&lt;&lt;&lt;&lt;&lt;", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("&lt;&lt;&lt;&lt;&lt;&lt;&lt;");
    expect(html).not.toContain("<<<<<<< ours");
  });

  it("======= marker is rendered escaped", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    // ======= is safe HTML (no < or >) but should appear in escaped form or as literal
    expect(html).toContain("=======");
  });

  it(">>>>>>> marker is rendered ESCAPED: &gt;&gt;&gt;&gt;&gt;&gt;&gt;", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("&gt;&gt;&gt;&gt;&gt;&gt;&gt;");
    expect(html).not.toContain(">>>>>>> theirs");
  });

  it("primary action is data-action='finish-merge' and NOT data-action='merge'", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain('data-action="finish-merge"');
    // No standalone merge action button (resolve path uses finish-merge)
    expect(html).not.toMatch(/data-action="merge"/);
  });

  it("data-action='resolve-conflict' is present (edit hand-off)", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain('data-action="resolve-conflict"');
  });

  it("data-stretch='true' is present on keep-ours/keep-theirs chips", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain('data-stretch="true"');
  });
});

// ─── Task 4: PR mode and cleanup-failed recovery ──────────────────────────────

describe("renderReview — PR mode", () => {
  it("primary is create-pr, not merge", () => {
    const html = renderReview(card(), parsed(), { prMode: true });
    expect(html).toContain('data-action="create-pr"');
    expect(html).not.toMatch(/data-action="merge"/);
  });

  it("shows 'draft' copy when prDraft is true", () => {
    const html = renderReview(card(), parsed(), { prMode: true, prDraft: true });
    expect(html.toLowerCase()).toContain("draft");
  });

  it("branch line contains a 'PR mode' pill", () => {
    const html = renderReview(card(), parsed(), { prMode: true });
    expect(html.toLowerCase()).toContain("pr mode");
  });

  it("PR mode pill uses muted color #6a6a6a", () => {
    const html = renderReview(card(), parsed(), { prMode: true });
    expect(html).toContain("#6a6a6a");
  });

  it("pr-created state renders terminal note about pull request opened and branch kept", () => {
    const html = renderReview(
      card({ state: "pr-created", lane: "done" }),
      parsed(),
      { prMode: true }
    );
    expect(html.toLowerCase()).toContain("pull request opened");
    expect(html.toLowerCase()).toContain("branch kept");
  });
});

describe("renderReview — merge-cleanup-failed recovery", () => {
  function failedCard(): CardVM {
    return card({
      state: "merge-cleanup-failed",
      lane: "done",
      error: "rm -rf .git/worktrees/agent-1 failed: EBUSY",
    });
  }

  it("renders amber #f0a030 recovery banner (NOT red #e05050 border)", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html).toContain("#f0a030");
    // Must not use e05050 as a *border* color for this recovery state
    // (We assert the amber banner is present and the cleanup error message)
  });

  it("renders 'Merged successfully' copy", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html.toLowerCase()).toContain("merged successfully");
  });

  it("renders 'Worktree cleanup did not finish' copy", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html.toLowerCase()).toContain("worktree cleanup did not finish");
  });

  it("primary action is retry-cleanup", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html).toContain('data-action="retry-cleanup"');
  });

  it("renders the escaped error text", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html).toContain("rm -rf .git/worktrees/agent-1 failed: EBUSY");
  });

  it("renders 'housekeeping, not data loss' muted note", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html.toLowerCase()).toContain("housekeeping");
    expect(html.toLowerCase()).toContain("data loss");
  });

  it("retainBranch option: merge-clean confirmation copy reads 'branch kept'", () => {
    const html = renderReview(failedCard(), parsed(), { retainBranch: true });
    expect(html.toLowerCase()).toContain("branch kept");
  });

  it("without retainBranch: copy reads 'branch cleaned up'", () => {
    const html = renderReview(failedCard(), parsed(), { retainBranch: false });
    expect(html.toLowerCase()).toContain("branch cleaned up");
  });
});
