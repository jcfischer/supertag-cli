/**
 * Tests for Query Tokenizer
 * Spec 063: Unified Query Language
 *
 * TDD: RED phase - write tests first
 */

import { describe, it, expect } from "bun:test";
import { tokenize, TokenType, type Token } from "../src/query/tokenizer";

describe("Query Tokenizer", () => {
  describe("Keywords", () => {
    it("should tokenize 'find' keyword", () => {
      const tokens = tokenize("find task");
      expect(tokens[0]).toEqual({ type: TokenType.KEYWORD, value: "find" });
    });

    it("should tokenize 'where' keyword", () => {
      const tokens = tokenize("find task where Status = Done");
      expect(tokens.find((t) => t.value === "where")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'order' and 'by' keywords", () => {
      const tokens = tokenize("find task order by created");
      expect(tokens.find((t) => t.value === "order")?.type).toBe(TokenType.KEYWORD);
      expect(tokens.find((t) => t.value === "by")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'limit' keyword", () => {
      const tokens = tokenize("find task limit 10");
      expect(tokens.find((t) => t.value === "limit")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'offset' keyword", () => {
      const tokens = tokenize("find task offset 20");
      expect(tokens.find((t) => t.value === "offset")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'and' keyword", () => {
      const tokens = tokenize("Status = Done and Priority > 2");
      expect(tokens.find((t) => t.value === "and")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'or' keyword", () => {
      const tokens = tokenize("Status = Done or Status = Active");
      expect(tokens.find((t) => t.value === "or")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'not' keyword", () => {
      const tokens = tokenize("not Status = Done");
      expect(tokens.find((t) => t.value === "not")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize 'exists' keyword", () => {
      const tokens = tokenize("Due exists");
      expect(tokens.find((t) => t.value === "exists")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize keywords case-insensitively", () => {
      const tokens = tokenize("FIND task WHERE Status = Done");
      expect(tokens[0]).toEqual({ type: TokenType.KEYWORD, value: "find" });
      expect(tokens.find((t) => t.value === "where")?.type).toBe(TokenType.KEYWORD);
    });
  });

  describe("Operators", () => {
    it("should tokenize '=' operator", () => {
      const tokens = tokenize("Status = Done");
      expect(tokens.find((t) => t.value === "=")).toEqual({
        type: TokenType.OPERATOR,
        value: "=",
      });
    });

    it("should tokenize '!=' operator", () => {
      const tokens = tokenize("Status != Done");
      expect(tokens.find((t) => t.value === "!=")).toEqual({
        type: TokenType.OPERATOR,
        value: "!=",
      });
    });

    it("should tokenize '>' operator", () => {
      const tokens = tokenize("Priority > 2");
      expect(tokens.find((t) => t.value === ">")).toEqual({
        type: TokenType.OPERATOR,
        value: ">",
      });
    });

    it("should tokenize '>=' operator", () => {
      const tokens = tokenize("Priority >= 2");
      expect(tokens.find((t) => t.value === ">=")).toEqual({
        type: TokenType.OPERATOR,
        value: ">=",
      });
    });

    it("should tokenize '<' operator", () => {
      const tokens = tokenize("Score < 100");
      expect(tokens.find((t) => t.value === "<")).toEqual({
        type: TokenType.OPERATOR,
        value: "<",
      });
    });

    it("should tokenize '<=' operator", () => {
      const tokens = tokenize("Score <= 100");
      expect(tokens.find((t) => t.value === "<=")).toEqual({
        type: TokenType.OPERATOR,
        value: "<=",
      });
    });

    it("should tokenize '~' operator", () => {
      const tokens = tokenize("Attendees ~ John");
      expect(tokens.find((t) => t.value === "~")).toEqual({
        type: TokenType.OPERATOR,
        value: "~",
      });
    });
  });

  describe("Identifiers", () => {
    it("should tokenize simple identifiers", () => {
      const tokens = tokenize("Status");
      expect(tokens[0]).toEqual({ type: TokenType.IDENTIFIER, value: "Status" });
    });

    it("should tokenize identifiers with dots (field paths)", () => {
      const tokens = tokenize("parent.tags");
      expect(tokens[0]).toEqual({ type: TokenType.IDENTIFIER, value: "parent.tags" });
    });

    it("should tokenize identifiers with underscores", () => {
      const tokens = tokenize("field_name");
      expect(tokens[0]).toEqual({ type: TokenType.IDENTIFIER, value: "field_name" });
    });

    it("should tokenize wildcard '*'", () => {
      const tokens = tokenize("find *");
      expect(tokens[1]).toEqual({ type: TokenType.IDENTIFIER, value: "*" });
    });
  });

  describe("Strings", () => {
    it("should tokenize double-quoted strings", () => {
      const tokens = tokenize('"Hello World"');
      expect(tokens[0]).toEqual({ type: TokenType.STRING, value: "Hello World" });
    });

    it("should tokenize single-quoted strings", () => {
      const tokens = tokenize("'Hello World'");
      expect(tokens[0]).toEqual({ type: TokenType.STRING, value: "Hello World" });
    });

    it("should handle spaces in quoted strings", () => {
      const tokens = tokenize('"Q4 Planning"');
      expect(tokens[0]).toEqual({ type: TokenType.STRING, value: "Q4 Planning" });
    });

    it("should handle escaped quotes in strings", () => {
      const tokens = tokenize('"He said \\"hello\\""');
      expect(tokens[0]).toEqual({ type: TokenType.STRING, value: 'He said "hello"' });
    });

    it("should handle unquoted simple strings after operators", () => {
      const tokens = tokenize("Status = Done");
      expect(tokens[2]).toEqual({ type: TokenType.IDENTIFIER, value: "Done" });
    });
  });

  describe("Numbers", () => {
    it("should tokenize integers", () => {
      const tokens = tokenize("limit 10");
      expect(tokens[1]).toEqual({ type: TokenType.NUMBER, value: 10 });
    });

    it("should tokenize decimals", () => {
      const tokens = tokenize("3.14");
      expect(tokens[0]).toEqual({ type: TokenType.NUMBER, value: 3.14 });
    });

    it("should tokenize negative numbers", () => {
      const tokens = tokenize("-5");
      expect(tokens[0]).toEqual({ type: TokenType.NUMBER, value: -5 });
    });
  });

  describe("Parentheses", () => {
    it("should tokenize opening parenthesis", () => {
      const tokens = tokenize("(Status = Done)");
      expect(tokens[0]).toEqual({ type: TokenType.LPAREN, value: "(" });
    });

    it("should tokenize closing parenthesis", () => {
      const tokens = tokenize("(Status = Done)");
      expect(tokens[tokens.length - 1]).toEqual({ type: TokenType.RPAREN, value: ")" });
    });
  });

  describe("Full Query Tokenization", () => {
    it("should tokenize basic find query", () => {
      const tokens = tokenize("find task");
      expect(tokens).toEqual([
        { type: TokenType.KEYWORD, value: "find" },
        { type: TokenType.IDENTIFIER, value: "task" },
      ]);
    });

    it("should tokenize find with where clause", () => {
      const tokens = tokenize("find task where Status = Done");
      expect(tokens).toHaveLength(6);
      expect(tokens[0]).toEqual({ type: TokenType.KEYWORD, value: "find" });
      expect(tokens[1]).toEqual({ type: TokenType.IDENTIFIER, value: "task" });
      expect(tokens[2]).toEqual({ type: TokenType.KEYWORD, value: "where" });
      expect(tokens[3]).toEqual({ type: TokenType.IDENTIFIER, value: "Status" });
      expect(tokens[4]).toEqual({ type: TokenType.OPERATOR, value: "=" });
      expect(tokens[5]).toEqual({ type: TokenType.IDENTIFIER, value: "Done" });
    });

    it("should tokenize query with order by", () => {
      const tokens = tokenize("find task order by created");
      expect(tokens.map((t) => t.value)).toEqual(["find", "task", "order", "by", "created"]);
    });

    it("should tokenize query with limit and offset", () => {
      const tokens = tokenize("find task limit 20 offset 40");
      expect(tokens.find((t) => t.value === 20)?.type).toBe(TokenType.NUMBER);
      expect(tokens.find((t) => t.value === 40)?.type).toBe(TokenType.NUMBER);
    });

    it("should tokenize complex query with multiple conditions", () => {
      const tokens = tokenize(
        'find meeting where Attendees ~ "John" and created > 2025-01-01 order by -created limit 20'
      );
      expect(tokens.length).toBeGreaterThan(10);
    });

    it("should tokenize query with OR groups", () => {
      const tokens = tokenize("find task where (Status = Done or Status = Active)");
      expect(tokens.filter((t) => t.type === TokenType.LPAREN)).toHaveLength(1);
      expect(tokens.filter((t) => t.type === TokenType.RPAREN)).toHaveLength(1);
      expect(tokens.find((t) => t.value === "or")?.type).toBe(TokenType.KEYWORD);
    });

    it("should tokenize descending order with minus prefix", () => {
      const tokens = tokenize("order by -created");
      expect(tokens.find((t) => t.value === "-created")).toEqual({
        type: TokenType.IDENTIFIER,
        value: "-created",
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle empty input", () => {
      const tokens = tokenize("");
      expect(tokens).toEqual([]);
    });

    it("should handle whitespace-only input", () => {
      const tokens = tokenize("   \t\n  ");
      expect(tokens).toEqual([]);
    });

    it("should throw on unterminated string", () => {
      expect(() => tokenize('"unclosed')).toThrow();
    });
  });
});
