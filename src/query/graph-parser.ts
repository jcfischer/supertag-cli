/**
 * Graph Query DSL Parser
 * F-102: Graph Query DSL
 *
 * Recursive descent parser for the graph-aware query language.
 * Produces a GraphQueryAST from DSL input strings.
 *
 * Grammar:
 *   graph_query  = FIND identifier where_clause? connected_clause* depth_clause? return_clause
 *   where_clause = WHERE condition (AND condition)*
 *   condition    = field operator value
 *   connected    = CONNECTED TO identifier (VIA field)? (WHERE condition (AND condition)*)?
 *   depth_clause = DEPTH number
 *   return_clause = RETURN return_field (, return_field)*
 *   return_field  = (identifier .)? field | aggregate_fn ( field ) AS identifier
 *   field        = identifier | quoted_string
 *   operator     = = | != | > | < | >= | <= | CONTAINS | LIKE
 */

import { graphTokenize, TokenType, type Token } from "./tokenizer";
import type {
  GraphQueryAST,
  ConnectedClause,
  ProjectionField,
} from "./graph-types";
import type { WhereClause, WhereGroup, QueryOperator } from "./types";

/**
 * Parse error with position information
 */
export class GraphParseError extends Error {
  /** Character offset in the input string */
  readonly position: number;
  /** Expected token description */
  readonly expected: string;
  /** Actual token found */
  readonly got: string;

  constructor(message: string, position: number, expected: string, got: string) {
    const fullMessage = `${message}\n\n` +
      `  Query syntax:\n` +
      `    FIND <supertag> [WHERE <conditions>]\n` +
      `    [CONNECTED TO <supertag> [VIA <field>]]*\n` +
      `    [DEPTH <n>]\n` +
      `    RETURN <field1>, [type.field2], ...\n\n` +
      `  Example: FIND meeting CONNECTED TO person VIA Attendees RETURN name, person.name`;
    super(fullMessage);
    this.name = "GraphParseError";
    this.position = position;
    this.expected = expected;
    this.got = got;
  }
}

/**
 * Recursive descent parser for Graph Query DSL
 */
class GraphParser {
  private tokens: Token[];
  private pos: number;

  constructor(private input: string) {
    this.tokens = graphTokenize(input);
    this.pos = 0;
  }

  /**
   * Parse the full graph query
   */
  parse(): GraphQueryAST {
    if (this.tokens.length === 0) {
      throw new GraphParseError(
        "Empty query",
        0,
        "FIND keyword",
        "end of input"
      );
    }

    const find = this.parseFind();
    let where: (WhereClause | WhereGroup)[] | undefined;
    const connected: ConnectedClause[] = [];
    let depth: number | undefined;
    let limit: number | undefined;

    // Parse optional clauses before RETURN
    while (!this.isAtEnd()) {
      if (this.matchKeyword("where") && connected.length === 0) {
        where = this.parseWhereConditions();
      } else if (this.matchKeyword("connected")) {
        connected.push(this.parseConnected());
      } else if (this.matchKeyword("depth")) {
        depth = this.parseDepth();
      } else if (this.matchKeyword("limit")) {
        limit = this.parseLimit();
      } else if (this.peekKeyword("return")) {
        break;
      } else {
        const current = this.current();
        throw new GraphParseError(
          `Unexpected token '${current.value}' at position ${this.pos}`,
          this.pos,
          "WHERE, CONNECTED TO, DEPTH, LIMIT, or RETURN",
          String(current.value)
        );
      }
    }

    const returnFields = this.parseReturn();

    // Check for trailing limit after RETURN
    if (!this.isAtEnd() && this.matchKeyword("limit")) {
      limit = this.parseLimit();
    }

    return {
      find,
      where,
      connected,
      depth,
      return: returnFields,
      limit,
    };
  }

  // ---------------------------------------------------------------------------
  // Clause parsers
  // ---------------------------------------------------------------------------

