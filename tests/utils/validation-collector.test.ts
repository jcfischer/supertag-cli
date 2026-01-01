/**
 * Tests for validation error collector
 * Spec: 073-error-context
 * Task: T-3.1
 */

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  ValidationCollector,
  mapZodError,
  collectValidationErrors,
} from "../../src/utils/validation-collector";
import type { ValidationErrorItem } from "../../src/types/errors";

describe("ValidationCollector", () => {
  describe("constructor", () => {
    it("should create empty collector", () => {
      const collector = new ValidationCollector();
      expect(collector.hasErrors()).toBe(false);
      expect(collector.getErrors()).toEqual([]);
    });
  });

  describe("addError", () => {
    it("should add a single error", () => {
      const collector = new ValidationCollector();
      collector.addError({
        field: "name",
        code: "REQUIRED",
        message: "Name is required",
      });

      expect(collector.hasErrors()).toBe(true);
      expect(collector.getErrors()).toHaveLength(1);
      expect(collector.getErrors()[0].field).toBe("name");
    });

    it("should add multiple errors", () => {
      const collector = new ValidationCollector();
      collector.addError({
        field: "name",
        code: "REQUIRED",
        message: "Name is required",
      });
      collector.addError({
        field: "email",
        code: "INVALID_FORMAT",
        message: "Invalid email format",
      });

      expect(collector.getErrors()).toHaveLength(2);
    });

    it("should include optional fields", () => {
      const collector = new ValidationCollector();
      collector.addError({
        field: "date",
        code: "INVALID_FORMAT",
        message: "Invalid date",
        value: "not-a-date",
        expected: "YYYY-MM-DD",
        suggestion: "Use format: 2025-12-31",
      });

      const error = collector.getErrors()[0];
      expect(error.value).toBe("not-a-date");
      expect(error.expected).toBe("YYYY-MM-DD");
      expect(error.suggestion).toBe("Use format: 2025-12-31");
    });
  });

  describe("addErrors", () => {
    it("should add multiple errors at once", () => {
      const collector = new ValidationCollector();
      collector.addErrors([
        { field: "a", code: "X", message: "Error A" },
        { field: "b", code: "Y", message: "Error B" },
      ]);

      expect(collector.getErrors()).toHaveLength(2);
    });
  });

  describe("clear", () => {
    it("should clear all errors", () => {
      const collector = new ValidationCollector();
      collector.addError({ field: "x", code: "Y", message: "Z" });
      expect(collector.hasErrors()).toBe(true);

      collector.clear();
      expect(collector.hasErrors()).toBe(false);
      expect(collector.getErrors()).toEqual([]);
    });
  });

  describe("toStructuredError", () => {
    it("should create StructuredError with validation errors", () => {
      const collector = new ValidationCollector();
      collector.addError({ field: "name", code: "REQUIRED", message: "Required" });
      collector.addError({ field: "age", code: "INVALID", message: "Invalid age" });

      const error = collector.toStructuredError("Validation failed");
      expect(error.code).toBe("VALIDATION_ERRORS");
      expect(error.message).toBe("Validation failed");
      expect(error.validationErrors).toHaveLength(2);
    });

    it("should return undefined when no errors", () => {
      const collector = new ValidationCollector();
      const error = collector.toStructuredError("No errors");
      expect(error).toBeUndefined();
    });
  });

  describe("throwIfErrors", () => {
    it("should throw when errors exist", () => {
      const collector = new ValidationCollector();
      collector.addError({ field: "x", code: "Y", message: "Error" });

      expect(() => collector.throwIfErrors("Validation failed")).toThrow();
    });

    it("should not throw when no errors", () => {
      const collector = new ValidationCollector();

      expect(() => collector.throwIfErrors("No errors")).not.toThrow();
    });

    it("should throw StructuredError with correct code", () => {
      const collector = new ValidationCollector();
      collector.addError({ field: "x", code: "Y", message: "Error" });

      try {
        collector.throwIfErrors("Failed");
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect((e as any).code).toBe("VALIDATION_ERRORS");
      }
    });
  });
});

describe("mapZodError", () => {
  it("should map simple Zod error", () => {
    const schema = z.object({
      name: z.string().min(1),
    });

    try {
      schema.parse({ name: "" });
    } catch (e) {
      if (e instanceof z.ZodError) {
        const errors = mapZodError(e);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].field).toBe("name");
      }
    }
  });

  it("should map nested Zod error", () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    });

    try {
      schema.parse({ user: { email: "invalid" } });
    } catch (e) {
      if (e instanceof z.ZodError) {
        const errors = mapZodError(e);
        expect(errors[0].field).toBe("user.email");
      }
    }
  });

  it("should map array index in Zod error", () => {
    const schema = z.object({
      items: z.array(z.string().min(1)),
    });

    try {
      schema.parse({ items: ["valid", ""] });
    } catch (e) {
      if (e instanceof z.ZodError) {
        const errors = mapZodError(e);
        expect(errors[0].field).toContain("items");
      }
    }
  });

  it("should include Zod error message", () => {
    const schema = z.string().min(5, "Must be at least 5 characters");

    try {
      schema.parse("abc");
    } catch (e) {
      if (e instanceof z.ZodError) {
        const errors = mapZodError(e);
        expect(errors[0].message).toContain("5");
      }
    }
  });

  it("should include expected type for type errors", () => {
    const schema = z.number();

    try {
      schema.parse("not-a-number");
    } catch (e) {
      if (e instanceof z.ZodError) {
        const errors = mapZodError(e);
        // Zod reports the expected type
        expect(errors[0].expected).toBe("number");
        expect(errors[0].code).toBe("INVALID_TYPE");
      }
    }
  });
});

describe("collectValidationErrors", () => {
  it("should collect all errors from Zod validation", () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });

    const result = collectValidationErrors(schema, { name: "", age: -1 });
    expect(result.hasErrors()).toBe(true);
    expect(result.getErrors().length).toBeGreaterThanOrEqual(2);
  });

  it("should return empty collector for valid data", () => {
    const schema = z.object({
      name: z.string(),
    });

    const result = collectValidationErrors(schema, { name: "test" });
    expect(result.hasErrors()).toBe(false);
  });
});
