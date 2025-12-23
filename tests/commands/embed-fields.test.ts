/**
 * Embed Fields Flag Tests (T-7.3)
 *
 * Tests for the --include-fields flag in the embed generate command.
 */

import { describe, it, expect } from "bun:test";

describe("Embed Command Fields Flag (T-7.3)", () => {
  describe("Command Structure", () => {
    it("should accept --include-fields flag", async () => {
      const { createEmbedCommand } = await import("../../src/commands/embed");
      const cmd = createEmbedCommand();

      // Find the generate subcommand
      const generateCmd = cmd.commands.find((c) => c.name() === "generate");
      expect(generateCmd).toBeDefined();

      // Check that --include-fields option exists
      const options = generateCmd!.options;
      const includeFieldsOpt = options.find(
        (o: { long?: string }) => o.long === "--include-fields"
      );
      expect(includeFieldsOpt).toBeDefined();
    });

    it("should have description for --include-fields", async () => {
      const { createEmbedCommand } = await import("../../src/commands/embed");
      const cmd = createEmbedCommand();

      const generateCmd = cmd.commands.find((c) => c.name() === "generate");
      const options = generateCmd!.options;
      const includeFieldsOpt = options.find(
        (o: { long?: string }) => o.long === "--include-fields"
      );

      expect(includeFieldsOpt!.description).toContain("field");
    });
  });

  describe("contextualizeNodesWithFields Integration", () => {
    it("should export contextualizeNodesWithFields from contextualize module", async () => {
      const { contextualizeNodesWithFields } = await import(
        "../../src/embeddings/contextualize"
      );
      expect(typeof contextualizeNodesWithFields).toBe("function");
    });

    it("should export ContextualizeWithFieldsOptions interface", async () => {
      // This test just verifies the module structure compiles
      const contextModule = await import("../../src/embeddings/contextualize");
      expect(contextModule.contextualizeNodesWithFields).toBeDefined();
    });
  });
});
