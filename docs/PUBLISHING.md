# Publishing Maestro to the Visual Studio Marketplace

This is the tailored, step-by-step guide for shipping **this** extension
(`packages/extension`, published as `prixio.maestro`) from this pnpm workspace
monorepo to the Visual Studio Marketplace.

Verified against the official VS Code docs
(`code.visualstudio.com/api/working-with-extensions/publishing-extension`) and
the `@vscode/vsce` CLI as of June 2026.

Facts about this extension (from `packages/extension/package.json`):

- `name`: `maestro`
- `displayName`: `Maestro`
- `publisher`: `prixio`  (so the Marketplace item id will be `prixio.maestro`)
- `version`: `0.1.10`
- `engines.vscode`: `^1.90.0`
- `main`: `./dist/extension.js`  (esbuild bundle)
- `repository` / `homepage` / `bugs`: `github.com/norequest/maestro-vscode`
- Internal deps `@maestro/* : workspace:*` are **bundled by esbuild**, which is
  why packaging uses `--no-dependencies` (see section 4).

> Important context: the build is `node build.mjs`. esbuild bundles BOTH the
> extension host (`dist/extension.js`, CJS, `vscode` external) and the webview
> client (`dist/webview/*`) into `dist/`. `tsc` is typecheck-only and emits
> nothing. So the only runtime artifact that ships is `dist/`, and every
> `@maestro/*` workspace package is inlined into the bundle. vsce never needs
> to (and must not) resolve those workspace deps.

---

## 0. TL;DR (once setup is done)

```bash
# from the repo root
pnpm install
pnpm -r build                      # builds the 6 @maestro/* libs + this extension's dist/

cd packages/extension
npx @vscode/vsce package --no-dependencies   # -> maestro-<version>.vsix (sanity check)
npx @vscode/vsce publish --no-dependencies   # publishes current version
# or bump + publish in one shot:
# npx @vscode/vsce publish patch --no-dependencies
```

That `publish` only works after the one-time publisher + PAT setup below, and
after you fix the BLOCKING gaps in section 3 (a real PNG `"icon"`).

---

## 1. One-time publisher setup (`prixio`)

You do this once per Marketplace publisher, not per release.

### 1a. Azure DevOps organization

The Marketplace authenticates publishers through Azure DevOps. You need an
Azure DevOps organization tied to a Microsoft account (Entra ID or a personal
Microsoft account both work).

1. Sign in at `https://dev.azure.com` with the Microsoft account you want to
   own the `prixio` publisher.
