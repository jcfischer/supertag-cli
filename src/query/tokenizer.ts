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

  function readNumber(): number {
    let numStr = "";

    // Handle negative numbers
    if (peek() === "-") {
      numStr += advance();
    }

    // Read digits and decimal point
    while (pos < input.length && /[\d.]/.test(peek())) {
      numStr += advance();
    }

    return parseFloat(numStr);
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

    // Read identifier: letters, digits, underscores, dots
    while (pos < input.length && /[a-zA-Z0-9_.]/.test(peek())) {
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

    // Numbers (including negative)
    if (/\d/.test(char) || (char === "-" && /\d/.test(peek(1)))) {
      const value = readNumber();
      tokens.push({ type: TokenType.NUMBER, value });
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
