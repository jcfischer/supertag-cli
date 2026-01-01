/**
 * Tests for base error utilities
 * Spec: 073-error-context
 * Task: T-5.1
 */

import { describe, it, expect } from "bun:test";
import {
  TanaError,
  ConfigError,
  ApiError,
  ValidationError,
  ParseError,
  RateLimitError,
  formatErrorMessage,
} from "../../src/utils/errors";
import { StructuredError } from "../../src/utils/structured-errors";

describe("Base Error Classes", () => {
  describe("TanaError", () => {
    it("should create error with message", () => {
      const error = new TanaError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("TanaError");
    });

    it("should be instanceof Error", () => {
      const error = new TanaError("Test");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("ConfigError", () => {
    it("should extend TanaError", () => {
      const error = new ConfigError("Config issue");
      expect(error).toBeInstanceOf(TanaError);
      expect(error.name).toBe("ConfigError");
    });
  });

  describe("ApiError", () => {
    it("should include status code", () => {
      const error = new ApiError("API failed", 500);
      expect(error.statusCode).toBe(500);
    });

    it("should include response", () => {
      const response = { error: "Internal error" };
      const error = new ApiError("API failed", 500, response);
      expect(error.response).toEqual(response);
    });
  });

  describe("ValidationError", () => {
    it("should include validation errors array", () => {
      const error = new ValidationError("Validation failed", ["Field 1 invalid", "Field 2 missing"]);
      expect(error.errors).toHaveLength(2);
    });
  });

  describe("RateLimitError", () => {
    it("should include retryAfter", () => {
      const error = new RateLimitError("Rate limited", 30);
      expect(error.retryAfter).toBe(30);
    });
  });
});

describe("formatErrorMessage", () => {
  it("should format ConfigError", () => {
    const error = new ConfigError("Config not found");
    const msg = formatErrorMessage(error);
    expect(msg).toContain("Configuration Error");
    expect(msg).toContain("Config not found");
  });

  it("should format ApiError with status code", () => {
    const error = new ApiError("Request failed", 404);
    const msg = formatErrorMessage(error);
    expect(msg).toContain("API Error");
    expect(msg).toContain("404");
  });

  it("should format ValidationError with field errors", () => {
    const error = new ValidationError("Invalid input", ["Name required", "Email invalid"]);
    const msg = formatErrorMessage(error);
    expect(msg).toContain("Validation Error");
    expect(msg).toContain("Name required");
    expect(msg).toContain("Email invalid");
  });

  it("should format ParseError", () => {
    const error = new ParseError("Invalid JSON");
    const msg = formatErrorMessage(error);
    expect(msg).toContain("Parse Error");
    expect(msg).toContain("Invalid JSON");
  });

  it("should format RateLimitError with retryAfter", () => {
    const error = new RateLimitError("Too many requests", 60);
    const msg = formatErrorMessage(error);
    expect(msg).toContain("Rate Limit");
    expect(msg).toContain("60");
  });

  it("should format StructuredError using structured formatter", () => {
    const error = new StructuredError("API_ERROR", "API request failed", {
      suggestion: "Check your connection",
    });
    const msg = formatErrorMessage(error);
    expect(msg).toContain("API_ERROR");
    expect(msg).toContain("API request failed");
    expect(msg).toContain("Check your connection");
  });

  it("should format generic Error", () => {
    const error = new Error("Something went wrong");
    const msg = formatErrorMessage(error);
    expect(msg).toContain("Error");
    expect(msg).toContain("Something went wrong");
  });

  it("should format unknown error type", () => {
    const msg = formatErrorMessage("Just a string");
    expect(msg).toContain("Unknown Error");
    expect(msg).toContain("Just a string");
  });
});