  private parseFind(): string {
    this.expectKeyword("find");
    return this.expectIdentifierOrString("supertag name after FIND");
  }

  private parseWhereConditions(): (WhereClause | WhereGroup)[] {
    const conditions: WhereClause[] = [];
    conditions.push(this.parseCondition());

    while (this.matchKeyword("and")) {
      conditions.push(this.parseCondition());
    }

    return conditions;
  }

  private parseCondition(): WhereClause {
    const field = this.expectIdentifierOrString("field name in WHERE");
    const operator = this.parseOperator();
    const value = this.parseValue();

    return { field, operator, value };
  }

  private parseOperator(): QueryOperator {
    // Check for keyword operators first
    if (this.matchKeyword("contains")) {
      return "contains";
    }
    if (this.matchKeyword("like")) {
      return "~";
    }

    if (this.isAtEnd()) {
      throw new GraphParseError(
        "Expected operator",
        this.pos,
        "operator (=, !=, >, <, >=, <=, CONTAINS, LIKE)",
        "end of input"
      );
    }

    const token = this.current();
    if (token.type === TokenType.OPERATOR) {
      this.advance();
      return token.value as QueryOperator;
    }

    throw new GraphParseError(
      `Expected operator, got '${token.value}'`,
      this.pos,
      "operator (=, !=, >, <, >=, <=, CONTAINS, LIKE)",
      String(token.value)
    );
  }

  private parseValue(): string | number {
    if (this.isAtEnd()) {
      throw new GraphParseError(
        "Expected value",
        this.pos,
        "value (string, number, or identifier)",
        "end of input"
      );
    }

    const token = this.current();

    if (token.type === TokenType.STRING) {
      this.advance();
      return token.value as string;
    }

    if (token.type === TokenType.NUMBER) {
      this.advance();
      return token.value as number;
    }

    if (token.type === TokenType.IDENTIFIER) {
      this.advance();
      return token.value as string;
    }

    // Allow keywords as values (e.g., WHERE Status = null)
    if (token.type === TokenType.KEYWORD) {
      this.advance();
      return token.value as string;
    }

    throw new GraphParseError(
      `Expected value, got '${token.value}'`,
      this.pos,
      "value (string, number, or identifier)",
      String(token.value)
    );
  }

  private parseConnected(): ConnectedClause {
    // "CONNECTED" was already consumed; expect "TO"
    this.expectKeyword("to");
    const toTag = this.expectIdentifierOrString("supertag name after CONNECTED TO");

    let viaField: string | undefined;
    let where: (WhereClause | WhereGroup)[] | undefined;

    // Optional VIA
    if (this.matchKeyword("via")) {
      viaField = this.expectIdentifierOrString("field name after VIA");
    }

    // Optional WHERE on the connected type
    if (this.matchKeyword("where")) {
      where = this.parseWhereConditions();
    }

    return { toTag, viaField, where };
  }

  private parseDepth(): number {
    if (this.isAtEnd()) {
      throw new GraphParseError(
        "Expected number after DEPTH",
        this.pos,
        "number",
        "end of input"
      );
    }

    const token = this.current();
    if (token.type === TokenType.NUMBER) {
      this.advance();
      return token.value as number;
    }

    throw new GraphParseError(
      `Expected number after DEPTH, got '${token.value}'`,
      this.pos,
      "number",
      String(token.value)
    );
  }

  private parseLimit(): number {
    if (this.isAtEnd()) {
      throw new GraphParseError(
        "Expected number after LIMIT",
        this.pos,
        "number",
        "end of input"
      );
    }

    const token = this.current();
    if (token.type === TokenType.NUMBER) {
      this.advance();
      return token.value as number;
    }

    throw new GraphParseError(
      `Expected number after LIMIT, got '${token.value}'`,
      this.pos,
      "number",
      String(token.value)
    );
  }

