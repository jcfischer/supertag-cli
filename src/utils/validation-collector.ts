/**
 * Validation Error Collector
 * Spec: 073-error-context
 * Task: T-3.1
 *
 * Aggregates multiple validation errors for comprehensive error reporting.
 * Integrates with Zod for schema validation.
 */

import { z } from "zod";
import { StructuredError } from "./structured-errors";
import type { ValidationErrorItem } from "../types/errors";

// =============================================================================
// ValidationCollector Class
// =============================================================================

/**
 * Collects and aggregates validation errors for comprehensive reporting.
 * Use this to gather all validation issues before throwing a single error.
 */
export class ValidationCollector {
  private errors: ValidationErrorItem[] = [];

  /**
   * Check if there are any collected errors
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get all collected errors
   */
  getErrors(): ValidationErrorItem[] {
    return [...this.errors];
  }

  /**
   * Add a single validation error
   */
  addError(error: ValidationErrorItem): void {
    this.errors.push(error);
  }

  /**
   * Add multiple validation errors at once
   */
  addErrors(errors: ValidationErrorItem[]): void {
    this.errors.push(...errors);
  }

  /**
   * Clear all collected errors
   */
  clear(): void {
    this.errors = [];
  }

  /**
   * Convert collected errors to a StructuredError
   *
   * @param message - The error message
   * @returns StructuredError with validation errors, or undefined if no errors
   */
  toStructuredError(message: string): StructuredError | undefined {
    if (!this.hasErrors()) {
      return undefined;
    }

    return new StructuredError("VALIDATION_ERRORS", message, {
      validationErrors: this.getErrors(),
    });
  }

  /**
   * Throw a StructuredError if there are any collected errors
   *
   * @param message - The error message
   * @throws StructuredError if there are validation errors
   */
  throwIfErrors(message: string): void {
    const error = this.toStructuredError(message);
    if (error) {
      throw error;
    }
  }
}

// =============================================================================
// Zod Integration
// =============================================================================

/**
 * Map a Zod error to ValidationErrorItems
 *
 * @param zodError - The ZodError to map
 * @returns Array of ValidationErrorItem
 */
export function mapZodError(zodError: z.ZodError): ValidationErrorItem[] {
  return zodError.issues.map((issue) => {
    // Build field path from issue.path
    const field = issue.path.join(".");

    // Determine the code based on Zod issue code
    const code = mapZodIssueCode(issue.code);

    // Get the received value if available
    let value: unknown = undefined;
    if ("received" in issue) {
      value = issue.received;
    } else if (issue.code === "invalid_type" && "received" in issue) {
      value = (issue as z.ZodInvalidTypeIssue).received;
    }

    // Build the error item
    const item: ValidationErrorItem = {
      field: field || "value",
      code,
      message: issue.message,
    };

    if (value !== undefined) {
      item.value = value;
    }

    // Add expected type for type errors
    if (issue.code === "invalid_type") {
      item.expected = (issue as z.ZodInvalidTypeIssue).expected;
    }

    return item;
  });
}

/**
 * Map Zod issue code to a standardized code
 */
function mapZodIssueCode(zodCode: z.ZodIssueCode): string {
  switch (zodCode) {
    case "invalid_type":
      return "INVALID_TYPE";
    case "invalid_string":
      return "INVALID_FORMAT";
    case "too_small":
      return "TOO_SMALL";
    case "too_big":
      return "TOO_BIG";
    case "invalid_enum_value":
      return "INVALID_ENUM";
    case "unrecognized_keys":
      return "UNKNOWN_KEYS";
    case "invalid_union":
      return "INVALID_UNION";
    case "invalid_literal":
      return "INVALID_LITERAL";
    case "custom":
      return "CUSTOM";
    default:
      return zodCode.toUpperCase();
  }
}

/**
 * Validate data against a Zod schema and collect all errors
 *
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns ValidationCollector with any errors
 */
export function collectValidationErrors<T>(
  schema: z.ZodType<T>,
  data: unknown
): ValidationCollector {
  const collector = new ValidationCollector();

  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = mapZodError(result.error);
    collector.addErrors(errors);
  }

  return collector;
}
