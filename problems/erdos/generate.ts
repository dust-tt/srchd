/**
 * Script to fetch Erdős problems and organize them into markdown files.
 *
 * Data sources:
 * - Metadata from teorth/erdosproblems (problems.yaml)
 * - Problem statements from Wayback Machine (erdosproblems.com archives)
 * - Additional content from google-deepmind/formal-conjectures (Lean files)
 *
 * Structure:
 * - problems/erdos/open/         - Problems that are still open
 * - problems/erdos/solved/formalized/    - Solved problems with formal proofs (Lean)
 * - problems/erdos/solved/unformalized/  - Solved problems without formal proofs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ProblemMetadata {
  number: string;
  prize?: string;
  status?: {
    state: string;
    last_update?: string;
    note?: string;
  };
  formalized?: {
    state: string;
    last_update?: string;
    note?: string;
  };
  oeis?: string[];
  tags?: string[];
  comments?: string;
}

interface WebContent {
  statement: string;
  additionalText: string;
  status: string;
}

const BASE_DIR = __dirname;
const YAML_URL = 'https://raw.githubusercontent.com/teorth/erdosproblems/main/data/problems.yaml';
const LEAN_BASE_URL = 'https://raw.githubusercontent.com/google-deepmind/formal-conjectures/main/FormalConjectures/ErdosProblems';
const WAYBACK_BASE = 'https://web.archive.org/web/2025/https://www.erdosproblems.com';

// Status states that indicate a problem is "solved" (proved, disproved, or otherwise resolved)
const SOLVED_STATES = new Set([
  'proved',
  'proved (Lean)',
  'disproved',
  'disproved (Lean)',
  'solved',
  'solved (Lean)',
  'not provable',
  'not disprovable',
  'independent'
]);

async function fetchYaml(): Promise<ProblemMetadata[]> {
  console.log('Fetching problems.yaml...');
  const response = await fetch(YAML_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch YAML: ${response.status}`);
  }
  const yamlText = await response.text();
  return parseYaml(yamlText);
}

function parseYaml(yamlText: string): ProblemMetadata[] {
  const problems: ProblemMetadata[] = [];
  const lines = yamlText.split('\n');
  let current: Partial<ProblemMetadata> | null = null;
  let inSubObject: 'status' | 'formalized' | null = null;

  for (const line of lines) {
    if (line.startsWith('- number:')) {
      if (current && current.number) {
        problems.push(current as ProblemMetadata);
      }
      current = { number: line.replace('- number:', '').trim().replace(/"/g, '') };
      inSubObject = null;
    } else if (current) {
      const trimmed = line.trim();
      if (trimmed.startsWith('prize:')) {
        current.prize = trimmed.replace('prize:', '').trim().replace(/"/g, '');
      } else if (trimmed === 'status:') {
        inSubObject = 'status';
        current.status = { state: '' };
      } else if (trimmed === 'formalized:') {
        inSubObject = 'formalized';
        current.formalized = { state: '' };
      } else if (trimmed.startsWith('state:') && inSubObject) {
        const state = trimmed.replace('state:', '').trim().replace(/"/g, '');
        if (inSubObject === 'status' && current.status) {
          current.status.state = state;
        } else if (inSubObject === 'formalized' && current.formalized) {
          current.formalized.state = state;
        }
      } else if (trimmed.startsWith('last_update:') && inSubObject) {
        const lastUpdate = trimmed.replace('last_update:', '').trim().replace(/"/g, '');
        if (inSubObject === 'status' && current.status) {
          current.status.last_update = lastUpdate;
        } else if (inSubObject === 'formalized' && current.formalized) {
          current.formalized.last_update = lastUpdate;
        }
      } else if (trimmed.startsWith('note:') && inSubObject) {
        const note = trimmed.replace('note:', '').trim().replace(/"/g, '');
        if (inSubObject === 'status' && current.status) {
          current.status.note = note;
        } else if (inSubObject === 'formalized' && current.formalized) {
          current.formalized.note = note;
        }
      } else if (trimmed.startsWith('oeis:')) {
        const inline = trimmed.replace('oeis:', '').trim();
        if (inline.startsWith('[')) {
          current.oeis = inline.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
        } else {
          current.oeis = [];
        }
        inSubObject = null;
      } else if (trimmed.startsWith('- "') && !trimmed.startsWith('- number:') && current.oeis !== undefined) {
        current.oeis.push(trimmed.slice(3, -1));
      } else if (trimmed.startsWith('tags:')) {
        const inline = trimmed.replace('tags:', '').trim();
        if (inline.startsWith('[')) {
          current.tags = inline.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
        } else {
          current.tags = [];
        }
        inSubObject = null;
      } else if (trimmed.startsWith('comments:')) {
        current.comments = trimmed.replace('comments:', '').trim().replace(/"/g, '');
        inSubObject = null;
      }
    }
  }

  if (current && current.number) {
    problems.push(current as ProblemMetadata);
  }

  return problems;
}

async function fetchFromWayback(number: string): Promise<WebContent | null> {
  // First, get the latest snapshot timestamp from the CDX API
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=erdosproblems.com/${number}&output=json&limit=1&fl=timestamp&filter=statuscode:200`;
  try {
    const cdxResponse = await fetch(cdxUrl);
    if (!cdxResponse.ok) return null;

    const cdxData = await cdxResponse.json() as string[][];
    if (cdxData.length < 2) return null; // No snapshots found

    const timestamp = cdxData[1][0];
    const archiveUrl = `https://web.archive.org/web/${timestamp}/https://www.erdosproblems.com/${number}`;

    const response = await fetch(archiveUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; research bot)'
      },
      redirect: 'follow'
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    return extractWebContent(html);
  } catch {
    return null;
  }
}

function extractWebContent(html: string): WebContent {
  const result: WebContent = {
    statement: '',
    additionalText: '',
    status: ''
  };

  // Extract status/prize from <div id="prize">
  const prizeMatch = html.match(/<div id="prize">\s*([\s\S]*?)\s*<\/div>/i);
  if (prizeMatch) {
    result.status = cleanHtml(prizeMatch[1]).trim();
  }

  // Extract main problem statement from <div id="content">
  const contentMatch = html.match(/<div id="content">([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    result.statement = cleanHtml(contentMatch[1]);
  }

  // Extract additional text from <div class="problem-additional-text">
  const additionalMatch = html.match(/<div class="problem-additional-text">\s*([\s\S]*?)<\/div>\s*(?:<div class="problem-ack">|<div class="image-container"|<div id="next_id">)/i);
  if (additionalMatch) {
    let additionalText = cleanHtml(additionalMatch[1]);
    // Remove trailing navigation links and whitespace
    additionalText = additionalText.replace(/\s*\[(Previous|Next)\]\([^)]+\)\s*$/gi, '');
    additionalText = additionalText.replace(/\s{2,}/g, ' ').trim();
    result.additionalText = additionalText;
  }

  return result;
}

function cleanHtml(html: string): string {
  return html
    // Remove wayback machine URL rewrites
    .replace(/\/web\/\d+\//g, '')
    .replace(/https:\/\/web\.archive\.org/g, '')
    // Remove script tags
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Remove style tags
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Convert links to markdown
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
    // Remove javascript: links
    .replace(/\[([^\]]+)\]\(javascript:[^)]*\)/g, '**$1**')
    // Convert br tags to newlines
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert p tags to double newlines
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#337;/g, 'ő')
    // Clean up LaTeX
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface LeanContent {
  mainStatement: string;
  variants: string[];
  definitions: string[];
}

async function fetchLeanFile(number: string): Promise<string | null> {
  const url = `${LEAN_BASE_URL}/${number}.lean`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

function extractLeanDocstrings(leanContent: string): LeanContent {
  const result: LeanContent = {
    mainStatement: '',
    variants: [],
    definitions: []
  };

  // Extract all docstrings with their associated theorems/definitions
  const docstringPattern = /\/\--\s*([\s\S]*?)\s*-\/\s*\n\s*(?:@\[.*?\]\s*\n\s*)?(?:theorem|def|abbrev|lemma)\s+(\w+(?:\.\w+)*)/g;
  let match;

  while ((match = docstringPattern.exec(leanContent)) !== null) {
    const docstring = match[1].trim();
    const name = match[2];
    const cleanedDoc = cleanLeanDocstring(docstring);

    // Main theorem is usually named erdos_N or similar without variants
    if (name.includes('.variants.')) {
      result.variants.push(cleanedDoc);
    } else if (/^erdos_\d+$/.test(name) || /^Erdos\d+$/.test(name)) {
      // This is the main theorem
      result.mainStatement = cleanedDoc;
    } else if (name.startsWith('Is') || name.startsWith('has') || /^[a-z]/.test(name)) {
      result.definitions.push(cleanedDoc);
    } else if (!result.mainStatement) {
      // Fallback: first non-variant, non-definition theorem
      result.mainStatement = cleanedDoc;
    }
  }

  return result;
}

function cleanLeanDocstring(doc: string): string {
  return doc
    .replace(/\\\$/g, '$')
    .replace(/\[([A-Za-z]+\d+)\]/g, '[$1]')
    .replace(/:= by\s*sorry/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getTargetDirectory(metadata: ProblemMetadata): string {
  const status = metadata.status?.state || 'open';
  const formalized = metadata.formalized?.state === 'yes' || status.includes('(Lean)');

  if (SOLVED_STATES.has(status)) {
    if (formalized) {
      return path.join(BASE_DIR, 'solved', 'formalized');
    } else {
      return path.join(BASE_DIR, 'solved', 'unformalized');
    }
  } else {
    return path.join(BASE_DIR, 'open');
  }
}

function generateMarkdown(
  metadata: ProblemMetadata,
  webContent: WebContent | null,
  leanContent: LeanContent | null
): string {
  const lines: string[] = [];

  // Title
  lines.push(`# Erdős Problem ${metadata.number}`);
  lines.push('');

  // Metadata section
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **Status:** ${metadata.status?.state || 'unknown'}`);
  if (metadata.prize && metadata.prize !== 'no') {
    lines.push(`- **Prize:** ${metadata.prize}`);
  }
  if (metadata.formalized?.state === 'yes') {
    lines.push(`- **Formalized:** Yes ([Lean](https://github.com/google-deepmind/formal-conjectures/blob/main/FormalConjectures/ErdosProblems/${metadata.number}.lean))`);
  }
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push(`- **Tags:** ${metadata.tags.join(', ')}`);
  }
  if (metadata.oeis && metadata.oeis.length > 0 && metadata.oeis[0] !== 'N/A') {
    const oeisLinks = metadata.oeis
      .filter(o => o !== 'N/A' && o !== 'possible' && !o.startsWith('possible'))
      .map(o => `[${o}](https://oeis.org/${o})`);
    if (oeisLinks.length > 0) {
      lines.push(`- **OEIS:** ${oeisLinks.join(', ')}`);
    }
  }
  lines.push(`- **Source:** [erdosproblems.com/${metadata.number}](https://www.erdosproblems.com/${metadata.number})`);
  lines.push('');

  // Definitions section (if any from Lean)
  if (leanContent?.definitions && leanContent.definitions.length > 0) {
    lines.push('## Definitions');
    lines.push('');
    for (const def of leanContent.definitions) {
      lines.push(def);
      lines.push('');
    }
  }

  // Problem statement - prefer web content, fall back to Lean
  lines.push('## Problem Statement');
  lines.push('');
  if (webContent?.statement) {
    lines.push(webContent.statement);
  } else if (leanContent?.mainStatement) {
    lines.push(leanContent.mainStatement);
  } else {
    lines.push(`*Problem statement not available. See [erdosproblems.com/${metadata.number}](https://www.erdosproblems.com/${metadata.number}) for details.*`);
  }
  lines.push('');

  // Additional text from website
  if (webContent?.additionalText) {
    lines.push('## Background');
    lines.push('');
    lines.push(webContent.additionalText);
    lines.push('');
  }

  // Variants section (if any from Lean)
  if (leanContent?.variants && leanContent.variants.length > 0) {
    lines.push('## Variants and Related Results');
    lines.push('');
    for (const variant of leanContent.variants) {
      lines.push(variant);
      lines.push('');
    }
  }

  // Comments if available
  if (metadata.comments) {
    lines.push('## Notes');
    lines.push('');
    lines.push(metadata.comments);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  // Parse command line args
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : null;
  const openOnly = args.includes('--open-only');

  // Create directory structure
  const dirs = [
    path.join(BASE_DIR, 'open'),
    path.join(BASE_DIR, 'solved', 'formalized'),
    path.join(BASE_DIR, 'solved', 'unformalized'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Fetch problem metadata
  let problems = await fetchYaml();
  console.log(`Found ${problems.length} problems`);

  // Apply filters
  if (openOnly) {
    problems = problems.filter(p => !SOLVED_STATES.has(p.status?.state || 'open'));
    console.log(`Filtered to ${problems.length} open problems`);
  }
  if (limit) {
    problems = problems.slice(0, limit);
    console.log(`Limited to first ${problems.length} problems`);
  }

  // Fetch Lean files for formalized problems
  const formalizedProblems = problems.filter(p => p.formalized?.state === 'yes');
  console.log(`${formalizedProblems.length} problems have Lean formalizations`);

  const leanContents = new Map<string, LeanContent>();
  console.log('Fetching Lean files...');

  const LEAN_BATCH_SIZE = 20;
  for (let i = 0; i < formalizedProblems.length; i += LEAN_BATCH_SIZE) {
    const batch = formalizedProblems.slice(i, i + LEAN_BATCH_SIZE);
    await Promise.all(batch.map(async (p) => {
      const leanFile = await fetchLeanFile(p.number);
      if (leanFile) {
        leanContents.set(p.number, extractLeanDocstrings(leanFile));
      }
    }));
    if ((i + LEAN_BATCH_SIZE) % 100 === 0 || i + LEAN_BATCH_SIZE >= formalizedProblems.length) {
      console.log(`  Fetched ${Math.min(i + LEAN_BATCH_SIZE, formalizedProblems.length)}/${formalizedProblems.length} Lean files`);
    }
  }

  // Fetch web content from Wayback Machine
  console.log('Fetching problem statements from Wayback Machine...');
  const webContents = new Map<string, WebContent>();

  const WEB_BATCH_SIZE = 10;
  const WEB_DELAY_MS = 200;

  for (let i = 0; i < problems.length; i += WEB_BATCH_SIZE) {
    const batch = problems.slice(i, i + WEB_BATCH_SIZE);

    await Promise.all(batch.map(async (p) => {
      const content = await fetchFromWayback(p.number);
      if (content && content.statement) {
        webContents.set(p.number, content);
      }
    }));

    if (i + WEB_BATCH_SIZE < problems.length) {
      await new Promise(resolve => setTimeout(resolve, WEB_DELAY_MS));
    }

    if ((i + WEB_BATCH_SIZE) % 100 === 0 || i + WEB_BATCH_SIZE >= problems.length) {
      console.log(`  Fetched ${Math.min(i + WEB_BATCH_SIZE, problems.length)}/${problems.length} web pages (${webContents.size} successful)`);
    }
  }

  console.log(`Successfully fetched ${webContents.size} problem statements from web`);

  // Generate markdown files
  console.log('Generating markdown files...');
  let processed = 0;
  let withContent = 0;

  for (const metadata of problems) {
    const webContent = webContents.get(metadata.number) || null;
    const leanContent = leanContents.get(metadata.number) || null;
    const markdown = generateMarkdown(metadata, webContent, leanContent);

    if (webContent?.statement || leanContent?.mainStatement) {
      withContent++;
    }

    const targetDir = getTargetDirectory(metadata);
    const filename = `${metadata.number}.md`;
    const filepath = path.join(targetDir, filename);

    fs.writeFileSync(filepath, markdown);
    processed++;

    if (processed % 200 === 0) {
      console.log(`  Generated ${processed}/${problems.length} markdown files...`);
    }
  }

  console.log(`\nDone! Generated ${processed} markdown files.`);

  // Print summary
  const openCount = fs.readdirSync(path.join(BASE_DIR, 'open')).length;
  const formalizedCount = fs.readdirSync(path.join(BASE_DIR, 'solved', 'formalized')).length;
  const unformalizedCount = fs.readdirSync(path.join(BASE_DIR, 'solved', 'unformalized')).length;

  console.log('\nSummary:');
  console.log(`  Open problems: ${openCount}`);
  console.log(`  Solved (formalized): ${formalizedCount}`);
  console.log(`  Solved (unformalized): ${unformalizedCount}`);
  console.log(`  Problems with content: ${withContent}`);
  console.log(`  Problems with Lean content: ${leanContents.size}`);
  console.log(`  Problems with web content: ${webContents.size}`);
}

main().catch(console.error);