2. If you have no organization yet, create one (any name; the org name is
   unrelated to the `prixio` publisher id, it is only the PAT's home).

### 1b. Create the Marketplace publisher `prixio`

1. Go to the Marketplace management portal: `https://marketplace.visualstudio.com/manage`
2. Sign in with the same Microsoft account.
3. Click **Create publisher**.
4. Set the publisher **ID** to exactly `prixio`.

   This is load-bearing: the publisher id MUST equal the `"publisher"` field in
   `packages/extension/package.json` (`"publisher": "prixio"`). If they differ,
   `vsce publish` is rejected. Do not change one without the other.
5. Set a display **Name** (for example `Prixio`) and save.

### 1c. Create a Personal Access Token (PAT)

The PAT is what `vsce` uses to authenticate as the publisher. Create it in
Azure DevOps, NOT in the Marketplace portal.

1. Open `https://dev.azure.com`, click your avatar (top right), then
   **Personal access tokens**.
2. Click **+ New Token** and configure exactly:
   - **Name**: something memorable, for example `vsce-maestro`.
   - **Organization**: select **All accessible organizations**. (A token scoped
     to a single org will fail to publish; the Marketplace lives outside any one
     org.)
   - **Expiration**: pick a date. Max selectable is typically 1 year. Shorter is
     safer; you will re-issue when it expires. Record the expiry somewhere.
   - **Scopes**: click **Show all scopes**, find **Marketplace**, and check
     **Manage** (this grants acquire + publish + manage). Nothing else is needed.
3. Click **Create** and COPY the token now. It is shown once. Treat it like a
   password: never commit it, never paste it into the repo.

> Heads-up (future-proofing): Microsoft has announced that long-lived global
> Azure DevOps PATs are being retired (target Dec 1, 2026) in favor of workload
> identity federation / managed identities for automation. PATs still work today
> and are the simplest path for a manual first publish. For CI, prefer the
> federated approach when it is available to you; the PAT-secret recipe in
> section 6 remains the documented fallback.

### 1d. Log in `vsce` as the publisher

You can either log in once (vsce caches the credential) or pass the PAT per
command.

```bash
# interactive: paste the PAT when prompted
npx @vscode/vsce login prixio
```

Or skip login entirely and pass the PAT inline on each publish (good for CI):

```bash
npx @vscode/vsce publish --no-dependencies -p "<YOUR_PAT>"
```

`-p` is the short form of `--pat`. The same flag works on `package` and `login`.

---

## 2. Install the tooling

The CLI was renamed from `vsce` to `@vscode/vsce`. The old `vsce` package is
deprecated; always use the scoped name.

Global install:

```bash
npm i -g @vscode/vsce
vsce --version
```

Or run it ad hoc without installing (what this guide mostly uses, since the repo
already pins nothing globally):

```bash
npx @vscode/vsce --version
```

Either form is fine. Examples below use `npx @vscode/vsce ...`; if you installed
globally you can drop the `npx ` and the `@vscode/` and just type `vsce ...`.

---

## 3. Pre-publish checklist (verified against this repo)

Ready vs missing, checked against `packages/extension/package.json` and the tree
on disk.

### READY

- `name` = `maestro`, `displayName` = `Maestro`. Good.
- `description` = "Conduct a team of AI coding agents in isolated git
  worktrees." Present and meaningful. Good.
- `version` = `0.1.10`. Valid semver. See the pre-1.0 note below.
- `publisher` = `prixio`. Matches the publisher you create in section 1. Good.
- `engines.vscode` = `^1.90.0`. Present. Good.
- `categories` = `["Other", "AI", "Machine Learning"]`. Present. (`"AI"` is a
  real Marketplace category; `"Machine Learning"` and `"Other"` are valid too.)
- `keywords` = ai, agents, github-copilot, coding-agent, orchestration,
  git-worktree, acp, multi-agent. Present and relevant (max 5 are shown as tags
  on the Marketplace, but listing more is harmless).
- `repository`, `homepage`, `bugs` all point at
  `github.com/norequest/maestro-vscode`. Present. The `repository` field also
  unlocks vsce's relative-link rewriting (see the README gotcha).
- `LICENSE` exists at both repo root and `packages/extension/LICENSE` (MIT). vsce
  picks up the one in the package dir and shows it on the listing. Good.
- `README.md` exists at `packages/extension/README.md`. vsce uses the package's
  README as the Marketplace overview. Present. (Consider enriching it before
  launch; it is currently a short dev-focused readme. Not blocking.)
- `.vscodeignore` excludes `src/`, `test/`, `integration/`, `out/`, `.vscode/`,
  maps, and `node_modules/`. Good: the VSIX will ship `dist/` + `media/` +
  `package.json` + `README` + `LICENSE`, not source.

### MISSING / BLOCKING

1. **No top-level `"icon"` field, and no raster PNG to point it at. BLOCKING for
   a polished listing.**

   - The only icon in the repo is `packages/extension/media/maestro.svg`. That
     SVG is correctly used for the activity-bar view container
     (`contributes.viewsContainers.activitybar[].icon`), and SVG is fine THERE.
   - But the Marketplace **listing** icon (the square shown in search results
     and on the item page) is a different thing: it is the top-level
     `package.json` `"icon"` field, and the Marketplace **rejects SVG** for it.
     It must be a **raster PNG, at least 128x128** (256x256 recommended for
     crispness on HiDPI).
   - Right now there is no `"icon"` key at all, so the extension would publish
     with a generic default tile. To fix:

     1. Export a square PNG (>= 128x128, ideally 256x256) of the Maestro mark.
        Put it at `packages/extension/media/icon.png`.
     2. Add the field to `packages/extension/package.json` (top level, sibling of
        `"main"`):

        ```json
        "icon": "media/icon.png",
        ```

     3. Re-package and confirm the tile renders (section 4 / section 5).

   Keep the existing `media/maestro.svg` for the activity bar; just ADD the PNG
   and the `"icon"` field. The two do not conflict.

2. **No `CHANGELOG.md`. Recommended (not strictly blocking).**

   - There is no `CHANGELOG.md` at the repo root or in `packages/extension/`.
   - When present, the Marketplace renders it on a dedicated **Changelog** tab of
     the listing. Without one, the tab is simply absent.
   - Fix: add `packages/extension/CHANGELOG.md` (Keep a Changelog format is
     conventional). At minimum, an entry for `0.1.10`. It does not block the
     first publish, but it is cheap polish and users expect it.

### NOTES / GOTCHAS (not blocking, but read these)

- **README relative-image gotcha.** Relative image paths in the README may not
  render on the Marketplace. vsce rewrites SOME relative links to absolute ones
  using the `repository` URL (which this repo has set), but it only does this
  reliably for standard cases, and the rewrite assumes the `main`/`master`
  branch. The safe move: use absolute `https://` raw URLs for any images you
  embed, for example:

  ```markdown
  ![Maestro](https://raw.githubusercontent.com/norequest/maestro-vscode/main/packages/extension/media/screenshot.png)
  ```

  Badges and screenshots especially should be absolute. The current README has
  no images, so nothing breaks today; this matters the moment you add one.

- **Pre-1.0 version is fine.** `0.1.10` publishes normally. The Marketplace
  treats it as ordinary semver; there is no "must be >= 1.0.0" rule. (VS Code
  does not support semver pre-release tags like `-beta` in the version itself;
  use plain `x.y.z`. Marketplace "pre-release" is a separate `--pre-release`
  flag, not needed here.)

- **A stale VSIX is sitting in the package dir.** `packages/extension/maestro-0.1.10.vsix`
  already exists from an earlier `vsce package` run. Re-running `package`
  overwrites it. It is gitignored-territory; do not commit VSIX artifacts.

---

## 4. Publish commands for THIS monorepo

All publish/package commands run **from `packages/extension`** (the extension's
own directory), because vsce operates on the package whose `package.json` it
finds in the current directory.

Always build first, from the repo root, so `dist/` is fresh and the `@maestro/*`
libs they depend on are built:

```bash
# repo root
pnpm install
pnpm -r build
```

Then:

```bash
cd packages/extension

# 1) Package to a .vsix and inspect what ships (does NOT publish):
npx @vscode/vsce package --no-dependencies
#    -> produces maestro-<version>.vsix in this directory.
#    Open it (or `npx @vscode/vsce ls --no-dependencies`) to confirm dist/,
#    media/, README, LICENSE, package.json are present and src/ is NOT.

# 2) Publish the CURRENT version (0.1.10) as-is:
npx @vscode/vsce publish --no-dependencies

# Version-bumping variants (these edit package.json version, git-tag if in a
# repo, then publish):
npx @vscode/vsce publish patch --no-dependencies   # 0.1.10 -> 0.1.11
npx @vscode/vsce publish minor --no-dependencies   # 0.1.10 -> 0.2.0
npx @vscode/vsce publish major --no-dependencies   # 0.1.10 -> 1.0.0
npx @vscode/vsce publish 0.2.3 --no-dependencies   # set an exact version
```

Add `-p "<PAT>"` to any of these if you did not run `vsce login prixio`.

### Why `--no-dependencies` is mandatory here

This is a **pnpm workspace** monorepo, and the extension's runtime deps are all
`@maestro/* : workspace:*`. esbuild has already **bundled** every one of those
into `dist/extension.js` (and the webview into `dist/webview/`). The `dist/`
bundle is fully self-contained.

Without `--no-dependencies`, vsce tries to walk and resolve the dependency tree
to decide what `node_modules` to ship. With pnpm workspaces it will choke on the
`workspace:*` protocol and the symlinked `node_modules` layout (vsce has no
first-class pnpm support), and it would also try to ship `node_modules` you do
not need. `--no-dependencies` tells vsce: "do not touch dependencies, the bundle
already contains everything." That is exactly correct for a bundled extension.

> The bundling itself is not triggered by a `vscode:prepublish` script in this
> repo (there is none). So you MUST run `pnpm -r build` yourself before
> packaging/publishing, otherwise `dist/` may be stale or missing. If you want
> vsce to guarantee a fresh build, you can add to `packages/extension/package.json`:
> `"scripts": { "vscode:prepublish": "node build.mjs" }`. Note that runs
> only the extension's own esbuild, not the upstream `@maestro/*` lib builds, so
> `pnpm -r build` from root is still the reliable pre-step.

---

## 5. Post-publish

- **Verify the listing.** Open
  `https://marketplace.visualstudio.com/items?itemName=prixio.maestro`.
  Confirm: icon tile renders (this is where a missing/SVG icon shows up),
  README overview, version `0.1.10`, categories, and the repository link.
  Propagation to search/install can take a few minutes.
- **Install to smoke-test.** In VS Code: Extensions view, search `Maestro`, or
  install by id:

  ```bash
  code --install-extension prixio.maestro
  ```

- **Manage / hub.** All listing management (stats, Q&A, unpublish, transfer) is
  at `https://marketplace.visualstudio.com/manage/publishers/prixio`.
- **Unpublish a version or the whole extension:**

  ```bash
  npx @vscode/vsce unpublish prixio.maestro              # removes the extension
  # (or manage individual versions from the web portal)
  ```

- **Bump for the next release.** Re-run `pnpm -r build`, then
  `npx @vscode/vsce publish patch --no-dependencies` (or `minor`/`major`). The
  Marketplace does not allow re-publishing the SAME version number; bump first.
  Keep `CHANGELOG.md` updated alongside each bump.

---

## 6. Optional: Open VSX and CI automation

### 6a. Open VSX (for Cursor, Windsurf, VSCodium users)

The proprietary VS Code Marketplace is not usable by VS Code forks. Those editors
pull from **Open VSX** (`open-vsx.org`, run by the Eclipse Foundation). Publishing
there too widens reach. The CLI is `ovsx`.

```bash
# one-time: sign in at https://open-vsx.org with GitHub, create an access token,
# then create the namespace matching package.json "publisher":
npx ovsx create-namespace prixio -p "<OPEN_VSX_TOKEN>"

# publish (from packages/extension, same bundled-deps caveat):
cd packages/extension
npx ovsx publish --no-dependencies -p "<OPEN_VSX_TOKEN>"

# or publish an already-built VSIX:
npx ovsx publish maestro-0.1.10.vsix -p "<OPEN_VSX_TOKEN>"
```

You can also set the token via the `OVSX_PAT` env var instead of `-p`. Creating
the namespace does not auto-verify ownership; claim the `prixio` namespace on
the site if you want the verified badge.

### 6b. GitHub Actions release workflow (sketch)

Store the Azure DevOps PAT as a repo secret named `VSCE_PAT` (and optionally an
Open VSX token as `OVSX_PAT`). Then a tag-triggered workflow can publish:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ["v*"]            # e.g. push tag v0.1.11
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - name: Publish to Visual Studio Marketplace
        working-directory: packages/extension
        run: npx @vscode/vsce publish --no-dependencies -p "$VSCE_PAT"
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
      # optional: also publish to Open VSX
      - name: Publish to Open VSX
        working-directory: packages/extension
        run: npx ovsx publish --no-dependencies -p "$OVSX_PAT"
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}
```

Notes:
- `vsce` also reads the `VSCE_PAT` env var automatically, so the explicit
  `-p "$VSCE_PAT"` is belt-and-suspenders; either works.
- This sketch publishes the version that is already in `package.json`. If you
  want CI to bump, run `vsce publish patch --no-dependencies` instead, but then
  CI needs push rights to commit the version bump + tag.
- See the future-proofing note in section 1c: as global PATs are phased out,
  migrate this to workload identity federation when feasible.
