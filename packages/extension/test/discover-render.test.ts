import { describe, expect, it } from "vitest";
import { renderDiscoverTab, renderBrowseDrawer } from "../src/discover-render.js";
import type { DiscoverVM, DiscoverCardVM } from "../src/discover-view.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCard(overrides?: Partial<DiscoverCardVM>): DiscoverCardVM {
  return {
    id: "path/to/agent.yml",
    name: "Test Agent",
    description: "A test agent for testing.",
    sourceBadge: "path/to/agent.yml",
    engineId: "copilot",
    confidence: "verified",
    skillChips: ["read-files", "run-tests"],
    overflowSkills: 0,
    canDispatch: true,
    canAdopt: true,
    isSkill: false,
    ...overrides,
  };
}

function makeMarketplaceCard(): DiscoverCardVM {
  return {
    id: "__marketplace__",
    name: "Browse Marketplace",
    description: "Find more agents and skills in the GitHub Copilot Marketplace.",
    sourceBadge: "Marketplace",
    engineId: "copilot",
    confidence: "verified",
    skillChips: [],
    overflowSkills: 0,
    canDispatch: false,
    canAdopt: false,
    isSkill: false,
  };
}

function makeVM(overrides?: Partial<DiscoverVM>): DiscoverVM {
  return {
    groups: [
      {
        group: "in-repo",
        label: "In this repo",
        count: 1,
        cards: [makeCard()],
      },
      {
        group: "plugins",
        label: "Plugins",
        count: 0,
        cards: [],
      },
      {
        group: "instructions",
        label: "Instructions",
        count: 0,
        cards: [],
      },
      {
        group: "marketplace",
        label: "Marketplace",
        count: 1,
        cards: [makeMarketplaceCard()],
      },
    ],
    scanning: false,
    scanError: undefined,
    ...overrides,
  };
}

function emptyVM(): DiscoverVM {
  return {
    groups: [
      { group: "in-repo", label: "In this repo", count: 0, cards: [] },
      { group: "plugins", label: "Plugins", count: 0, cards: [] },
      { group: "instructions", label: "Instructions", count: 0, cards: [] },
      { group: "marketplace", label: "Marketplace", count: 1, cards: [makeMarketplaceCard()] },
    ],
    scanning: false,
    scanError: undefined,
  };
}

// ─── renderDiscoverTab: adopted state ─────────────────────────────────────────

describe("renderDiscoverTab: adopted state", () => {
  function vmWithCard(card: DiscoverCardVM): DiscoverVM {
    return {
      groups: [
        { group: "in-repo", label: "In this repo", count: 1, cards: [card] },
        { group: "plugins", label: "Plugins", count: 0, cards: [] },
        { group: "instructions", label: "Instructions", count: 0, cards: [] },
        { group: "marketplace", label: "Marketplace", count: 1, cards: [makeMarketplaceCard()] },
      ],
      scanning: false,
    };
  }

  it("a not-yet-adopted card renders an actionable Adopt button", () => {
    const html = renderDiscoverTab(vmWithCard(makeCard({ adopted: false })));
    expect(html).toContain('data-action="adopt-agent"');
    expect(html).toContain(">Adopt</button>");
    expect(html).not.toContain("discover-btn-adopt adopted");
  });

  it("an adopted agent card renders an inert, marked Adopted button", () => {
    const html = renderDiscoverTab(vmWithCard(makeCard({ adopted: true })));
    expect(html).toContain("discover-btn-adopt adopted");
    expect(html).toContain("Adopted");
    expect(html).toContain("disabled");
    // An already-adopted card no longer wires the adopt action.
    expect(html).not.toContain('data-action="adopt-agent"');
  });

  it("an adopted skill card uses the same inert treatment", () => {
    const html = renderDiscoverTab(vmWithCard(makeCard({ isSkill: true, adopted: true })));
    expect(html).toContain("discover-btn-adopt adopted");
    expect(html).not.toContain('data-action="adopt-skill"');
  });
});

// ─── renderDiscoverTab: scanning ──────────────────────────────────────────────

