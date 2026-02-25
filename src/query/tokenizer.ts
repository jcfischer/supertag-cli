/**
 * Query Tokenizer
 * Spec 063: Unified Query Language
 * F-102: Graph Query DSL (extended keywords)
 *
 * Tokenizes CLI query strings into a stream of tokens for parsing.
 */

/**
 * Token types produced by the tokenizer
 */
export enum TokenType {
  KEYWORD = "KEYWORD",       // find, where, order, by, limit, offset, and, or, not, exists
  OPERATOR = "OPERATOR",     // =, !=, >, <, >=, <=, ~
  IDENTIFIER = "IDENTIFIER", // field names, tag names, values
  STRING = "STRING",         // quoted strings
  NUMBER = "NUMBER",         // numeric values
  LPAREN = "LPAREN",         // (
  RPAREN = "RPAREN",         // )
  COMMA = "COMMA",           // , (for select field lists)
  DOT = "DOT",               // . (for dot-notation field access, e.g., person.name)
}

/**
 * Token produced by the tokenizer
 */
export interface Token {
  type: TokenType;
  value: string | number;
}

/**
 * Keywords recognized by the query language
 */
const KEYWORDS = new Set([
  "find",
  "where",
  "order",
  "by",
  "limit",
  "offset",
  "and",
  "or",
  "not",
  "exists",
  "select",
  "is",
  "empty",
  "null",
]);

/**
 * Multi-character operators (must check before single-char)
 */
const MULTI_CHAR_OPERATORS = ["!=", ">=", "<="];

/**
 * Single-character operators
 */
const SINGLE_CHAR_OPERATORS = new Set(["=", ">", "<", "~"]);

/**
 * Tokenize a query string into tokens
 *
 * @param input - Query string to tokenize
 * @returns Array of tokens
 * @throws Error on syntax errors (unterminated strings, invalid characters)
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  function peek(offset = 0): string {
    return input[pos + offset] ?? "";
  }

  function advance(): string {
    return input[pos++] ?? "";
  }

  function skipWhitespace(): void {
    while (pos < input.length && /\s/.test(peek())) {
      advance();
    }
  }

  function readString(quote: string): string {
    advance(); // consume opening quote
    let value = "";

    while (pos < input.length) {
      const char = peek();

      if (char === "\\") {
        // Escape sequence
        advance();
        const escaped = advance();
        if (escaped === quote) {
          value += quote;
        } else if (escaped === "n") {
          value += "\n";
        } else if (escaped === "t") {
          value += "\t";
        } else if (escaped === "\\") {
          value += "\\";
        } else {
          value += escaped;
        }
      } else if (char === quote) {
        advance(); // consume closing quote
        return value;
      } else {
        value += advance();
      }
    }

    throw new Error(`Unterminated string starting at position ${pos}`);
  }

  function readNumberOrDateOrRelative(): Token {
    let value = "";

    // Handle negative numbers
    if (peek() === "-") {
      value += advance();
    }

    // Read digits and decimal point
    while (pos < input.length && /[\d.]/.test(peek())) {
      value += advance();
    }

    // Check for relative date suffix (d, w, m, y) - must not be followed by more alphanums
    if (/[dwmy]/.test(peek()) && !/[a-zA-Z0-9]/.test(peek(1))) {
      value += advance();
      return { type: TokenType.IDENTIFIER, value };
    }

    // Check for ISO date format: YYYY-MM-DD or datetime
    // If we have 4 digits followed by a hyphen, it's likely a date
    if (value.length === 4 && peek() === "-" && /\d/.test(peek(1))) {
      // Read the rest of the date/datetime
      while (pos < input.length && /[\d\-:TZ+.]/.test(peek())) {
        value += advance();
      }
      return { type: TokenType.IDENTIFIER, value };
    }

    return { type: TokenType.NUMBER, value: parseFloat(value) };
  }

  function readIdentifier(): string {
    let value = "";

    // Allow leading minus for order by -created
    if (peek() === "-") {
      value += advance();
    }

    // Allow * as a standalone identifier
    if (peek() === "*") {
      return advance();
    }

    // Read identifier: letters, digits, underscores, dots, and hyphens (for dates)
    while (pos < input.length && /[a-zA-Z0-9_.:-]/.test(peek())) {
      value += advance();
    }

    return value;
  }

  while (pos < input.length) {
    skipWhitespace();

    if (pos >= input.length) {
      break;
    }

    const char = peek();

    // Parentheses
    if (char === "(") {
      advance();
      tokens.push({ type: TokenType.LPAREN, value: "(" });
      continue;
    }

    if (char === ")") {
      advance();
      tokens.push({ type: TokenType.RPAREN, value: ")" });
      continue;
    }

    // Comma (for select field lists)
    if (char === ",") {
      advance();
      tokens.push({ type: TokenType.COMMA, value: "," });
      continue;
    }

    // Quoted strings
    if (char === '"' || char === "'") {
      const value = readString(char);
      tokens.push({ type: TokenType.STRING, value });
      continue;
    }

    // Multi-character operators (check first)
    let matchedOperator = false;
    for (const op of MULTI_CHAR_OPERATORS) {
      if (input.slice(pos, pos + op.length) === op) {
        tokens.push({ type: TokenType.OPERATOR, value: op });
        pos += op.length;
        matchedOperator = true;
        break;
      }
    }
    if (matchedOperator) continue;

    // Single-character operators
    if (SINGLE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: TokenType.OPERATOR, value: char });
      advance();
      continue;
    }

    // Numbers, relative dates (7d, 2w), or ISO dates (2025-01-01)
    if (/\d/.test(char) || (char === "-" && /\d/.test(peek(1)))) {
      tokens.push(readNumberOrDateOrRelative());
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_*-]/.test(char)) {
      const value = readIdentifier();
      const lower = value.toLowerCase();

      if (KEYWORDS.has(lower)) {
        tokens.push({ type: TokenType.KEYWORD, value: lower });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value });
      }
      continue;
    }

    // Unknown character - skip (or throw if strict)
    advance();
  }

  return tokens;
}

// =============================================================================
// Graph Query DSL Tokenizer (F-102)
// =============================================================================

/**
 * Extended keywords for graph query DSL
 * Includes all Spec 063 keywords plus graph-specific ones.
 */
