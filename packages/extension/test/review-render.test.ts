import { describe, it, expect } from "vitest";
import { renderReview } from "../src/review-render.js";
import type { CardVM } from "@hallucinate/cockpit";
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

  it("header renders a Back-to-board button so the user is never stranded", () => {
    // Regression: the full review replaces the whole board, so it MUST carry its
    // own escape. The webview wires data-action="review-close" to backToBoard().
    const html = renderReview(card(), parsed());
    expect(html).toContain('data-action="review-close"');
    expect(html).toContain("Board");
    expect(html).toContain('class="rv-back"');
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

  it("renders a 'Changed files' rail eyebrow (prototype left region)", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("rv-rail");
    expect(html).toContain("Changed files");
  });

  it("file rows carry a data-path hook for selection", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain('data-path="src/auth.ts"');
  });

  it("renders a 'What changed' band that names the role when a summary is present", () => {
    const html = renderReview(card({ summary: "Added auth route" }), parsed());
    expect(html).toContain("What changed");
    // role appears in the band heading "What changed · <role>"
    expect(html).toContain("Implementer");
  });

  it("renders a mono file-path header above the diff", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain("rv-path-header");
    expect(html).toContain("rv-path-text");
  });

  it("merge primary button is green-tinted (prototype Merge into main)", () => {
    const html = renderReview(card(), parsed());
    // green primary uses the rgb form of #46c98a (70,201,138)
    expect(html).toContain("rgba(70,201,138");
    expect(html).toContain("Merge into main");
  });

  it("contains graphite palette hex values and NOT var(--vscode-*)", () => {
    const html = renderReview(card(), parsed());
    // Accent blue (focus rings) + the canonical TOKENS diff-add green for added
    // lines (#7fd9a8). The earlier off-token greens/blue must be gone.
    expect(html).toContain("#8ab8ff");
    expect(html).toContain("#7fd9a8");
    expect(html).not.toContain("var(--vscode-");
    // Off-token accents from earlier passes must not survive.
    expect(html).not.toContain("#84dcab");
    expect(html).not.toContain("#5fcf9a");
    expect(html).not.toContain("#7fa8d8");
  });

  it("decision bar has merge, discard, and sendBack data-action attributes", () => {
    const html = renderReview(card(), parsed());
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
    expect(html).toContain('data-action="sendBack"');
  });

  it("the review decision bar does NOT contain an Approve button", () => {
    // The soft "Approve" sign-off was a local acknowledgment with no backing
    // orchestrator action, so it was removed. It must not appear anywhere on the
    // review screen (the M6 tool-approval Approve lives elsewhere, in render.ts).
    const html = renderReview(card(), parsed());
    expect(html).not.toContain('data-action="approve"');
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain("rv-btn-approve");
  });

  it("renders the brand eq mark before the WHAT CHANGED eyebrow", () => {
    const html = renderReview(card({ summary: "Added auth route" }), parsed());
    // The four-bar equalizer brand mark (prototype review.eq, line 1046).
    expect(html).toContain("rv-eq-mark");
    // It sits in the what-changed head row, ahead of the eyebrow.
    expect(html).toContain("rv-whatchanged-head");
    const headIdx = html.indexOf("rv-whatchanged-head");
    const eyebrowIdx = html.indexOf("What changed");
    const markIdx = html.indexOf("rv-eq-mark");
    expect(markIdx).toBeGreaterThan(headIdx);
    expect(markIdx).toBeLessThan(eyebrowIdx);
  });

  it("decision bar buttons carry the card id", () => {
    const html = renderReview(card({ id: "xyz-99" }), parsed());
    expect(html).toContain('data-id="xyz-99"');
  });

  it("decision footer contains the feedback textarea (footer-contains-textarea contract)", () => {
    const html = renderReview(card(), parsed());
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(footer).toContain("<textarea");
    expect(footer).toContain('data-role="feedback"');
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

  it("renders amber #e2b35a banner", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("#e2b35a");
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

  it("renders the prototype conflict control bar with Keep ours / Keep theirs / Edit", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("rv-conflict-bar");
    expect(html).toContain("Keep ours");
    expect(html).toContain("Keep theirs");
    expect(html).toContain('data-action="keep-ours"');
    expect(html).toContain('data-action="keep-theirs"');
  });

  it("conflict primary action label reads 'Resolve and merge'", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    expect(html).toContain("Resolve and merge");
  });

  it("conflict decision bar drops the extra 'Resolve in Editor' button (prototype 1107)", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    // The footer aligns to the prototype: no "Resolve in Editor" secondary button.
    expect(footer).not.toContain("Resolve in Editor");
    // The resolve-conflict hand-off still lives in the conflict control bar (Edit).
    expect(html).toContain('data-action="resolve-conflict"');
  });

  it("conflict decision bar contains NO Approve button", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(footer).not.toContain('data-action="approve"');
    expect(footer).not.toContain(">Approve<");
    // The conflict primary (Resolve and merge) is unaffected.
    expect(footer).toContain('data-action="finish-merge"');
  });

  it("decision footer contains the feedback textarea for sendBack (review-main contract)", () => {
    const html = renderReview(conflictCard(), conflictParsed());
    // footer.querySelector("textarea") must find a textarea inside the <footer>.
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(footer).toContain('data-role="feedback"');
    expect(footer).toContain("<textarea");
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

  it("PR mode pill uses muted color #83838b", () => {
    const html = renderReview(card(), parsed(), { prMode: true });
    expect(html).toContain("#83838b");
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

  it("renders amber #e2b35a recovery banner (NOT salmon #f0848c border)", () => {
    const html = renderReview(failedCard(), parsed());
    expect(html).toContain("#e2b35a");
    // Must not use the danger salmon as a *border* color for this recovery state
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

describe("renderReview — status-aware decision bar", () => {
  it("a stopped run offers Resume + Discard, never Merge", () => {
    const html = renderReview(card({ state: "stopped" }), parsed());
    expect(html).toContain('data-action="resume"');
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });

  it("an errored run offers Discard only, never Merge", () => {
    const html = renderReview(card({ state: "error", error: "boom" }), parsed());
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });

  it("an errored run renders its error text in the body (not a blank panel)", () => {
    const html = renderReview(card({ state: "error", error: "spawn ENOENT" }), parsed());
    expect(html).toContain("spawn ENOENT");
  });

  it("escapes the error text in the errored-run body", () => {
    const html = renderReview(card({ state: "error", error: "<img src=x onerror=alert(1)>" }), parsed());
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("a done run with an EMPTY diff (no changes) disables the Merge button", () => {
    const html = renderReview(card({ id: "agent-1", state: "done", diff: { files: [], patch: "" } }), parsed());
    expect(html).toContain('data-action="merge" data-id="agent-1" disabled');
  });

  it("a done run WITH a diff keeps Merge enabled", () => {
    const html = renderReview(
      card({ id: "agent-1", state: "done", diff: { files: ["a.ts"], patch: "P" } }),
      parsed(),
    );
    expect(html).toContain('data-action="merge" data-id="agent-1"');
    expect(html).not.toContain('data-action="merge" data-id="agent-1" disabled');
  });
});

// ─── No file changes: honest diff region ─────────────────────────────────────

describe("renderReview — no file changes", () => {
  it("a done run with zero changed files says 'No file changes' in the body", () => {
    const html = renderReview(
      card({ state: "done", diff: { files: [], patch: "" } }),
      parsed({ files: [], stat: { adds: 0, dels: 0 } }),
    );
    expect(html).toContain("No file changes");
  });

  it("a done run with zero changed files does NOT render a misleading '+0 -0' stat", () => {
    const html = renderReview(
      card({ state: "done", diff: { files: [], patch: "" } }),
      parsed({ files: [], stat: { adds: 0, dels: 0 } }),
    );
    expect(html).not.toContain("+0 -0");
    expect(html).not.toContain("+0 &minus;0");
  });

  it("still renders the agent summary alongside the 'No file changes' notice", () => {
    const html = renderReview(
      card({ state: "done", summary: "Said hello in chat", diff: { files: [], patch: "" } }),
      parsed({ files: [], stat: { adds: 0, dels: 0 } }),
    );
    expect(html).toContain("No file changes");
    expect(html).toContain("Said hello in chat");
  });
});
