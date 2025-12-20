/**
 * Research Node Formatter
 * Creates Research supertag nodes for Tana with proper field structure
 */

import type { TanaNode, TanaApiNode } from '../types';

/**
 * Research supertag ID and field attribute IDs
 * From docs/research_spec.json
 */
export const RESEARCH_SUPERTAG_ID = 'Eln_aVxnwfKL';
export const RESEARCH_FIELDS = {
  topic: 'IIOk2TLbr0EN',
  period: 'ZMRYr8i0LrIt',
  dateRange: 'hU8WFL7FYzhj',
  articleCount: 'iNuADMRSzJ7b',
  generated: 'IyD0Ie6oyGuM',
} as const;

/**
 * Research input data structure
 */
export interface ResearchInput {
  name: string;
  description?: string;
  topic?: string | string[];
  period?: string;
  dateRange?: string;
  articleCount?: number;
  generated?: string;
}

/**
 * Parse markdown content into nested child nodes
 * Walks the full tree: ## sections → ### subsections → #### items → paragraphs/lists
 * @param content Markdown content to parse
 * @returns Array of child nodes with full text preserved
 */
function parseSectionContent(content: string): TanaNode[] {
  if (!content.trim()) return [];

  const nodes: TanaNode[] = [];

  // Split by ### headers (subsections)
  const subsections = content.split(/(?=^### )/m).filter(s => s.trim());

  subsections.forEach(subsection => {
    const subsectionTrimmed = subsection.trim();

    if (subsectionTrimmed.startsWith('### ')) {
      // This is a ### subsection - parse it recursively
      const lines = subsectionTrimmed.split('\n');
      const headerLine = lines[0];
      const subsectionName = headerLine.replace(/^### /, '').trim();
      const remainingContent = lines.slice(1).join('\n').trim();

      // Parse the content under this ### into child nodes
      const children = parseSubsectionContent(remainingContent);

      nodes.push({
        name: subsectionName,
        children: children.length > 0 ? children : undefined,
      });
    } else {
      // Content before any ### header - parse as paragraphs/lists
      const children = parseSubsectionContent(subsectionTrimmed);
      nodes.push(...children);
    }
  });

  return nodes;
}

/**
 * Parse content under a subsection (handles #### headers, paragraphs, lists, links)
 * @param content Content to parse
 * @returns Array of child nodes
 */
function parseSubsectionContent(content: string): TanaNode[] {
  if (!content.trim()) return [];

  const nodes: TanaNode[] = [];

  // Split by #### headers first
  const items = content.split(/(?=^#### )/m).filter(s => s.trim());

  items.forEach(item => {
    const itemTrimmed = item.trim();

    if (itemTrimmed.startsWith('#### ')) {
      // #### header - treat as node with content as children
      const lines = itemTrimmed.split('\n');
      const headerLine = lines[0];
      const itemName = headerLine.replace(/^#### /, '').trim();
      const itemContent = lines.slice(1).join('\n').trim();

      const children = parseTextContent(itemContent);

      nodes.push({
        name: itemName,
        children: children.length > 0 ? children : undefined,
      });
    } else {
      // No #### header - parse as text blocks
      const children = parseTextContent(itemTrimmed);
      nodes.push(...children);
    }
  });

  return nodes;
}

/**
 * Parse plain text content (paragraphs, lists, links) into nodes
 * Each paragraph, list, or markdown link becomes a node with FULL text
 * @param content Text content
 * @returns Array of child nodes
 */
function parseTextContent(content: string): TanaNode[] {
  if (!content.trim()) return [];

  const nodes: TanaNode[] = [];

  // Split by blank lines (paragraphs)
  const blocks = content.split(/\n\n+/).filter(b => b.trim());

  blocks.forEach(block => {
    const blockTrimmed = block.trim();

    // Check if this is a list (starts with - or *)
    if (/^[-*]\s/.test(blockTrimmed)) {
      // Parse list items
      const listItems = blockTrimmed.split(/\n(?=[-*]\s)/).filter(li => li.trim());

      listItems.forEach(listItem => {
        const itemText = listItem.replace(/^[-*]\s+/, '').trim();

        // Full text as node name - NO abbreviation
        nodes.push({
          name: itemText,
        });
      });
    } else {
      // Regular paragraph - use FULL text as node name
      nodes.push({
        name: blockTrimmed,
      });
    }
  });

  return nodes;
}

/**
 * Create a Research supertag node
 * @param input Research data
 * @returns TanaApiNode for API posting
 */
export function createResearchNode(input: ResearchInput): TanaApiNode {
  const node: TanaApiNode = {
    name: input.name,
    supertags: [{ id: RESEARCH_SUPERTAG_ID }],
    children: [],
  };

  // Add topic field (can be single or multiple)
  if (input.topic) {
    const topics = Array.isArray(input.topic) ? input.topic : [input.topic];
    if (topics.length > 0) {
      node.children!.push({
        type: 'field',
        attributeId: RESEARCH_FIELDS.topic,
        children: topics.map(topic => ({
          name: topic,
        })),
      });
    }
  }

  // Add period field
  if (input.period) {
    node.children!.push({
      type: 'field',
      attributeId: RESEARCH_FIELDS.period,
      children: [{ name: input.period }],
    });
  }

  // Add date_range field
  if (input.dateRange) {
    node.children!.push({
      type: 'field',
      attributeId: RESEARCH_FIELDS.dateRange,
      children: [{
        dataType: 'date',
        name: input.dateRange
      }],
    });
  }

  // Add article_count field
  if (input.articleCount !== undefined) {
    node.children!.push({
      type: 'field',
      attributeId: RESEARCH_FIELDS.articleCount,
      children: [{ name: input.articleCount.toString() }],
    });
  }

  // Add generated field (date when research was generated)
  if (input.generated) {
    node.children!.push({
      type: 'field',
      attributeId: RESEARCH_FIELDS.generated,
      children: [{
        dataType: 'date',
        name: input.generated
      }],
    });
  }

  // Add description/content as body child nodes (after all field nodes)
  // Note: Tana API has 5000 char limit, so we need to be careful with large content
  if (input.description) {
    // Estimate payload size before parsing
    const estimatedSize = JSON.stringify(node).length + input.description.length * 1.5;

    if (estimatedSize > 4500) {
      // Content too large - just add a summary node pointing to the file
      node.children!.push({
        name: '📄 Full summary available in markdown file',
        description: 'Content exceeds Tana API size limit. View the complete summary in the generated markdown file.',
      });
    } else {
      // Content size OK - parse into full structure
      // Split markdown content by sections (## headers) to create structured child nodes
      const sections = input.description.split(/(?=^## )/m).filter(s => s.trim());

      sections.forEach(section => {
        const lines = section.trim().split('\n');
        const firstLine = lines[0];

        // If section starts with ##, use it as node name
        if (firstLine.startsWith('## ')) {
          const sectionName = firstLine.replace(/^## /, '').trim();
          const sectionContent = lines.slice(1).join('\n').trim();

          // Parse section content into child nodes (split by ### or paragraphs)
          const childNodes = parseSectionContent(sectionContent);

          node.children!.push({
            name: sectionName,
            children: childNodes.length > 0 ? childNodes : undefined,
          });
        } else {
          // First section (before any ##) - add as single node
          node.children!.push({
            name: section.trim(),
          });
        }
      });
    }
  }

  return node;
}

/**
 * Parse Research input from JSON
 * Supports various field name formats for flexibility
 */
export function parseResearchFromJson(json: Record<string, unknown>): ResearchInput {
  // Extract name (required)
  const name = (
    json.name ||
    json.title ||
    json.subject ||
    json.summary
  ) as string | undefined;

  if (!name) {
    throw new Error('Research name is required');
  }

  // Extract description (optional)
  const description = json.description as string | undefined;

  // Extract topic (optional, can be string or array)
  let topic: string | string[] | undefined;
  if (json.topic) {
    topic = Array.isArray(json.topic) ? json.topic : (json.topic as string);
  } else if (json.topics) {
    topic = Array.isArray(json.topics) ? json.topics : [json.topics as string];
  }

  // Extract period (optional)
  const period = json.period as string | undefined;

  // Extract date_range (optional)
  const dateRange = (
    json.dateRange ||
    json.date_range ||
    json.range
  ) as string | undefined;

  // Extract article_count (optional)
  const articleCount = (
    json.articleCount ||
    json.article_count ||
    json.count
  ) as number | undefined;

  // Extract generated (optional)
  const generated = (
    json.generated ||
    json.generatedAt ||
    json.generated_at ||
    json.timestamp
  ) as string | undefined;

  return {
    name,
    description,
    topic,
    period,
    dateRange,
    articleCount,
    generated,
  };
}