  private parseReturn(): ProjectionField[] {
    this.expectKeyword("return");

    const fields: ProjectionField[] = [];
    fields.push(this.parseProjectionField());

    while (this.matchToken(TokenType.COMMA)) {
      fields.push(this.parseProjectionField());
    }

    return fields;
  }

  private parseProjectionField(): ProjectionField {
    if (this.isAtEnd()) {
      throw new GraphParseError(
        "Expected field name in RETURN clause",
        this.pos,
        "field name or aggregate function",
        "end of input"
      );
    }

    const token = this.current();

    // Check for RETURN * (wildcard)
    if (token.type === TokenType.IDENTIFIER && token.value === "*") {
      this.advance();
      return { fieldName: "*" };
    }

    // Check for aggregate functions: COUNT(field) AS alias
    if (token.type === TokenType.KEYWORD && ["count", "sum", "avg"].includes(token.value as string)) {
      return this.parseAggregate();
    }

    // Regular field or dot-notation: identifier or identifier.identifier
    const name = this.expectIdentifierOrString("field name in RETURN");

    // Check for dot notation: person.name
    if (this.matchToken(TokenType.DOT)) {
      const fieldName = this.expectIdentifierOrString("field name after dot");
      return { typeAlias: name, fieldName };
    }

    return { fieldName: name };
  }

  private parseAggregate(): ProjectionField {
    const fn = this.current().value as string;
    this.advance(); // consume function name

    this.expectToken(TokenType.LPAREN, "(");
    const fieldName = this.expectIdentifierOrString("field name in aggregate");
    this.expectToken(TokenType.RPAREN, ")");

    this.expectKeyword("as");
    const alias = this.expectIdentifierOrString("alias after AS");

    return {
      fieldName,
      aggregateFn: fn.toUpperCase() as "COUNT" | "SUM" | "AVG",
      alias,
    };
  }

  // ---------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------

  private current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private matchKeyword(keyword: string): boolean {
    if (
      !this.isAtEnd() &&
      this.current().type === TokenType.KEYWORD &&
      this.current().value === keyword
    ) {
      this.advance();
      return true;
    }
    return false;
  }

  private peekKeyword(keyword: string): boolean {
    return (
      !this.isAtEnd() &&
      this.current().type === TokenType.KEYWORD &&
      this.current().value === keyword
    );
  }

  private matchToken(type: TokenType): boolean {
    if (!this.isAtEnd() && this.current().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      const got = this.isAtEnd()
        ? "end of input"
        : `'${this.current().value}'`;
      throw new GraphParseError(
        `Expected '${keyword.toUpperCase()}'`,
        this.pos,
        `${keyword.toUpperCase()} keyword`,
        got
      );
    }
  }

  private expectToken(type: TokenType, description: string): void {
    if (!this.matchToken(type)) {
      const got = this.isAtEnd()
        ? "end of input"
        : `'${this.current().value}'`;
      throw new GraphParseError(
        `Expected '${description}'`,
        this.pos,
        description,
        got
      );
    }
  }

  private expectIdentifierOrString(context: string): string {
    if (this.isAtEnd()) {
      throw new GraphParseError(
        `Expected ${context}`,
        this.pos,
        context,
        "end of input"
      );
    }

    const token = this.current();

    if (token.type === TokenType.IDENTIFIER || token.type === TokenType.STRING) {
      this.advance();
      return token.value as string;
    }

    // Allow keywords as identifiers in certain contexts (tag/field names that happen to be keywords)
    if (token.type === TokenType.KEYWORD) {
      this.advance();
      return token.value as string;
    }

    throw new GraphParseError(
      `Expected ${context}, got '${token.value}'`,
      this.pos,
      context,
      String(token.value)
    );
  }
}

/**
 * Parse a graph query DSL string into a GraphQueryAST
 *
 * @param input - Graph query DSL string
 * @returns Parsed GraphQueryAST
 * @throws GraphParseError on syntax errors
 */
export function parseGraphQuery(input: string): GraphQueryAST {
  const parser = new GraphParser(input);
  return parser.parse();
}
