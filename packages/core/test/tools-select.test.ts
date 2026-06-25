import { describe, it, expect } from "vitest";
import { countGrants, renderToolsForPreamble } from "../src/tools-select.js";
import type { ToolGrant } from "../src/types.js";

describe("countGrants", () => {
  it("undefined -> { granted: 0, canWrite: 0 }", () => {
    expect(countGrants(undefined)).toEqual({ granted: 0, canWrite: 0 });
  });

  it("read-only builtins [Read, Search] -> { granted: 2, canWrite: 0 } (write OFF by default)", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read", "Search"] },
    };
    expect(countGrants(grant)).toEqual({ granted: 2, canWrite: 0 });
  });

  it("read [Read] + write [Git] -> { granted: 2, canWrite: 1 }", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read"], write: ["Git"] },
    };
    expect(countGrants(grant)).toEqual({ granted: 2, canWrite: 1 });
  });

  it("mcp [{ server: sec-kit, read: true, write: true }] -> { granted: 1, canWrite: 1 }", () => {
    const grant: ToolGrant = {
      mcp: [{ server: "sec-kit", read: true, write: true }],
    };
    expect(countGrants(grant)).toEqual({ granted: 1, canWrite: 1 });
  });

  it("mcp entry without read or write does not count as granted", () => {
    const grant: ToolGrant = {
      mcp: [{ server: "unused" }],
    };
    expect(countGrants(grant)).toEqual({ granted: 0, canWrite: 0 });
  });

  it("mcp read-only entry -> { granted: 1, canWrite: 0 }", () => {
    const grant: ToolGrant = {
      mcp: [{ server: "docs-kit", read: true }],
    };
    expect(countGrants(grant)).toEqual({ granted: 1, canWrite: 0 });
  });

  it("mixed builtins + mcp totals correctly", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read", "Search"], write: ["Edit", "Git"] },
      mcp: [
        { server: "sec-kit", read: true, write: true },
        { server: "docs-kit", read: true },
      ],
    };
    // builtins: 4 unique (Read, Search, Edit, Git); mcp: 2 with read or write
    expect(countGrants(grant)).toEqual({ granted: 6, canWrite: 3 });
  });

  it("overlapping read/write builtin only counts once in granted", () => {
    // Edit appears in write; Read appears in read; no overlap here
    const grant: ToolGrant = {
      builtins: { read: ["Read"], write: ["Edit"] },
    };
    expect(countGrants(grant)).toEqual({ granted: 2, canWrite: 1 });
  });
});

describe("renderToolsForPreamble", () => {
  it("undefined -> empty string", () => {
    expect(renderToolsForPreamble(undefined)).toBe("");
  });

  it("read [Read] + write [Git] -> mentions both, Git tagged (write)", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read"], write: ["Git"] },
    };
    const out = renderToolsForPreamble(grant);
    expect(out).toContain("Read");
    expect(out).toContain("Git");
    expect(out).toContain("(write)");
  });

  it("read-only builtins do NOT get (write) tag", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read", "Search"] },
    };
    const out = renderToolsForPreamble(grant);
    expect(out).not.toContain("(write)");
    expect(out).toContain("Read");
    expect(out).toContain("Search");
  });

  it("mcp read-only entry is rendered without (write) tag", () => {
    const grant: ToolGrant = {
      mcp: [{ server: "docs-kit", read: true }],
    };
    const out = renderToolsForPreamble(grant);
    expect(out).toContain("docs-kit");
    expect(out).not.toContain("(write)");
  });

  it("mcp write entry is rendered with (write) tag", () => {
    const grant: ToolGrant = {
      mcp: [{ server: "sec-kit", write: true }],
    };
    const out = renderToolsForPreamble(grant);
    expect(out).toContain("sec-kit");
    expect(out).toContain("(write)");
  });

  it("empty grant -> empty string", () => {
    const grant: ToolGrant = {};
    expect(renderToolsForPreamble(grant)).toBe("");
  });
});
