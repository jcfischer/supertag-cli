/**
 * Integration test gate.
 *
 * Some test suites drive the real CLI as a subprocess (`bun run src/index.ts …`)
 * and/or query the live workspace database (the 854k-node `main` index). They are:
 *   - slow (each CLI spawn recompiles TypeScript; real queries scan a large DB),
 *   - non-deterministic (assert against whatever data happens to be in the export),
 *   - invisible on CI (no DB is built there, so they self-skip anyway).
 *
 * Running them in the pre-push fast gate is what makes that gate flake under load
 * (wall time blows past the smoke-test timeout). Wrap their top-level `describe`
 * with `describeIntegration` so they are skipped by default and only run when
 * `RUN_INTEGRATION=1` is set (the `test:integration` and `test:full` scripts).
 *
 *   import { describeIntegration } from "../helpers/integration-gate";
 *   describeIntegration("CLI: tags metadata", () => { ... });
 */
import { describe } from "bun:test";

export const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

export const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;
