/**
 * Tests for inferDataType utility
 * Spec 020: Schema Consolidation - T-2.2
 */

import { describe, it, expect } from "bun:test";
import { inferDataType, DataType } from "../../src/utils/infer-data-type";

describe("inferDataType", () => {
  describe("date type inference", () => {
    it("should infer date type for field names containing 'date'", () => {
      expect(inferDataType("Due Date")).toBe("date");
      expect(inferDataType("duedate")).toBe("date");
      expect(inferDataType("Start Date")).toBe("date");
    });

    it("should infer date type for field names containing 'time'", () => {
      expect(inferDataType("Time")).toBe("date");
      expect(inferDataType("Start Time")).toBe("date");
      expect(inferDataType("Completion Time")).toBe("date");
    });

    it("should infer date type for field names containing 'scheduled'", () => {
      expect(inferDataType("Scheduled on")).toBe("date");
      expect(inferDataType("Scheduled")).toBe("date");
      expect(inferDataType("Scheduled for")).toBe("date");
    });

    it("should infer date type for field names containing temporal keywords", () => {
      // Deadline patterns
      expect(inferDataType("Deadline")).toBe("date");
      expect(inferDataType("Project Deadline")).toBe("date");
      // When patterns
      expect(inferDataType("When")).toBe("date");
      // Expiry patterns
      expect(inferDataType("Expires")).toBe("date");
      expect(inferDataType("Expiry")).toBe("date");
      expect(inferDataType("Expiration")).toBe("date");
    });
  });

  describe("url type inference", () => {
    it("should infer url type for field names containing 'url'", () => {
      expect(inferDataType("URL")).toBe("url");
      expect(inferDataType("Website URL")).toBe("url");
    });

    it("should infer url type for field names containing 'link'", () => {
      expect(inferDataType("Link")).toBe("url");
      expect(inferDataType("External Link")).toBe("url");
    });
  });

  describe("number type inference", () => {
    it("should infer number type for field names containing 'count'", () => {
      expect(inferDataType("Count")).toBe("number");
      expect(inferDataType("Word Count")).toBe("number");
    });

    it("should infer number type for field names containing 'number'", () => {
      expect(inferDataType("Number")).toBe("number");
      expect(inferDataType("Phone Number")).toBe("text"); // Edge case: phone is text
    });

    it("should infer number type for field names containing 'amount'", () => {
      expect(inferDataType("Amount")).toBe("number");
      expect(inferDataType("Total Amount")).toBe("number");
    });
  });

  describe("reference type inference", () => {
    it("should infer reference type for field names containing 'status'", () => {
      expect(inferDataType("Status")).toBe("reference");
      expect(inferDataType("Project Status")).toBe("reference");
    });

    it("should infer reference type for field names containing 'type'", () => {
      expect(inferDataType("Type")).toBe("reference");
      expect(inferDataType("Content Type")).toBe("reference");
    });

    it("should infer reference type for field names containing 'category'", () => {
      expect(inferDataType("Category")).toBe("reference");
      expect(inferDataType("Main Category")).toBe("reference");
    });
  });

  describe("checkbox type inference", () => {
    it("should infer checkbox type for field names starting with 'is'", () => {
      expect(inferDataType("Is Active")).toBe("checkbox");
      expect(inferDataType("Is Done")).toBe("checkbox");
    });

    it("should infer checkbox type for field names starting with 'has'", () => {
      expect(inferDataType("Has Attachments")).toBe("checkbox");
      expect(inferDataType("Has Children")).toBe("checkbox");
    });

    it("should infer checkbox type for field names containing 'enabled'", () => {
      expect(inferDataType("Enabled")).toBe("checkbox");
      expect(inferDataType("Notifications Enabled")).toBe("checkbox");
    });

    it("should infer checkbox type for field names containing 'completed'", () => {
      expect(inferDataType("Completed")).toBe("checkbox");
      expect(inferDataType("Is Completed")).toBe("checkbox");
    });
  });

  describe("text type fallback", () => {
    it("should default to text for unrecognized field names", () => {
      expect(inferDataType("Description")).toBe("text");
      expect(inferDataType("Notes")).toBe("text");
      expect(inferDataType("Title")).toBe("text");
      expect(inferDataType("Name")).toBe("text");
    });
  });

  describe("case insensitivity", () => {
    it("should handle uppercase field names", () => {
      expect(inferDataType("DUE DATE")).toBe("date");
      expect(inferDataType("URL")).toBe("url");
      expect(inferDataType("STATUS")).toBe("reference");
    });

    it("should handle mixed case field names", () => {
      expect(inferDataType("DueDate")).toBe("date");
      expect(inferDataType("isActive")).toBe("checkbox");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      expect(inferDataType("")).toBe("text");
    });

    it("should handle field names with emojis", () => {
      expect(inferDataType("Due Date 📅")).toBe("date");
      expect(inferDataType("🔗 Link")).toBe("url");
    });
  });
});
