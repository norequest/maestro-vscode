# @maestro/conformance

Shared, source-only conformance harness for engine adapters. Adapter packages import this harness directly from its TypeScript source in their test files, so it is intentionally not built and not published.

Because there is no build step, `main` and `types` point at `src/index.ts` rather than `dist/`. This is deliberate, not an oversight: do not switch it to `dist/` or add a build script, as that would break how the adapter conformance tests resolve this package.
