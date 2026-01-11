/**
 * Script to fetch Erdős problems and organize them into markdown files.
 *
 * Data sources:
 * - Metadata from teorth/erdosproblems (problems.yaml)
 * - Problem statements from google-deepmind/formal-conjectures (for formalized problems)
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

const BASE_DIR = __dirname;
const YAML_URL = 'https://raw.githubusercontent.com/teorth/erdosproblems/main/data/problems.yaml';
const LEAN_BASE_URL = 'https://raw.githubusercontent.com/google-deepmind/formal-conjectures/main/FormalConjectures/ErdosProblems';

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

  // Extract the module header docstring (problem description)
  const headerMatch = leanContent.match(/\/-!\s*\n([\s\S]*?)\n-\//);
  if (headerMatch) {
    // Clean up the header - remove leading # and asterisks
    let header = headerMatch[1]
      .split('\n')
      .map(line => line.replace(/^#\s*/, '').replace(/^\*/, ''))
      .join('\n')
      .trim();
    // Don't use header as main statement - it's just the title
  }

  // Extract all docstrings with their associated theorems/definitions
  const docstringPattern = /\/\--\s*([\s\S]*?)\s*-\/\s*\n\s*(?:@\[.*?\]\s*\n\s*)?(?:theorem|def|abbrev|lemma)\s+(\w+(?:\.\w+)*)/g;
  let match;

  while ((match = docstringPattern.exec(leanContent)) !== null) {
    const docstring = match[1].trim();
    const name = match[2];

    // Clean up the docstring - convert LaTeX-style math to standard
    const cleanedDoc = cleanLeanDocstring(docstring);

    if (name.includes('.variants.')) {
      result.variants.push(cleanedDoc);
    } else if (name.startsWith('Is') || name.startsWith('has') || /^[a-z]/.test(name)) {
      result.definitions.push(cleanedDoc);
    } else {
      // Main theorem - look for the one with the problem number
      if (!result.mainStatement) {
        result.mainStatement = cleanedDoc;
      }
    }
  }

  return result;
}

function cleanLeanDocstring(doc: string): string {
  return doc
    // Keep LaTeX math delimiters
    .replace(/\\\$/g, '$')
    // Clean up references
    .replace(/\[([A-Za-z]+\d+)\]/g, '[$1]')
    // Remove trailing by sorry comments
    .replace(/:= by\s*sorry/g, '')
    // Clean extra whitespace
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

function generateMarkdown(metadata: ProblemMetadata, leanContent: LeanContent | null): string {
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

  // Problem statement
  lines.push('## Problem Statement');
  lines.push('');
  if (leanContent?.mainStatement) {
    lines.push(leanContent.mainStatement);
  } else {
    lines.push(`*Problem statement not available locally. See [erdosproblems.com/${metadata.number}](https://www.erdosproblems.com/${metadata.number}) for details.*`);
  }
  lines.push('');

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
  const problems = await fetchYaml();
  console.log(`Found ${problems.length} problems`);

  // Identify formalized problems
  const formalizedProblems = problems.filter(p => p.formalized?.state === 'yes');
  console.log(`${formalizedProblems.length} problems have Lean formalizations`);

  // Fetch Lean files for formalized problems
  const leanContents = new Map<string, LeanContent>();
  console.log('Fetching Lean files...');

  const BATCH_SIZE = 20;
  const DELAY_MS = 100;

  for (let i = 0; i < formalizedProblems.length; i += BATCH_SIZE) {
    const batch = formalizedProblems.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (p) => {
      const leanFile = await fetchLeanFile(p.number);
      if (leanFile) {
        const content = extractLeanDocstrings(leanFile);
        leanContents.set(p.number, content);
      }
    }));

    if (i + BATCH_SIZE < formalizedProblems.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= formalizedProblems.length) {
      console.log(`  Fetched ${Math.min(i + BATCH_SIZE, formalizedProblems.length)}/${formalizedProblems.length} Lean files...`);
    }
  }

  console.log(`Successfully fetched ${leanContents.size} Lean files`);

  // Generate markdown files for all problems
  console.log('Generating markdown files...');
  let processed = 0;

  for (const metadata of problems) {
    const leanContent = leanContents.get(metadata.number) || null;
    const markdown = generateMarkdown(metadata, leanContent);

    const targetDir = getTargetDirectory(metadata);
    const filename = `${metadata.number}.md`;
    const filepath = path.join(targetDir, filename);

    fs.writeFileSync(filepath, markdown);
    processed++;

    if (processed % 100 === 0) {
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
  console.log(`  Problems with Lean content: ${leanContents.size}`);
}

main().catch(console.error);
