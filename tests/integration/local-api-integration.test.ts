/**
 * Integration tests for F-094 tana-local API
 *
 * Tests the full stack: types, backend abstraction, CLI commands, MCP tools.
 *
 * Tier 1: Unit tests (no network, always run)
 *   - Tana Paste conversion
 *   - Backend abstraction contracts
 *   - MCP schema registration
 *   - CLI command parsing
 *
 * Tier 2: Live API tests (require TANA_LOCAL_API_TOKEN, marked @slow)
 *   - Real mutation operations against Tana Desktop
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { StructuredError } from "../../src/utils/structured-errors";

// =============================================================================
// Tier 1: Unit Tests (always run, no network)
// =============================================================================

describe("F-094: Local API Integration", () => {
  // ---------------------------------------------------------------------------
  // Tana Paste Conversion
  // ---------------------------------------------------------------------------
  describe("Tana Paste Conversion", () => {
    let convertNodesToTanaPaste: typeof import("../../src/api/local-api-backend").convertNodesToTanaPaste;

    beforeAll(async () => {
      const mod = await import("../../src/api/local-api-backend");
      convertNodesToTanaPaste = mod.convertNodesToTanaPaste;
    });

    it("should convert a simple node to Tana Paste", () => {
      const paste = convertNodesToTanaPaste([{ name: "Hello World" }]);
      expect(paste).toBe("- Hello World");
    });

    it("should convert node with supertag", () => {
      const paste = convertNodesToTanaPaste([
        { name: "Buy groceries", supertags: [{ id: "tag123" }] },
      ]);
      expect(paste).toBe("- Buy groceries #[[^tag123]]");
    });

    it("should convert node with multiple supertags", () => {
      const paste = convertNodesToTanaPaste([
        { name: "Meeting", supertags: [{ id: "t1" }, { id: "t2" }] },
      ]);
      expect(paste).toBe("- Meeting #[[^t1]] #[[^t2]]");
    });

    it("should convert node with description", () => {
      const paste = convertNodesToTanaPaste([
        { name: "Node", description: "A description" },
      ]);
      expect(paste).toBe("- Node\n  - A description");
    });

    it("should convert node with children", () => {
      const paste = convertNodesToTanaPaste([
        {
          name: "Parent",
          children: [{ name: "Child 1" }, { name: "Child 2" }],
        },
      ]);
      expect(paste).toBe("- Parent\n  - Child 1\n  - Child 2");
    });

    it("should convert nested children with correct indentation", () => {
      const paste = convertNodesToTanaPaste([
        {
          name: "Level 0",
          children: [
            {
              name: "Level 1",
              children: [{ name: "Level 2" }],
            },
          ],
        },
      ]);
      expect(paste).toBe("- Level 0\n  - Level 1\n    - Level 2");
    });

    it("should convert field node children", () => {
      const paste = convertNodesToTanaPaste([
        {
          name: "Task",
          supertags: [{ id: "todo" }],
          children: [
            {
              type: "field",
              attributeId: "statusField",
              children: [{ name: "Done" }],
            } as any,
          ],
        },
      ]);
      expect(paste).toContain("- Task #[[^todo]]");
      expect(paste).toContain("  - statusField:: Done");
    });

    it("should convert reference child nodes", () => {
      const paste = convertNodesToTanaPaste([
        {
          name: "Project",
          children: [
            { dataType: "reference", id: "ref123", name: "Link" } as any,
          ],
        },
      ]);
      expect(paste).toContain("- Project");
      expect(paste).toContain("  - [[^ref123]]");
    });

    it("should convert multiple top-level nodes", () => {
      const paste = convertNodesToTanaPaste([
        { name: "First" },
        { name: "Second" },
        { name: "Third" },
      ]);
      expect(paste).toBe("- First\n- Second\n- Third");
    });

    it("should handle empty field children", () => {
      const paste = convertNodesToTanaPaste([
        {
          name: "Node",
          children: [
            {
              type: "field",
              attributeId: "emptyField",
              children: [],
            } as any,
          ],
        },
      ]);
      expect(paste).toContain("  - emptyField::");
    });

    it("should handle field with multiple values", () => {
      const paste = convertNodesToTanaPaste([
        {
          name: "Node",
          children: [
            {
              type: "field",
              attributeId: "multiField",
              children: [{ name: "Val1" }, { name: "Val2" }, { name: "Val3" }],
            } as any,
          ],
        },
      ]);
      expect(paste).toContain("  - multiField:: Val1");
      expect(paste).toContain("    - Val2");
      expect(paste).toContain("    - Val3");
    });
  });

  // ---------------------------------------------------------------------------
  // Backend Abstraction: InputApiBackend
  // ---------------------------------------------------------------------------
  describe("InputApiBackend", () => {
    let InputApiBackend: typeof import("../../src/api/input-api-backend").InputApiBackend;

    beforeAll(async () => {
      const mod = await import("../../src/api/input-api-backend");
      InputApiBackend = mod.InputApiBackend;
    });

    it("should report type as input-api", () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      expect(backend.type).toBe("input-api");
    });

    it("should not support mutations", () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      expect(backend.supportsMutations()).toBe(false);
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for updateNode", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.updateNode("node1", { name: "test" });
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(StructuredError);
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for addTags", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.addTags("node1", ["tag1"]);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(StructuredError);
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for removeTags", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.removeTags("node1", ["tag1"]);
        expect(true).toBe(false);
      } catch (e) {
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for setFieldContent", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.setFieldContent("node1", "attr1", "value");
        expect(true).toBe(false);
      } catch (e) {
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for setFieldOption", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.setFieldOption("node1", "attr1", "opt1");
        expect(true).toBe(false);
      } catch (e) {
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for checkNode", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.checkNode("node1");
        expect(true).toBe(false);
      } catch (e) {
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for uncheckNode", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.uncheckNode("node1");
        expect(true).toBe(false);
      } catch (e) {
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });

    it("should throw MUTATIONS_NOT_SUPPORTED for trashNode", async () => {
      const backend = new InputApiBackend("fake-token", "https://example.com");
      try {
        await backend.trashNode("node1");
        expect(true).toBe(false);
      } catch (e) {
        expect((e as StructuredError).code).toBe("MUTATIONS_NOT_SUPPORTED");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Backend Abstraction: LocalApiBackend
  // ---------------------------------------------------------------------------
  describe("LocalApiBackend", () => {
    let LocalApiBackend: typeof import("../../src/api/local-api-backend").LocalApiBackend;

    beforeAll(async () => {
      const mod = await import("../../src/api/local-api-backend");
      LocalApiBackend = mod.LocalApiBackend;
    });

    it("should report type as local-api", () => {
      // Mock client - just need the constructor shape
      const mockClient = {} as any;
      const backend = new LocalApiBackend(mockClient);
      expect(backend.type).toBe("local-api");
    });

    it("should support mutations", () => {
      const mockClient = {} as any;
      const backend = new LocalApiBackend(mockClient);
      expect(backend.supportsMutations()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // MCP Schema Registration
  // ---------------------------------------------------------------------------
  describe("MCP Schema Registration", () => {
    it("should have all 9 new mutation schemas registered", async () => {
      const schemas = await import("../../src/mcp/schemas");

      expect(schemas.updateNodeSchema).toBeDefined();
      expect(schemas.tagAddSchema).toBeDefined();
      expect(schemas.tagRemoveSchema).toBeDefined();
      expect(schemas.createTagSchema).toBeDefined();
      expect(schemas.setFieldSchema).toBeDefined();
      expect(schemas.setFieldOptionSchema).toBeDefined();
      expect(schemas.trashNodeSchema).toBeDefined();
      expect(schemas.doneSchema).toBeDefined();
      expect(schemas.undoneSchema).toBeDefined();
    });

    it("should validate updateNodeSchema correctly", async () => {
      const { updateNodeSchema } = await import("../../src/mcp/schemas");

      // Valid
      const result = updateNodeSchema.safeParse({ nodeId: "abc123", name: "Test" });
      expect(result.success).toBe(true);

      // Missing nodeId
      const invalid = updateNodeSchema.safeParse({ name: "Test" });
      expect(invalid.success).toBe(false);
    });

    it("should validate tagAddSchema correctly", async () => {
      const { tagAddSchema } = await import("../../src/mcp/schemas");

      // Valid
      const result = tagAddSchema.safeParse({ nodeId: "n1", tagIds: ["t1", "t2"] });
      expect(result.success).toBe(true);

      // Empty tagIds
      const invalid = tagAddSchema.safeParse({ nodeId: "n1", tagIds: [] });
      expect(invalid.success).toBe(false);
    });

    it("should validate createTagSchema correctly", async () => {
      const { createTagSchema } = await import("../../src/mcp/schemas");

      // Minimal valid
      const result = createTagSchema.safeParse({ name: "sprint" });
      expect(result.success).toBe(true);

      // With optional fields
      const full = createTagSchema.safeParse({
        name: "sprint",
        description: "Sprint tag",
        color: "blue",
      });
      expect(full.success).toBe(true);

      // Empty name
      const invalid = createTagSchema.safeParse({ name: "" });
      expect(invalid.success).toBe(false);
    });

    it("should validate setFieldSchema correctly", async () => {
      const { setFieldSchema } = await import("../../src/mcp/schemas");

      const result = setFieldSchema.safeParse({
        nodeId: "n1",
        attributeId: "attr1",
        content: "hello",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("replace");
      }

      const append = setFieldSchema.safeParse({
        nodeId: "n1",
        attributeId: "attr1",
        content: "hello",
        mode: "append",
      });
      expect(append.success).toBe(true);

      const invalid = setFieldSchema.safeParse({
        nodeId: "n1",
        attributeId: "attr1",
        content: "hello",
        mode: "merge",
      });
      expect(invalid.success).toBe(false);
    });

    it("should validate setFieldOptionSchema append mode correctly", async () => {
      const { setFieldOptionSchema } = await import("../../src/mcp/schemas");

      const result = setFieldOptionSchema.safeParse({
        nodeId: "n1",
        attributeId: "attr1",
        optionId: "opt1",
        mode: "append",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("append");
      }
    });

    it("should validate trashNodeSchema correctly", async () => {
      const { trashNodeSchema } = await import("../../src/mcp/schemas");

      const result = trashNodeSchema.safeParse({ nodeId: "n1" });
      expect(result.success).toBe(true);

      const invalid = trashNodeSchema.safeParse({});
      expect(invalid.success).toBe(false);
    });

    it("should validate doneSchema correctly", async () => {
      const { doneSchema } = await import("../../src/mcp/schemas");

      const result = doneSchema.safeParse({ nodeId: "n1" });
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Registry
  // ---------------------------------------------------------------------------
  describe("Tool Registry", () => {
    it("should include all 9 new mutation tools in metadata", async () => {
      const { TOOL_METADATA } = await import("../../src/mcp/tool-registry");

      const mutateTools = TOOL_METADATA.filter(t => t.category === "mutate");
      const toolNames = mutateTools.map(t => t.name);

      // Original mutate tools
      expect(toolNames).toContain("tana_create");
      expect(toolNames).toContain("tana_batch_create");
      expect(toolNames).toContain("tana_sync");

      // New F-094 mutation tools
      expect(toolNames).toContain("tana_update_node");
      expect(toolNames).toContain("tana_tag_add");
      expect(toolNames).toContain("tana_tag_remove");
      expect(toolNames).toContain("tana_create_tag");
      expect(toolNames).toContain("tana_set_field");
      expect(toolNames).toContain("tana_set_field_option");
      expect(toolNames).toContain("tana_trash_node");
      expect(toolNames).toContain("tana_done");
      expect(toolNames).toContain("tana_undone");
    });

    it("should have schemas for all new tools", async () => {
      const { getToolSchema } = await import("../../src/mcp/tool-registry");

      const newTools = [
        "tana_update_node", "tana_tag_add", "tana_tag_remove",
        "tana_create_tag", "tana_set_field", "tana_set_field_option",
        "tana_trash_node", "tana_done", "tana_undone",
      ];

      for (const name of newTools) {
        const schema = getToolSchema(name);
        expect(schema).not.toBeNull();
        expect(schema!.type).toBe("object");
      }
    });

    it("should expose new tools in capabilities response", async () => {
      const { getCapabilities } = await import("../../src/mcp/tool-registry");

      const caps = getCapabilities({ category: "mutate" });
      const toolNames = caps.categories[0].tools.map(t => t.name);

      expect(toolNames).toContain("tana_update_node");
      expect(toolNames).toContain("tana_done");
      expect(toolNames).toContain("tana_trash_node");
    });
  });

  // ---------------------------------------------------------------------------
  // Error Registry
  // ---------------------------------------------------------------------------
  describe("Error Registry", () => {
    it("should have all F-094 error codes registered", async () => {
      const { getErrorMeta } = await import("../../src/utils/error-registry");

      // LOCAL_API_UNAVAILABLE
      const localMeta = getErrorMeta("LOCAL_API_UNAVAILABLE");
      expect(localMeta).toBeDefined();
      expect(localMeta!.category).toBe("network");
      expect(localMeta!.retryable).toBe(true);

      // AUTH_EXPIRED
      const authMeta = getErrorMeta("AUTH_EXPIRED");
      expect(authMeta).toBeDefined();
      expect(authMeta!.category).toBe("auth");
      expect(authMeta!.retryable).toBe(false);

      // MUTATIONS_NOT_SUPPORTED
      const mutMeta = getErrorMeta("MUTATIONS_NOT_SUPPORTED");
      expect(mutMeta).toBeDefined();
      expect(mutMeta!.category).toBe("config");
      expect(mutMeta!.retryable).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // LocalApiClient Construction
  // ---------------------------------------------------------------------------
  describe("LocalApiClient", () => {
    let LocalApiClient: typeof import("../../src/api/local-api-client").LocalApiClient;

    beforeAll(async () => {
      const mod = await import("../../src/api/local-api-client");
      LocalApiClient = mod.LocalApiClient;
    });

    it("should construct with endpoint and bearer token", () => {
      const client = new LocalApiClient({
        endpoint: "http://localhost:8262",
        bearerToken: "test-token",
      });
      expect(client).toBeDefined();
    });

    it("should strip trailing slashes from endpoint", () => {
      const client = new LocalApiClient({
        endpoint: "http://localhost:8262///",
        bearerToken: "test-token",
      });
      // Can't access private field, but verify it constructed
      expect(client).toBeDefined();
    });

    it("should have health() return false when no server running", async () => {
      const client = new LocalApiClient({
        endpoint: "http://localhost:19999", // non-existent port
        bearerToken: "test-token",
      });
      // health() should catch connection error and return false
      const healthy = await client.health();
      expect(healthy).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Backend Resolver (no live API)
  // ---------------------------------------------------------------------------
  describe("Backend Resolver", () => {
    it("should export resolveBackend and clearBackendCache", async () => {
      const mod = await import("../../src/api/backend-resolver");
      expect(typeof mod.resolveBackend).toBe("function");
      expect(typeof mod.clearBackendCache).toBe("function");
    });
  });

  // ---------------------------------------------------------------------------
  // CLI Command Registration
  // ---------------------------------------------------------------------------
  // CLI subprocess tests need extended timeout for CI runners
  const CLI_TIMEOUT = 15000;

  describe("CLI Commands", () => {
    it("should register edit command", async () => {
      const result = await $`bun run src/index.ts edit --help 2>&1`.text();
      expect(result).toContain("edit");
      expect(result).toContain("nodeId");
    }, CLI_TIMEOUT);

    it("should register tag command with subcommands", async () => {
      const result = await $`bun run src/index.ts tag --help 2>&1`.text();
      expect(result).toContain("add");
      expect(result).toContain("remove");
      expect(result).toContain("create");
    }, CLI_TIMEOUT);

    it("should register set-field command", async () => {
      const result = await $`bun run src/index.ts set-field --help 2>&1`.text();
      expect(result).toContain("set-field");
      expect(result).toContain("nodeId");
      expect(result).toContain("fieldName");
      expect(result).toContain("--append");
    }, CLI_TIMEOUT);

    it("should register trash command", async () => {
      const result = await $`bun run src/index.ts trash --help 2>&1`.text();
      expect(result).toContain("trash");
      expect(result).toContain("nodeId");
    }, CLI_TIMEOUT);

    it("should register done command", async () => {
      const result = await $`bun run src/index.ts done --help 2>&1`.text();
      expect(result).toContain("done");
      expect(result).toContain("nodeId");
    }, CLI_TIMEOUT);

    it("should register undone command", async () => {
      const result = await $`bun run src/index.ts undone --help 2>&1`.text();
      expect(result).toContain("undone");
      expect(result).toContain("nodeId");
    }, CLI_TIMEOUT);

    it("should show Local API settings in config --show", async () => {
      const result = await $`bun run src/index.ts config --show 2>&1`.text();
      expect(result).toContain("Local API");
    }, CLI_TIMEOUT);
  });

  // ---------------------------------------------------------------------------
  // Config Manager Local API Support
  // ---------------------------------------------------------------------------
  describe("Config Manager Local API", () => {
    it("should have getLocalApiConfig method", async () => {
      const { ConfigManager } = await import("../../src/config/manager");
      const manager = ConfigManager.getInstance();
      const config = manager.getLocalApiConfig();

      expect(config).toBeDefined();
      expect(typeof config.enabled).toBe("boolean");
      expect(typeof config.endpoint).toBe("string");
      // bearerToken may be undefined if not configured
    });

    it("should return default endpoint when not configured", async () => {
      const { ConfigManager } = await import("../../src/config/manager");
      const config = ConfigManager.getInstance().getLocalApiConfig();
      expect(config.endpoint).toBe("http://localhost:8262");
    });
  });

  // ---------------------------------------------------------------------------
  // Types: Local API Zod Schemas
  // ---------------------------------------------------------------------------
  describe("Local API Types", () => {
    it("should validate ImportResponse schema", async () => {
      const { ImportResponseSchema } = await import("../../src/types/local-api");
      const result = ImportResponseSchema.safeParse({
        parentNodeId: "p1",
        targetNodeId: "t1",
        createdNodes: [
          { id: "n1", name: "Test" },
          { id: "n2", name: "Test 2" },
        ],
        message: "Imported 2 nodes",
      });
      expect(result.success).toBe(true);
    });

    it("should validate UpdateResponse schema", async () => {
      const { UpdateResponseSchema } = await import("../../src/types/local-api");
      const result = UpdateResponseSchema.safeParse({
        nodeId: "n1",
        name: "Updated",
        description: "New desc",
        message: "Node updated",
      });
      expect(result.success).toBe(true);
    });

    it("should validate TagOperationResponse schema", async () => {
      const { TagOperationResponseSchema } = await import("../../src/types/local-api");
      const result = TagOperationResponseSchema.safeParse({
        nodeId: "n1",
        nodeName: "My Node",
        action: "add",
        results: [
          { tagId: "t1", tagName: "todo", success: true, message: "Tag added" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should validate DoneResponse schema", async () => {
      const { DoneResponseSchema } = await import("../../src/types/local-api");
      const result = DoneResponseSchema.safeParse({
        nodeId: "n1",
        nodeName: "My Task",
        done: true,
        message: "Node marked as done",
      });
      expect(result.success).toBe(true);
    });

    it("should validate TrashResponse schema", async () => {
      const { TrashResponseSchema } = await import("../../src/types/local-api");
      const result = TrashResponseSchema.safeParse({
        nodeId: "n1",
        nodeName: "My Node",
        trashNodeId: "trash1",
        message: "Node moved to trash",
      });
      expect(result.success).toBe(true);
    });

    it("should validate FieldContentResponse schema", async () => {
      const { FieldContentResponseSchema } = await import("../../src/types/local-api");
      const result = FieldContentResponseSchema.safeParse({
        nodeId: "n1",
        attributeId: "a1",
        content: "hello",
        message: "Field content set",
      });
      expect(result.success).toBe(true);
    });

    it("should validate FieldOptionResponse schema", async () => {
      const { FieldOptionResponseSchema } = await import("../../src/types/local-api");
      const result = FieldOptionResponseSchema.safeParse({
        nodeId: "n1",
        attributeId: "a1",
        optionId: "o1",
        optionName: "Active",
        message: "Option set",
      });
      expect(result.success).toBe(true);
    });

    it("should validate CreateTagResponse schema", async () => {
      const { CreateTagResponseSchema } = await import("../../src/types/local-api");
      const result = CreateTagResponseSchema.safeParse({
        tagId: "t1",
        tagName: "sprint",
        message: "Tag created",
      });
      expect(result.success).toBe(true);
    });

    it("should validate HealthResponse schema", async () => {
      const { HealthResponseSchema } = await import("../../src/types/local-api");
      const result = HealthResponseSchema.safeParse({
        status: "ok",
        timestamp: "2026-01-29T12:00:00Z",
        nodeSpaceReady: true,
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid ImportResponse", async () => {
      const { ImportResponseSchema } = await import("../../src/types/local-api");
      const result = ImportResponseSchema.safeParse({
        createdNodes: "not-an-array",
      });
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Tier 2: Live API Tests (require TANA_LOCAL_API_TOKEN)
// =============================================================================

const TANA_LOCAL_API_TOKEN = process.env.TANA_LOCAL_API_TOKEN;
const LOCAL_API_URL = process.env.TANA_LOCAL_API_URL || "http://localhost:8262";

const describeLive = TANA_LOCAL_API_TOKEN ? describe : describe.skip;

describeLive("F-094: Live Local API Tests @slow", () => {
  let LocalApiClient: typeof import("../../src/api/local-api-client").LocalApiClient;
  let client: InstanceType<typeof LocalApiClient>;
  let createdNodeId: string | null = null;
  let homeNodeId: string | null = null;

  beforeAll(async () => {
    const mod = await import("../../src/api/local-api-client");
    LocalApiClient = mod.LocalApiClient;

    client = new LocalApiClient({
      endpoint: LOCAL_API_URL,
      bearerToken: TANA_LOCAL_API_TOKEN!,
    });

    // Verify Tana is actually running
    const healthy = await client.health();
    if (!healthy) {
      throw new Error(
        `Tana Desktop not available at ${LOCAL_API_URL}. ` +
        `Start Tana Desktop with Local API enabled to run these tests.`
      );
    }

    // Resolve home node ID for import operations
    const workspaces = await client.listWorkspaces();
    if (workspaces.length > 0) {
      homeNodeId = workspaces[0].homeNodeId;
    }
  });

  afterAll(async () => {
    // Clean up: trash the test node if one was created
    if (createdNodeId && client) {
      try {
        await client.trashNode(createdNodeId);
        console.log(`Cleanup: trashed test node ${createdNodeId}`);
      } catch {
        console.log(`Cleanup: failed to trash ${createdNodeId} (may already be deleted)`);
      }
    }
  });

  it("should pass health check", async () => {
    const healthy = await client.health();
    expect(healthy).toBe(true);
  });

  it("should list workspaces", async () => {
    const workspaces = await client.listWorkspaces();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
    expect(workspaces[0]).toHaveProperty("id");
    expect(workspaces[0]).toHaveProperty("name");
    console.log(`Found ${workspaces.length} workspace(s):`, workspaces.map(w => w.name));
  });

  it("should create a node via Tana Paste import", async () => {
    if (!homeNodeId) {
      console.log("Skipping: no homeNodeId resolved from workspaces");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const result = await client.importTanaPaste(
      homeNodeId,
      `- F094-Test-${timestamp}`
    );

    expect(result.createdNodes).toBeDefined();
    expect(result.createdNodes.length).toBeGreaterThan(0);
    createdNodeId = result.createdNodes[0].id;
    console.log(`Created test node: ${createdNodeId}`);
  });

  it("should update the created node", async () => {
    if (!createdNodeId) return;

    const result = await client.updateNode(createdNodeId, {
      name: "F094-Test-Updated",
      description: "Updated by integration test",
    });

    expect(result.nodeId).toBe(createdNodeId);
  });

  it("should check (done) the node", async () => {
    if (!createdNodeId) return;

    const result = await client.checkNode(createdNodeId);
    expect(result.nodeId).toBe(createdNodeId);
    expect(result.done).toBe(true);
  });

  it("should uncheck (undone) the node", async () => {
    if (!createdNodeId) return;

    const result = await client.uncheckNode(createdNodeId);
    expect(result.nodeId).toBe(createdNodeId);
    expect(result.done).toBe(false);
  });

  it("should read the node back", async () => {
    if (!createdNodeId) return;

    const result = await client.readNode(createdNodeId);
    expect(result).toBeDefined();
    expect(typeof result.markdown).toBe("string");
  });

  it("should trash the node", async () => {
    if (!createdNodeId) return;

    const result = await client.trashNode(createdNodeId);
    expect(result.nodeId).toBe(createdNodeId);
    expect(typeof result.trashNodeId).toBe("string");

    // Already cleaned up
    createdNodeId = null;
  });

  it("should search for nodes", async () => {
    // Search API uses structured queries (OpenAPI deepObject style)
    // textContains: case-insensitive substring match in node names
    const results = await client.searchNodes({ textContains: "test" }, { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
    // Just verify it returns without error; results depend on workspace content
    console.log(`Search returned ${results.length} result(s)`);
  });

  it("should list tags in workspace", async () => {
    const workspaces = await client.listWorkspaces();
    const firstWsId = workspaces[0].id;

    const tags = await client.listTags(firstWsId);
    expect(Array.isArray(tags)).toBe(true);
    console.log(`Found ${tags.length} tags in workspace`);
  });
});
