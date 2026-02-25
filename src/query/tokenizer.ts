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
 * Configuration for the shared tokenizer core
 */
interface TokenizerConfig {
  /** Set of keywords to recognize */
  keywords: Set<string>;
  /** Whether to emit DOT tokens (graph DSL) or consume dots in identifiers */
  emitDot: boolean;
  /** Whether to parse dates and relative date suffixes (Spec 063) */
  parseDates: boolean;
  /** Whether identifiers can start with a leading minus (for order by -created) */
  allowLeadingMinus: boolean;
}

/**
 * Shared tokenizer core — configurable for both Spec 063 and Graph DSL
 */
function tokenizeWithConfig(input: string, config: TokenizerConfig): Token[] {
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

  function readNumber(): Token {
    let value = "";

    if (peek() === "-") {
      value += advance();
    }

    while (pos < input.length && /[\d.]/.test(peek())) {
      value += advance();
    }

    if (config.parseDates) {
      // Check for relative date suffix (d, w, m, y) - must not be followed by more alphanums
      if (/[dwmy]/.test(peek()) && !/[a-zA-Z0-9]/.test(peek(1))) {
        value += advance();
        return { type: TokenType.IDENTIFIER, value };
      }

      // Check for ISO date format: YYYY-MM-DD or datetime
      if (value.length === 4 && peek() === "-" && /\d/.test(peek(1))) {
        while (pos < input.length && /[\d\-:TZ+.]/.test(peek())) {
          value += advance();
        }
        return { type: TokenType.IDENTIFIER, value };
      }
    }

    return { type: TokenType.NUMBER, value: parseFloat(value) };
  }

  function readIdentifier(): string {
    let value = "";

    // Allow leading minus for order by -created (Spec 063 only)
    if (config.allowLeadingMinus && peek() === "-") {
      value += advance();
    }

    // Allow * as a standalone identifier
    if (peek() === "*") {
      return advance();
    }

    // Read identifier characters — dots included only when NOT emitting DOT tokens
    const identPattern = config.emitDot ? /[a-zA-Z0-9_-]/ : /[a-zA-Z0-9_.:-]/;
    while (pos < input.length && identPattern.test(peek())) {
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

    // Dot (graph DSL: emit as DOT token for person.name notation)
    if (config.emitDot && char === ".") {
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

    // Numbers (and optionally dates/relative dates)
    if (/\d/.test(char) || (char === "-" && /\d/.test(peek(1)))) {
      tokens.push(readNumber());
      continue;
    }

    // Identifiers and keywords
    const identStart = config.allowLeadingMinus ? /[a-zA-Z_*-]/ : /[a-zA-Z_*]/;
    if (identStart.test(char)) {
      const value = readIdentifier();
      const lower = value.toLowerCase();

      if (config.keywords.has(lower)) {
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

/**
 * Tokenize a query string into tokens (Spec 063: Unified Query Language)
 *
 * @param input - Query string to tokenize
 * @returns Array of tokens
 * @throws Error on syntax errors (unterminated strings, invalid characters)
 */
export function tokenize(input: string): Token[] {
  return tokenizeWithConfig(input, {
    keywords: KEYWORDS,
    emitDot: false,
    parseDates: true,
    allowLeadingMinus: true,
  });
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
 * Uses graph DSL keyword set, emits DOT tokens for dot-notation
 * field access (e.g., person.name), and uses simpler number parsing
 * (no date/relative date support).
 *
 * @param input - Graph query string to tokenize
 * @returns Array of tokens
 * @throws Error on syntax errors (unterminated strings, invalid characters)
 */
export function graphTokenize(input: string): Token[] {
  return tokenizeWithConfig(input, {
    keywords: GRAPH_KEYWORDS,
    emitDot: true,
    parseDates: false,
    allowLeadingMinus: false,
  });
}
