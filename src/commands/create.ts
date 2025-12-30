/**
 * Create Command
 * Create any supertag node dynamically using schema registry
 *
 * Uses shared node-builder module for validation and payload building.
 */

import { readFileSync, existsSync } from 'fs';
import { readStdin, hasStdinData } from '../parsers/stdin';
import { parseJsonSmart } from '../parsers/json';
import { getConfig } from '../config/manager';
import { getSchemaRegistry } from './schema';
import { exitWithError, ParseError, ConfigError } from '../utils/errors';
import { createNode } from '../services/node-builder';
import type { ChildNodeInput } from '../types';

/**
 * Child node for references or URLs
 * @deprecated Use ChildNodeInput from '../types' instead
 */
export interface ChildNode {
  name: string;
  id?: string;
  dataType?: 'url' | 'reference';
}

/**
 * Create command options
 */
export interface CreateOptions {
  target?: string;
  token?: string;
  dryRun?: boolean;
  verbose?: boolean;
  file?: string;    // JSON file path
  json?: string;    // Direct JSON string
  children?: string[];  // Child nodes (text or JSON format)
  // Dynamic field options - parsed from unknown options
  [key: string]: unknown;
}

/**
 * Parse dynamic field options from command line args
 * Handles --field-name "value" format
 */
function parseFieldOptions(options: CreateOptions): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  const knownOptions = ['target', 'token', 'dryRun', 'verbose', 'dry-run', 'file', 'json', 'children', 'child'];

  for (const [key, value] of Object.entries(options)) {
    if (knownOptions.includes(key)) continue;
    if (value === undefined || value === null) continue;

    // Normalize key to match field names
    const fieldName = key;
    fields[fieldName] = String(value);
  }

  return fields;
}

/**
 * Recursively parse a child node object (from JSON)
 */
function parseChildObject(obj: Record<string, unknown>): ChildNodeInput | null {
  if (!obj.name || typeof obj.name !== 'string') return null;

  const child: ChildNodeInput = { name: obj.name };

  if (typeof obj.id === 'string') {
    child.id = obj.id;
  }
  if (obj.dataType === 'url' || obj.dataType === 'reference') {
    child.dataType = obj.dataType;
  }

  // Recursively parse nested children
  if (Array.isArray(obj.children)) {
    const nestedChildren: ChildNodeInput[] = [];
    for (const nestedChild of obj.children) {
      if (typeof nestedChild === 'object' && nestedChild !== null) {
        const parsed = parseChildObject(nestedChild as Record<string, unknown>);
        if (parsed) nestedChildren.push(parsed);
      }
    }
    if (nestedChildren.length > 0) {
      child.children = nestedChildren;
    }
  }

  return child;
}

/**
 * Parse children from command line
 * Supports multiple formats:
 * - Simple text: "Child node name"
 * - JSON object: '{"name": "Child", "id": "abc123"}'
 * - JSON object with URL: '{"name": "https://...", "dataType": "url"}'
 * - JSON object with nested children: '{"name": "Section", "children": [{"name": "Item"}]}'
 * - Inline reference syntax in text: "See [[Node Name]]" or "[[Name^nodeId]]"
 */
function parseChildren(childrenStrings: string[]): ChildNodeInput[] {
  const children: ChildNodeInput[] = [];

  for (const str of childrenStrings) {
    const trimmed = str.trim();
    if (!trimmed) continue;

    // Try to parse as JSON first
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const child = parseChildObject(parsed);
        if (child) {
          children.push(child);
        }
        continue;
      } catch {
        // Not valid JSON, treat as plain text
      }
    }

    // Plain text child node (may contain [[inline references]])
    children.push({ name: trimmed });
  }

  return children;
}

/**
 * Read JSON from file
 */
