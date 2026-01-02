/**
 * Query Parser
 * Spec 063: Unified Query Language
 *
 * Recursive descent parser for CLI query strings.
 *
 * Grammar (simplified):
 *   query       = "find" target [where_clause] [order_clause] [limit_clause] [offset_clause] [select_clause]
 *   target      = identifier | "*"
 *   where_clause = "where" condition ("and" condition)*
 *   condition   = ["not"] field operator value | field "exists"
 *   order_clause = "order" "by" ("-")?field
 *   limit_clause = "limit" number
 *   offset_clause = "offset" number
 *   select_clause = "select" field_list
 */

import { tokenize, TokenType, type Token } from "./tokenizer";
import type { QueryAST, WhereClause, WhereGroup, QueryOperator } from "./types";

/**
 * Parse error with position information
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public position?: number
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Parser state
 */
class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(input: string) {
    this.tokens = tokenize(input);
  }

  /**
   * Get current token
   */
  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  /**
   * Peek ahead
   */
  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  /**
   * Consume current token and advance
   */
  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }

  /**
   * Check if at end of tokens
   */
  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  /**
   * Check if current token matches type and optionally value
   */
  private match(type: TokenType, value?: string | number): boolean {
    const token = this.current();
    if (!token || token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    return true;
  }

  /**
   * Expect a token of given type and value, or throw
   */
  private expect(type: TokenType, value?: string | number): Token {
    const token = this.current();
    if (!token) {
      throw new ParseError(`Unexpected end of input, expected ${type}${value ? ` '${value}'` : ""}`);
    }
    if (token.type !== type) {
      throw new ParseError(`Expected ${type}, got ${token.type} '${token.value}'`);
    }
    if (value !== undefined && token.value !== value) {
      throw new ParseError(`Expected '${value}', got '${token.value}'`);
    }
    return this.advance()!;
  }

  /**
   * Parse the query
   */
  parse(): QueryAST {
    // Expect "find" keyword
    this.expect(TokenType.KEYWORD, "find");

    // Parse target (supertag name or *)
    const targetToken = this.current();
    if (!targetToken || (targetToken.type !== TokenType.IDENTIFIER)) {
      throw new ParseError("Expected supertag name after 'find'");
    }
    this.advance();

    const ast: QueryAST = {
      find: String(targetToken.value),
    };

    // Parse optional clauses
    while (!this.isAtEnd()) {
      const token = this.current();
      if (!token || token.type !== TokenType.KEYWORD) break;

      switch (token.value) {
        case "where":
          ast.where = this.parseWhereClause();
          break;
        case "order":
          ast.orderBy = this.parseOrderByClause();
          break;
        case "limit":
          this.advance();
          const limitToken = this.expect(TokenType.NUMBER);
          ast.limit = Number(limitToken.value);
          break;
        case "offset":
          this.advance();
          const offsetToken = this.expect(TokenType.NUMBER);
          ast.offset = Number(offsetToken.value);
          break;
        case "select":
          ast.select = this.parseSelectClause();
          break;
        default:
          // Unknown keyword, stop parsing
          throw new ParseError(`Unexpected keyword '${token.value}'`);
      }
    }

    return ast;
  }

  /**
   * Parse where clause: "where" condition ("and" condition)*
   */
  private parseWhereClause(): (WhereClause | WhereGroup)[] {
    this.expect(TokenType.KEYWORD, "where");

    const conditions: WhereClause[] = [];

    // Parse first condition
    conditions.push(this.parseCondition());

    // Parse additional conditions with "and"
    while (this.match(TokenType.KEYWORD, "and")) {
      this.advance(); // consume "and"
      conditions.push(this.parseCondition());
    }

    return conditions;
  }

  /**
   * Parse single condition: ["not"] field operator value | field "exists"
   */
  private parseCondition(): WhereClause {
    let negated = false;

    // Check for "not"
    if (this.match(TokenType.KEYWORD, "not")) {
      this.advance();
      negated = true;
    }

    // Parse field name
    const fieldToken = this.current();
    if (!fieldToken || fieldToken.type !== TokenType.IDENTIFIER) {
      throw new ParseError("Expected field name in where clause");
    }
    this.advance();
    const field = String(fieldToken.value);

    // Check for "exists" keyword
    if (this.match(TokenType.KEYWORD, "exists")) {
      this.advance();
      return {
        field,
        operator: "exists",
        value: true,
        negated: negated || undefined,
      };
    }

    // Parse operator
    const opToken = this.current();
    if (!opToken || opToken.type !== TokenType.OPERATOR) {
      throw new ParseError(`Expected operator after field '${field}'`);
    }
    this.advance();
    const operator = this.mapOperator(String(opToken.value));

    // Parse value
    const valueToken = this.current();
    if (!valueToken) {
      throw new ParseError(`Expected value after operator '${opToken.value}'`);
    }

    let value: string | number;
    if (valueToken.type === TokenType.STRING) {
      value = String(valueToken.value);
      this.advance();
    } else if (valueToken.type === TokenType.NUMBER) {
      value = Number(valueToken.value);
      this.advance();
    } else if (valueToken.type === TokenType.IDENTIFIER) {
      // Unquoted value (identifier-like)
      value = String(valueToken.value);
      this.advance();
    } else {
      throw new ParseError(`Unexpected token type ${valueToken.type} for value`);
    }

    return {
      field,
      operator,
      value,
      negated: negated || undefined,
    };
  }

  /**
   * Map token operator to QueryOperator
   */
  private mapOperator(op: string): QueryOperator {
    const mapping: Record<string, QueryOperator> = {
      "=": "=",
      "!=": "!=",
      ">": ">",
      "<": "<",
      ">=": ">=",
      "<=": "<=",
      "~": "~",
    };
    if (!(op in mapping)) {
      throw new ParseError(`Unknown operator: ${op}`);
    }
    return mapping[op];
  }

  /**
   * Parse order by clause: "order" "by" ("-")?field
   */
  private parseOrderByClause(): { field: string; desc: boolean } {
    this.expect(TokenType.KEYWORD, "order");
    this.expect(TokenType.KEYWORD, "by");

    const fieldToken = this.current();
    if (!fieldToken || fieldToken.type !== TokenType.IDENTIFIER) {
      throw new ParseError("Expected field name after 'order by'");
    }
    this.advance();

    let field = String(fieldToken.value);
    let desc = false;

    // Check for descending prefix
    if (field.startsWith("-")) {
      desc = true;
      field = field.substring(1);
    }

    return { field, desc };
  }

  /**
   * Parse select clause: "select" field_list
   */
  private parseSelectClause(): string[] {
    this.expect(TokenType.KEYWORD, "select");

    const fields: string[] = [];

    const token = this.current();
    if (!token) {
      throw new ParseError("Expected field name after 'select'");
    }

    if (token.type === TokenType.STRING) {
      // Quoted comma-separated list
      const value = String(token.value);
      this.advance();
      fields.push(...value.split(",").map((f) => f.trim()).filter(Boolean));
    } else if (token.type === TokenType.IDENTIFIER) {
      // Single field
      fields.push(String(token.value));
      this.advance();
    } else {
      throw new ParseError(`Unexpected token type ${token.type} for select`);
    }

    return fields;
  }
}

/**
 * Parse a query string into an AST
 *
 * @param input - Query string (e.g., "find task where Status = Done order by -created limit 20")
 * @returns Parsed QueryAST
 * @throws ParseError on syntax errors
 */
export function parseQuery(input: string): QueryAST {
  const parser = new Parser(input);
  return parser.parse();
}