describe("renderDiscoverTab: scanning", () => {
  it("shows discover-scanning indicator when scanning is true", () => {
    const html = renderDiscoverTab(makeVM({ scanning: true }));
    expect(html).toContain("discover-scanning");
  });

  it("scan button is disabled when scanning is true", () => {
    const html = renderDiscoverTab(makeVM({ scanning: true }));
    // The scan-repo button must carry the disabled attribute
    expect(html).toMatch(/discover-scan-btn[^>]*disabled|disabled[^>]*discover-scan-btn/);
  });

  it("does NOT show scanning indicator when scanning is false", () => {
    const html = renderDiscoverTab(makeVM({ scanning: false }));
    expect(html).not.toContain("discover-scanning");
  });

  it("scan button is NOT disabled when not scanning", () => {
    const html = renderDiscoverTab(makeVM({ scanning: false }));
    // The button should not have a disabled attribute
    const btnMatch = html.match(/discover-scan-btn[^>]*/);
    expect(btnMatch).not.toBeNull();
    expect(btnMatch![0]).not.toContain("disabled");
  });
});

// ─── renderDiscoverTab: error banner ──────────────────────────────────────────

describe("renderDiscoverTab: scanError", () => {
  it("shows discover-error banner when scanError is set", () => {
    const html = renderDiscoverTab(makeVM({ scanError: "Scan failed: not a git repo" }));
    expect(html).toContain("discover-error");
  });

  it("shows the escaped error message in the error banner", () => {
    const html = renderDiscoverTab(makeVM({ scanError: "Scan failed: not a git repo" }));
    expect(html).toContain("Scan failed: not a git repo");
  });

  it("escapes HTML in the scanError message", () => {
    const html = renderDiscoverTab(makeVM({ scanError: '<script>alert("xss")</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("does NOT show error banner when scanError is undefined", () => {
    const html = renderDiscoverTab(makeVM({ scanError: undefined }));
    expect(html).not.toContain("discover-error");
  });
});

// ─── renderDiscoverTab: header / scan button ──────────────────────────────────

describe("renderDiscoverTab: scan-repo button", () => {
  it("shows a button with data-action='scan-repo'", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain('data-action="scan-repo"');
  });

  it("renders the scan-repo button with class discover-scan-btn", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain("discover-scan-btn");
  });
});

// ─── renderDiscoverTab: filter chips ─────────────────────────────────────────

describe("renderDiscoverTab: filter chips", () => {
  it("shows four filter chips: All, In this repo, Plugins, Marketplace", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain("All");
    expect(html).toContain("In this repo");
    expect(html).toContain("Plugins");
    expect(html).toContain("Marketplace");
  });

  it("All chip has data-chip='all'", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain('data-chip="all"');
  });

  it("In-this-repo chip has data-chip='in-repo'", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain('data-chip="in-repo"');
  });

  it("Plugins chip has data-chip='plugins'", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain('data-chip="plugins"');
  });

  it("Marketplace chip has class 'dimmed'", () => {
    const html = renderDiscoverTab(makeVM());
    // The chip for Marketplace should include "dimmed"
    expect(html).toContain("dimmed");
  });

  it("Marketplace chip does NOT have a data-chip attribute", () => {
    const html = renderDiscoverTab(makeVM());
    // Find the Marketplace chip region and confirm it has no data-chip
    // We look for buttons near "Marketplace" text that do NOT have data-chip
    const marketplaceChipMatch = html.match(/discover-chip[^>]*dimmed[^>]*>[^<]*Marketplace|discover-chip[^>]*>[^<]*Marketplace[^<]*<\/button/);
    if (marketplaceChipMatch) {
      expect(marketplaceChipMatch[0]).not.toContain("data-chip");
    } else {
      // Look for any button containing Marketplace text without data-chip
      const allButtons = html.match(/<button[^>]*>[^<]*Marketplace[^<]*<\/button>/g) ?? [];
      // At least one Marketplace button that is a chip
      const chipButtons = allButtons.filter((b) => b.includes("discover-chip"));
      expect(chipButtons.length).toBeGreaterThan(0);
      for (const btn of chipButtons) {
        expect(btn).not.toContain("data-chip");
      }
    }
  });

  it("renders a text filter input with data-action='discover-filter'", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain('data-action="discover-filter"');
    expect(html).toContain("discover-filter");
  });

  it("shows live counts on the All / In this repo / Plugins chips", () => {
    // makeVM has 1 in-repo card, 0 plugins, 0 instructions -> All=1, repo=1, plugins=0.
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain("discover-chip-count");
    // All chip count = sum of real groups = 1
    expect(html).toMatch(/All\s*<span class="discover-chip-count">1<\/span>/);
    // In this repo = 1
    expect(html).toMatch(/In this repo\s*<span class="discover-chip-count">1<\/span>/);
    // Plugins = 0
    expect(html).toMatch(/Plugins\s*<span class="discover-chip-count">0<\/span>/);
  });

  it("All chip count is the sum across in-repo + plugins + instructions", () => {
    const vm = makeVM({
      groups: [
        { group: "in-repo", label: "In this repo", count: 2, cards: [makeCard(), makeCard({ id: "x" })] },
        { group: "plugins", label: "Plugins", count: 1, cards: [makeCard({ id: "p" })] },
        { group: "instructions", label: "Instructions", count: 1, cards: [makeCard({ id: "i" })] },
        { group: "marketplace", label: "Marketplace", count: 1, cards: [makeMarketplaceCard()] },
      ],
    });
    const html = renderDiscoverTab(vm);
    expect(html).toMatch(/All\s*<span class="discover-chip-count">4<\/span>/);
    expect(html).toMatch(/Plugins\s*<span class="discover-chip-count">1<\/span>/);
  });

  it("does NOT render a count on the dimmed Marketplace chip", () => {
    const html = renderDiscoverTab(makeVM());
    // The Marketplace chip is dimmed and carries no count span / data-chip.
    const chipMatch = html.match(/<button class="discover-chip dimmed"[^>]*>[^<]*Marketplace[^<]*<\/button>/);
    expect(chipMatch).not.toBeNull();
    expect(chipMatch![0]).not.toContain("discover-chip-count");
  });
});

