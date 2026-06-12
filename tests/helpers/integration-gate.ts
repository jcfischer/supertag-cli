/**
 * Integration test gate.
 *
 * Some test suites are too heavy for the pre-push fast gate, for two distinct
 * reasons:
 *   1. They drive the real CLI as a subprocess (`bun run src/index.ts …`), which
 *      recompiles TypeScript on every call — slow regardless of the DB. These
 *      build their own temp fixture DB and DO run on CI (e.g. tags-metadata,
 *      tags-visualize, search-field-filter); they are gated purely for wall time.
 *   2. They query the live workspace database (the 854k-node `main` index) — slow,
 *      non-deterministic, and self-skipping on CI where no DB exists (e.g.
 *      commands/transcript, select-parameter, db/transcript).
 *
 * Both kinds blow the fast suite past the smoke-test timeout under load. Wrap
 * their top-level `describe` with `describeIntegration` so they are skipped by
 * default and only run when `RUN_INTEGRATION=1` is set — locally via
 * `test:integration`/`test:full`, and on CI (which sets it, so the category-1
 * temp-DB e2e suites keep their coverage there).
 *
 *   import { describeIntegration } from "../helpers/integration-gate";
 *   describeIntegration("CLI: tags metadata", () => { ... });
 */
import { describe } from "bun:test";

export const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

export const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;