function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw new ParseError(`File not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  return parseJsonSmart(content) as Record<string, unknown>;
}

/**
 * Execute create command
 * @param supertag Supertag name
 * @param name Node name
 * @param options Command options
 */
export async function createCommand(
  supertag: string | undefined,
  name: string | undefined,
  options: CreateOptions,
): Promise<void> {
  try {
    // Load configuration
    const configManager = getConfig();
    const config = configManager.getConfig();

    // Get API token (CLI flag > env var > config file)
    const apiToken = options.token || config.apiToken;
    if (!apiToken && !options.dryRun) {
      throw new ConfigError(
        'API token not configured. Set it via:\n\n' +
        '  Environment variable:\n' +
        '    export TANA_API_TOKEN="your_token_here"\n\n' +
        '  Config file:\n' +
        '    tana config --token your_token_here\n\n' +
        '  CLI flag:\n' +
        '    tana create <supertag> "Name" --token your_token_here\n\n' +
        'Get your token from: https://app.tana.inc/?bundle=settings&panel=api'
      );
    }

    // Get target node
    const targetNode = options.target || config.defaultTargetNode;
    const apiEndpoint = config.apiEndpoint;

    // Load schema registry
    const registry = getSchemaRegistry();
    const supertags = registry.listSupertags();

    if (supertags.length === 0) {
      throw new ConfigError(
        'Schema registry is empty. Sync it first:\n\n' +
        '  tana schema sync\n\n' +
        'Or specify a Tana export path:\n' +
        '  tana schema sync /path/to/export.json'
      );
    }

    // Check if supertag is provided
    if (!supertag) {
      console.error('Usage: supertag create <supertag> <name> [--field value...]');
      console.error('       supertag create <tag1,tag2,...> <name> [--field value...]');
      console.error('');
      console.error('Available supertags:');
      supertags
        .slice(0, 20)
        .forEach(s => console.error(`  ${s.name}`));
      if (supertags.length > 20) {
        console.error(`  ... and ${supertags.length - 20} more`);
        console.error('');
        console.error('Use "supertag schema list" to see all supertags');
        console.error('Use "supertag schema show <name>" to see fields');
      }
      process.exit(1);
    }

    // Parse supertags (handle comma-separated)
    const supertagNames = supertag.includes(',')
      ? supertag.split(',').map(s => s.trim()).filter(s => s.length > 0)
      : [supertag];

    // Validate all supertags exist and collect schemas
    const schemas: Array<{ id: string; name: string; fields: Array<{ attributeId: string }> }> = [];
    for (const tagName of supertagNames) {
      const schema = registry.getSupertag(tagName);
      if (!schema) {
        console.error(`❌ Unknown supertag: ${tagName}`);
        console.error('');
        const similar = registry.searchSupertags(tagName);
        if (similar.length > 0) {
          console.error('Did you mean:');
          similar.slice(0, 5).forEach(s => console.error(`  - ${s.name}`));
        }
        process.exit(1);
      }
      schemas.push(schema);
    }

    // Use first schema as primary for display purposes
    const primarySchema = schemas[0];

    // Determine input source: --file > --json > stdin > CLI args
    let nodeName: string = '';
    let fieldValues: Record<string, string | string[]> = {};
    let inputSource = 'cli';

    // Priority 1: File input
    if (options.file) {
      if (options.verbose) {
        console.error(`📁 Reading JSON from file: ${options.file}`);
      }
      const jsonObj = readJsonFile(options.file);
      const obj = Array.isArray(jsonObj) ? jsonObj[0] : jsonObj;
      nodeName = extractName(obj as Record<string, unknown>);
      fieldValues = extractFieldsFromJson(obj as Record<string, unknown>);
      inputSource = 'file';
    }
    // Priority 2: Direct JSON string
    else if (options.json) {
      if (options.verbose) {
        console.error('📄 Parsing JSON from --json argument...');
      }
      const json = parseJsonSmart(options.json);
      const jsonObj = Array.isArray(json) ? json[0] : json;
      nodeName = extractName(jsonObj as Record<string, unknown>);
      fieldValues = extractFieldsFromJson(jsonObj as Record<string, unknown>);
      inputSource = 'json-arg';
    }
    // Priority 3: Stdin
    else if (hasStdinData()) {
      // Try to read with a short timeout to detect empty stdin
      try {
        const input = await Promise.race([
          readStdin(),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 100)),
        ]);

        if (input.trim()) {
          if (options.verbose) {
            console.error('📄 Parsing JSON from stdin...');
          }
          const json = parseJsonSmart(input);
          const jsonObj = Array.isArray(json) ? json[0] : json;
          nodeName = extractName(jsonObj as Record<string, unknown>);
          fieldValues = extractFieldsFromJson(jsonObj as Record<string, unknown>);
          inputSource = 'stdin';
        }
      } catch {
        // No stdin data or empty, fall through to CLI mode
      }
    }

    // Priority 4: CLI mode (name from positional arg, fields from options)
    if (inputSource === 'cli') {
      if (!name) {
        const allFields = registry.getFieldsForMultipleSupertags(supertagNames);
        console.error(`Usage: tana create ${supertag} <name> [--field value...]`);
        console.error(`       tana create ${supertag} -f data.json`);
        console.error(`       tana create ${supertag} --json '{"name": "...", ...}'`);
        console.error('');
        const tagNames = schemas.map(s => s.name).join(', ');
        console.error(`Fields for ${tagNames}:`);
        for (const field of allFields) {
          console.error(`  --${field.normalizedName} <value>`);
        }
        console.error('');
        console.error('Example:');
        const exampleFields = allFields.slice(0, 2);
        const fieldArgs = exampleFields
          .map(f => `--${f.normalizedName} "value"`)
          .join(' ');
        console.error(`  tana create ${supertag} "My Node" ${fieldArgs}`);
        process.exit(1);
      }

      nodeName = name;
      fieldValues = parseFieldOptions(options);
    }

    // Merge with CLI options (CLI takes precedence over JSON input)
    if (inputSource !== 'cli') {
      const cliFields = parseFieldOptions(options);
      fieldValues = { ...fieldValues, ...cliFields };
    }

    if (options.verbose) {
      console.error('⚙️  Configuration:');
      if (schemas.length === 1) {
        console.error(`   Supertag: ${primarySchema.name} (${primarySchema.id})`);
      } else {
        console.error(`   Supertags: ${schemas.map(s => s.name).join(', ')}`);
        schemas.forEach(s => console.error(`     - ${s.name} (${s.id})`));
      }
      // Show inheritance for each schema
      for (const schema of schemas) {
        const schemaObj = registry.getSupertag(schema.name);
        if (schemaObj?.extends && schemaObj.extends.length > 0) {
          const parentNames = schemaObj.extends
            .map(id => registry.getSupertagById(id)?.name || id)
            .join(', ');
          console.error(`   ${schema.name} extends: ${parentNames}`);
        }
      }
      console.error(`   Endpoint: ${apiEndpoint}`);
      console.error(`   Target: ${targetNode}`);
      console.error(`   Input: ${inputSource}`);
      console.error(`   Dry run: ${options.dryRun ? 'yes' : 'no'}`);
      console.error('');

      // Show field mapping details - collect all own field IDs from all schemas
      const allFields = registry.getFieldsForMultipleSupertags(supertagNames);
      const ownFieldIds = new Set(schemas.flatMap(s => s.fields.map(f => f.attributeId)));

      console.error('📝 Creating node:');
      console.error(`   Name: ${nodeName}`);
      console.error('');
      console.error('   Field mappings:');
      for (const [fieldName, value] of Object.entries(fieldValues)) {
        const normalizedFieldName = fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const fieldSchema = allFields.find(f => f.normalizedName === normalizedFieldName);
        if (fieldSchema) {
          const isInherited = !ownFieldIds.has(fieldSchema.attributeId);
          const inheritedTag = isInherited ? ' (inherited)' : '';
          console.error(`   - ${fieldName} → ${fieldSchema.name}${inheritedTag}`);
          console.error(`     Value: ${value}`);
          console.error(`     Attribute ID: ${fieldSchema.attributeId}`);
        } else {
          console.error(`   - ${fieldName} → (not found in schema, skipped)`);
        }
      }
      console.error('');
    }

    // Parse children if provided
    let children: ChildNodeInput[] | undefined;
    if (options.children && options.children.length > 0) {
      const childNodes = parseChildren(options.children);
      if (childNodes.length > 0) {
        children = childNodes;

        if (options.verbose) {
          console.error('   Children:');
          for (const child of childNodes) {
            if (child.id) {
              console.error(`     - ${child.name} → reference to ${child.id}`);
            } else if (child.dataType === 'url') {
              console.error(`     - ${child.name} → url (clickable)`);
            } else {
              console.error(`     - ${child.name}`);
            }
          }
          console.error('');
        }
      }
    }

    // Use shared createNode function
    const result = await createNode({
      supertag,
      name: nodeName,
      fields: fieldValues,
      children,
      target: targetNode,
      dryRun: options.dryRun,
    });

    // Dry run mode - show validation results
    if (result.dryRun) {
      console.error('🔍 DRY RUN MODE - Not posting to API');
      console.error('');
      const tagDisplay = schemas.length === 1
        ? `${primarySchema.name}`
        : `node with ${schemas.length} supertags`;
      console.error(`Would create ${tagDisplay}:`);
      console.error(`  Name: ${nodeName}`);
      if (schemas.length === 1) {
        console.error(`  Supertag: ${primarySchema.name} (${primarySchema.id})`);
      } else {
        console.error(`  Supertags:`);
        schemas.forEach(s => console.error(`    - ${s.name} (${s.id})`));
      }
      for (const [field, value] of Object.entries(fieldValues)) {
        console.error(`  ${field}: ${value}`);
      }
      // Show children in dry run
      if (children && children.length > 0) {
        console.error('  Children:');
        for (const child of children) {
          if (child.id) {
            console.error(`    - ${child.name} → ref:${child.id}`);
          } else if (child.dataType === 'url') {
            console.error(`    - ${child.name} → url (clickable)`);
          } else {
            console.error(`    - ${child.name}`);
          }
        }
      }
      console.error('');
      console.error('Payload:');
      console.log(JSON.stringify(result.payload, null, 2));
      console.error('');
      console.error('✅ Validation passed - ready to post');
      console.error('To actually post, remove the --dry-run flag');
      return;
    }

    // Handle result
    if (result.success) {
      const tagNames = schemas.map(s => s.name).join(', ');
      console.log(`✅ Node created successfully in Tana`);
      if (result.nodeId) {
        console.log(`   Node ID: ${result.nodeId}`);
      }
      if (schemas.length === 1) {
        console.log(`   Supertag: ${primarySchema.name}`);
      } else {
        console.log(`   Supertags: ${tagNames}`);
      }
    } else {
      throw new Error(result.error || 'API returned success: false');
    }

  } catch (error) {
    exitWithError(error);
  }
}

/**
 * Extract name from JSON object
 */
function extractName(json: Record<string, unknown>): string {
  const nameFields = ['name', 'title', 'label', 'heading', 'subject', 'summary'];

  for (const field of nameFields) {
    if (field in json && typeof json[field] === 'string' && json[field]) {
      return json[field] as string;
    }
  }

  throw new ParseError('No valid name field found in JSON (expected: name, title, label, etc.)');
}

/**
 * Extract field values from JSON object
 */
function extractFieldsFromJson(json: Record<string, unknown>): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  const skipFields = ['name', 'title', 'label', 'heading', 'subject', 'summary', 'description'];

  for (const [key, value] of Object.entries(json)) {
    if (skipFields.includes(key)) continue;
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      fields[key] = value.map(v => String(v));
    } else {
      fields[key] = String(value);
    }
  }

  return fields;
}