// ─── renderDiscoverTab: Adopt button treatment ───────────────────────────────

describe("renderDiscoverTab: Adopt button", () => {
  it("Adopt uses the discover-btn-adopt class (bordered secondary by default)", () => {
    const card = makeCard({ canAdopt: true, isSkill: false });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    // Adopt carries the shared bordered .discover-btn base plus .discover-btn-adopt.
    expect(html).toMatch(/class="discover-btn discover-btn-adopt"/);
    // The green check is present in markup but hidden until the .adopted state.
    expect(html).toContain("discover-adopt-check");
  });
});

// ─── renderDiscoverTab: scanned-at label ─────────────────────────────────────

describe("renderDiscoverTab: scanned-at", () => {
  it("falls back to 'Scanned just now' when the VM carries no scannedAt", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain("Scanned just now");
  });

  it("uses a real scannedAt value from the VM when present", () => {
    const vm = makeVM() as DiscoverVM & { scannedAt?: string };
    vm.scannedAt = "2 minutes ago";
    const html = renderDiscoverTab(vm);
    expect(html).toContain("Scanned 2 minutes ago");
    expect(html).not.toContain("Scanned just now");
  });

  it("escapes a hostile scannedAt value", () => {
    const vm = makeVM() as DiscoverVM & { scannedAt?: string };
    vm.scannedAt = "<script>x</script>";
    const html = renderDiscoverTab(vm);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── renderDiscoverTab: card confidence indicators ────────────────────────────

describe("renderDiscoverTab: verified card", () => {
  it("has confidence-verified class for a verified card", () => {
    const card = makeCard({ confidence: "verified", canDispatch: true, canAdopt: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{
        group: "in-repo", label: "In this repo", count: 1, cards: [card],
      }],
    }));
    expect(html).toContain("confidence-verified");
  });

  it("has Adopt button for a verified card with canAdopt=true", () => {
    const card = makeCard({ confidence: "verified", canAdopt: true, isSkill: false });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).toContain('data-action="adopt-agent"');
  });

  it("has Dispatch button for a verified card with canDispatch=true", () => {
    const card = makeCard({ confidence: "verified", canDispatch: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).toContain('data-action="discover-dispatch"');
  });
});

describe("renderDiscoverTab: likely card", () => {
  it("has confidence-likely class for a likely card", () => {
    const card = makeCard({ confidence: "likely", canDispatch: false, canAdopt: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).toContain("confidence-likely");
  });

  it("has Adopt button for a likely card with canAdopt=true", () => {
    const card = makeCard({ confidence: "likely", canDispatch: false, canAdopt: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    // Adopt action present (adopt-agent or adopt-skill)
    expect(html).toMatch(/data-action="adopt-(agent|skill)"/);
  });

  it("does NOT have Dispatch button for a likely card with canDispatch=false", () => {
    const card = makeCard({ confidence: "likely", canDispatch: false, canAdopt: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain('data-action="discover-dispatch"');
  });
});

describe("renderDiscoverTab: instructions card", () => {
  it("has confidence-instructions class for an instructions card", () => {
    const card = makeCard({ confidence: "instructions", canDispatch: false, canAdopt: false });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "instructions", label: "Instructions", count: 1, cards: [card] }],
    }));
    expect(html).toContain("confidence-instructions");
  });

  it("does NOT have Adopt button for an instructions card with canAdopt=false", () => {
    const card = makeCard({ confidence: "instructions", canDispatch: false, canAdopt: false });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "instructions", label: "Instructions", count: 1, cards: [card] }],
    }));
    expect(html).not.toMatch(/data-action="adopt-(agent|skill)"/);
  });
});