const GRAPH_KEYWORDS = new Set([
  // Spec 063 keywords (shared)
  "find",
  "where",
  "and",
  "or",
  "not",
  "is",
  "null",
  // Graph DSL keywords (F-102)
  "connected",
  "to",
  "via",
  "return",
  "depth",
  "contains",
  "like",
  "as",
  "count",
  "sum",
  "avg",
  "limit",
]);

/**
 * Tokenize a graph query string into tokens
 *
 * Similar to tokenize() but uses graph DSL keyword set and
 * emits DOT tokens for dot-notation field access (e.g., person.name).
 *
 * @param input - Graph query string to tokenize
 * @returns Array of tokens
 * @throws Error on syntax errors (unterminated strings, invalid characters)
 */
export function graphTokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  function peek(offset = 0): string {
    return input[pos + offset] ?? "";
  }

  function advance(): string {
    return input[pos++] ?? "";
  }

  function skipWhitespace(): void {
    while (pos < input.length && /\s/.test(peek())) {
      advance();
    }
  }

  function readString(quote: string): string {
    advance(); // consume opening quote
    let value = "";

    while (pos < input.length) {
      const char = peek();

      if (char === "\\") {
        advance();
        const escaped = advance();
        if (escaped === quote) {
          value += quote;
        } else if (escaped === "n") {
          value += "\n";
        } else if (escaped === "t") {
          value += "\t";
        } else if (escaped === "\\") {
          value += "\\";
        } else {
          value += escaped;
        }
      } else if (char === quote) {
        advance(); // consume closing quote
        return value;
      } else {
        value += advance();
      }
    }

    throw new Error(`Unterminated string starting at position ${pos}`);
  }

  function readNumber(): Token {
    let value = "";

    if (peek() === "-") {
      value += advance();
    }

    while (pos < input.length && /[\d.]/.test(peek())) {
      value += advance();
    }

    return { type: TokenType.NUMBER, value: parseFloat(value) };
  }

  function readIdentifier(): string {
    let value = "";

    // Allow * as a standalone identifier (for RETURN *)
    if (peek() === "*") {
      return advance();
    }

    // Read identifier: letters, digits, underscores, hyphens
    // Note: dots are NOT consumed here — they become DOT tokens for graph DSL
    while (pos < input.length && /[a-zA-Z0-9_-]/.test(peek())) {
      value += advance();
    }

    return value;
  }

  while (pos < input.length) {
    skipWhitespace();

    if (pos >= input.length) {
      break;
    }

    const char = peek();

    // Parentheses
    if (char === "(") {
      advance();
      tokens.push({ type: TokenType.LPAREN, value: "(" });
      continue;
    }

    if (char === ")") {
      advance();
      tokens.push({ type: TokenType.RPAREN, value: ")" });
      continue;
    }

    // Comma
    if (char === ",") {
      advance();
      tokens.push({ type: TokenType.COMMA, value: "," });
      continue;
    }

    // Dot (for person.name notation)
    if (char === ".") {
      advance();
      tokens.push({ type: TokenType.DOT, value: "." });
      continue;
    }

    // Quoted strings
    if (char === '"' || char === "'") {
      const value = readString(char);
      tokens.push({ type: TokenType.STRING, value });
      continue;
    }

    // Multi-character operators
    let matchedOperator = false;
    for (const op of MULTI_CHAR_OPERATORS) {
      if (input.slice(pos, pos + op.length) === op) {
        tokens.push({ type: TokenType.OPERATOR, value: op });
        pos += op.length;
        matchedOperator = true;
        break;
      }
    }
    if (matchedOperator) continue;

    // Single-character operators
    if (SINGLE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: TokenType.OPERATOR, value: char });
      advance();
      continue;
    }

    // Numbers
    if (/\d/.test(char) || (char === "-" && /\d/.test(peek(1)))) {
      tokens.push(readNumber());
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_*]/.test(char)) {
      const value = readIdentifier();
      const lower = value.toLowerCase();

      if (GRAPH_KEYWORDS.has(lower)) {
        tokens.push({ type: TokenType.KEYWORD, value: lower });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value });
      }
      continue;
    }

    // Unknown character - skip
    advance();
  }

  return tokens;
}
