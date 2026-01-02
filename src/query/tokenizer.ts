/**
 * Query Tokenizer
 * Spec 063: Unified Query Language
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