// ─── renderDiscoverTab: overflow chips ────────────────────────────────────────

describe("renderDiscoverTab: skill chip overflow", () => {
  it("shows at most 4 chips and a '+1 more' span when 5 chips provided", () => {
    const card = makeCard({
      skillChips: ["a", "b", "c", "d"],
      overflowSkills: 1,
    });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    // All 4 explicit chips are shown
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
    expect(html).toContain(">c<");
    expect(html).toContain(">d<");
    // Overflow span
    expect(html).toContain("discover-overflow");
    expect(html).toContain("+1 more");
  });

  it("does NOT show overflow span when overflowSkills is 0", () => {
    const card = makeCard({ skillChips: ["a", "b"], overflowSkills: 0 });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain("discover-overflow");
  });
});

// ─── renderDiscoverTab: XSS escaping ─────────────────────────────────────────

describe("renderDiscoverTab: XSS escaping", () => {
  it("escapes a hostile name with <img onerror>", () => {
    const card = makeCard({ name: '<img onerror="alert(1)" src="x">' });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain('<img onerror');
    expect(html).toContain("&lt;img");
  });

  it("escapes HTML in description", () => {
    const card = makeCard({ description: '<script>evil()</script>' });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in sourceBadge", () => {
    const card = makeCard({ sourceBadge: '<b>evil</b>' });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain('<b>evil</b>');
    expect(html).toContain("&lt;b&gt;");
  });

  it("escapes HTML in skill chips", () => {
    const card = makeCard({ skillChips: ['<script>x</script>'] });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in card id used as data-item-id", () => {
    const card = makeCard({ id: '"><script>alert(1)</script>' });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── renderDiscoverTab: marketplace card ─────────────────────────────────────

describe("renderDiscoverTab: marketplace card", () => {
  it("renders the marketplace card with class discover-card-marketplace", () => {
    const html = renderDiscoverTab(makeVM());
    expect(html).toContain("discover-card-marketplace");
  });

  it("marketplace card does NOT have action buttons", () => {
    const html = renderDiscoverTab(makeVM());
    // The marketplace card should not have Dispatch/Adopt/Browse buttons
    // We look for the card section itself
    const cardStart = html.indexOf("discover-card-marketplace");
    const cardEnd = html.indexOf("</article>", cardStart);
    const cardHtml = html.slice(cardStart, cardEnd);
    expect(cardHtml).not.toContain('data-action="browse-source"');
    expect(cardHtml).not.toContain('data-action="discover-dispatch"');
    expect(cardHtml).not.toMatch(/data-action="adopt-(agent|skill)"/);
  });
});

// ─── renderDiscoverTab: empty VM ─────────────────────────────────────────────

describe("renderDiscoverTab: empty VM", () => {
  it("renders without crashing when there are no real items", () => {
    expect(() => renderDiscoverTab(emptyVM())).not.toThrow();
  });

  it("shows the filter area even when no items are present", () => {
    const html = renderDiscoverTab(emptyVM());
    expect(html).toContain('data-action="scan-repo"');
    expect(html).toContain('data-action="discover-filter"');
    expect(html).toContain('data-chip="all"');
  });

  it("still renders the marketplace card in an empty VM", () => {
    const html = renderDiscoverTab(emptyVM());
    expect(html).toContain("discover-card-marketplace");
  });
});

// ─── renderBrowseDrawer ───────────────────────────────────────────────────────

describe("renderBrowseDrawer", () => {
  it("shows the escaped card name in the drawer title", () => {
    const card = makeCard({ name: "My Test Agent" });
    const html = renderBrowseDrawer(card);
    expect(html).toContain("My Test Agent");
    expect(html).toContain("browse-title");
  });

  it("shows the escaped sourceBadge in the drawer", () => {
    const card = makeCard({ sourceBadge: "path/to/agent.yml" });
    const html = renderBrowseDrawer(card);
    expect(html).toContain("path/to/agent.yml");
    expect(html).toContain("browse-source-path");
  });

  it("shows the escaped description in the drawer", () => {
    const card = makeCard({ description: "Runs all unit tests" });
    const html = renderBrowseDrawer(card);
    expect(html).toContain("Runs all unit tests");
    expect(html).toContain("browse-desc");
  });

  it("shows skill chips in the drawer when present", () => {
    const card = makeCard({ skillChips: ["read-files", "run-tests"] });
    const html = renderBrowseDrawer(card);
    expect(html).toContain("read-files");
    expect(html).toContain("run-tests");
  });

  it("shows 'None declared' when skillChips is empty", () => {
    const card = makeCard({ skillChips: [], overflowSkills: 0 });
    const html = renderBrowseDrawer(card);
    expect(html).toContain("None declared");
  });

  it("escapes hostile name in browse drawer", () => {
    const card = makeCard({ name: '<img onerror="alert(1)">' });
    const html = renderBrowseDrawer(card);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain("&lt;img");
  });

  it("escapes hostile sourceBadge in browse drawer", () => {
    const card = makeCard({ sourceBadge: '<script>bad()</script>' });
    const html = renderBrowseDrawer(card);
    expect(html).not.toContain('<script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the browse-drawer wrapper element", () => {
    const card = makeCard();
    const html = renderBrowseDrawer(card);
    expect(html).toContain("browse-drawer");
  });
});

// ─── renderDiscoverTab: adopt-skill vs adopt-agent ────────────────────────────

describe("renderDiscoverTab: adopt action type", () => {
  it("uses adopt-skill data-action for a skill card (isSkill=true)", () => {
    const card = makeCard({ isSkill: true, canAdopt: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).toContain('data-action="adopt-skill"');
  });

  it("uses adopt-agent data-action for a non-skill card (isSkill=false)", () => {
    const card = makeCard({ isSkill: false, canAdopt: true });
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).toContain('data-action="adopt-agent"');
  });
});

// ─── renderDiscoverTab: browse button ────────────────────────────────────────

describe("renderDiscoverTab: browse button", () => {
  it("every non-marketplace card has a Browse button with data-action='browse-source'", () => {
    const card = makeCard();
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [card] }],
    }));
    expect(html).toContain('data-action="browse-source"');
  });
});

// ─── renderDiscoverTab: empty state ───────────────────────────────────────────

describe("renderDiscoverTab: empty state", () => {
  it("renders a helpful empty state when no real (non-marketplace) cards exist", () => {
    const html = renderDiscoverTab(emptyVM());
    expect(html).toContain('class="discover-empty"');
    expect(html).toContain("Scan repo");
  });

  it("does NOT render the empty state when a real card is present", () => {
    const html = renderDiscoverTab(makeVM({
      groups: [{ group: "in-repo", label: "In this repo", count: 1, cards: [makeCard()] }],
    }));
    expect(html).not.toContain('class="discover-empty"');
  });
});
