/**
 * Script to download "easy" Erdős problems to the easy/ directory.
 *
 * "Easy" is defined as:
 * - Has Lean formalization (formalized.state = "yes")
 * - Low sorry/theorem ratio (more work already done)
 * - Preferably verifiable/decidable status
 * - Has a prize, but a cheap one (< $1000)
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

interface LeanAnalysis {
  sorryCount: number;
  theoremCount: number;
  lemmaCount: number;
  defCount: number;
  totalDeclarations: number;
  completenessRatio: number; // sorries / total (lower = more complete)
  hasProofs: boolean; // has at least one non-sorry proof
}

interface WebContent {
  statement: string;
  additionalText: string;
}

interface ScoredProblem {
  metadata: ProblemMetadata;
  analysis: LeanAnalysis;
  score: number; // overall score (lower = easier/more complete)
}

const YAML_URL = 'https://raw.githubusercontent.com/teorth/erdosproblems/main/data/problems.yaml';
const LEAN_BASE_URL = 'https://raw.githubusercontent.com/google-deepmind/formal-conjectures/main/FormalConjectures/ErdosProblems';
const WAYBACK_BASE = 'https://web.archive.org/web';

const EASY_DIR = path.join(__dirname, 'easy');

// Only truly open problems - no mathematically solved ones
const ALLOWED_STATES = new Set([
  'open',
  'verifiable',
  'decidable',
  'falsifiable'
]);

// States that mean the problem is already solved mathematically
const SOLVED_STATES = new Set([
  'proved',
  'proved (Lean)',
  'disproved',
  'disproved (Lean)',
  'solved',
  'solved (Lean)'
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

function analyzeLeanFile(leanContent: string): LeanAnalysis {
  // Count sorry statements
  const sorryMatches = leanContent.match(/\bsorry\b/g);
  const sorryCount = sorryMatches ? sorryMatches.length : 0;

  // Count theorem/lemma/def declarations
  const theoremMatches = leanContent.match(/\btheorem\s+\w+/g);
  const lemmaMatches = leanContent.match(/\blemma\s+\w+/g);
  const defMatches = leanContent.match(/\b(def|abbrev)\s+\w+/g);

  const theoremCount = theoremMatches ? theoremMatches.length : 0;
  const lemmaCount = lemmaMatches ? lemmaMatches.length : 0;
  const defCount = defMatches ? defMatches.length : 0;

  const totalDeclarations = theoremCount + lemmaCount + defCount;

  // Calculate completeness ratio
  const completenessRatio = totalDeclarations > 0 ? sorryCount / totalDeclarations : 1.0;

  // Check if there are any proofs (non-sorry content)
  // Look for := followed by proof tactics (not just sorry)
  const hasProofs = /(:=\s*(?:by|fun|match|\{)(?!\s*sorry))/m.test(leanContent);

  return {
    sorryCount,
    theoremCount,
    lemmaCount,
    defCount,
    totalDeclarations,
    completenessRatio,
    hasProofs
  };
}

function parsePrizeAmount(prize?: string): number {
  if (!prize || prize === 'no') return 0;

  // Extract numeric value from prize string
  const match = prize.match(/[\d,]+/);
  if (!match) return 0;

  const amount = parseInt(match[0].replace(/,/g, ''), 10);

  // Normalize to USD (rough approximations)
  if (prize.includes('£')) return amount * 1.3;
  if (prize.includes('€')) return amount * 1.1;
  if (prize.includes('₹')) return amount * 0.012;

  return amount;
}

function scoreProblem(metadata: ProblemMetadata, analysis: LeanAnalysis): number {
  let score = 0;

  // Primary: Completeness ratio (0-100 points, lower ratio = lower score = better)
  score += analysis.completenessRatio * 100;

  // Bonus: Has at least one proof (-20 points)
  if (analysis.hasProofs) {
    score -= 20;
  }

  // Bonus: Verifiable/decidable/falsifiable status (-30 points)
  const status = metadata.status?.state || 'open';
  if (['verifiable', 'decidable', 'falsifiable'].includes(status)) {
    score -= 30;
  }

  // Bonus: Has prize but cheap (-10 to +20 points based on amount)
  const prizeAmount = parsePrizeAmount(metadata.prize);
  if (prizeAmount > 0 && prizeAmount <= 500) {
    score -= 10;
  } else if (prizeAmount > 500 && prizeAmount <= 1000) {
    score -= 5;
  } else if (prizeAmount > 1000) {
    score += 20; // Penalty for expensive prizes (likely harder)
  }

  // Bonus: More declarations = more structure to work with (-0.5 per declaration)
  score -= analysis.totalDeclarations * 0.5;

  return score;
}

async function fetchFromWayback(number: string): Promise<WebContent | null> {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=erdosproblems.com/${number}&output=json&limit=1&fl=timestamp&filter=statuscode:200`;
  try {
    const cdxResponse = await fetch(cdxUrl);
    if (!cdxResponse.ok) return null;

    const cdxData = await cdxResponse.json() as string[][];
    if (cdxData.length < 2) return null;

    const timestamp = cdxData[1][0];
    const archiveUrl = `${WAYBACK_BASE}/${timestamp}/https://www.erdosproblems.com/${number}`;

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
    additionalText: ''
  };

  const contentMatch = html.match(/<div id="content">([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    result.statement = cleanHtml(contentMatch[1]);
  }

  const additionalMatch = html.match(/<div class="problem-additional-text">\s*([\s\S]*?)<\/div>\s*(?:<div class="problem-ack">|<div class="image-container"|<div id="next_id">)/i);
  if (additionalMatch) {
    let additionalText = cleanHtml(additionalMatch[1]);
    additionalText = additionalText.replace(/\s*\[(Previous|Next)\]\([^)]+\)\s*$/gi, '');
    additionalText = additionalText.replace(/\s{2,}/g, ' ').trim();
    result.additionalText = additionalText;
  }

  return result;
}

function cleanHtml(html: string): string {
  return html
    .replace(/\/web\/\d+\//g, '')
    .replace(/https:\/\/web\.archive\.org/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
    .replace(/\[([^\]]+)\]\(javascript:[^)]*\)/g, '**$1**')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#337;/g, 'ő')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function generateMarkdown(
  metadata: ProblemMetadata,
  analysis: LeanAnalysis,
  webContent: WebContent | null,
  leanContent: string
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
  lines.push(`- **Formalized:** Yes ([Lean](https://github.com/google-deepmind/formal-conjectures/blob/main/FormalConjectures/ErdosProblems/${metadata.number}.lean))`);
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

  // Proof progress
  lines.push('## Proof Progress');
  lines.push('');
  lines.push(`- **Theorems/Lemmas:** ${analysis.theoremCount + analysis.lemmaCount}`);
  lines.push(`- **Definitions:** ${analysis.defCount}`);
  lines.push(`- **Sorry statements:** ${analysis.sorryCount}`);
  lines.push(`- **Completeness:** ${((1 - analysis.completenessRatio) * 100).toFixed(1)}%`);
  lines.push(`- **Has proofs:** ${analysis.hasProofs ? 'Yes' : 'No'}`);
  lines.push('');

  // Problem statement
  lines.push('## Problem Statement');
  lines.push('');
  if (webContent?.statement) {
    lines.push(webContent.statement);
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

  // Lean formalization
  lines.push('## Lean Formalization');
  lines.push('');
  lines.push('```lean');
  lines.push(leanContent);
  lines.push('```');
  lines.push('');

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
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : 20;

  // Create easy directory
  fs.mkdirSync(EASY_DIR, { recursive: true });

  // Fetch all problems
  const allProblems = await fetchYaml();
  console.log(`Found ${allProblems.length} total problems`);

  // Filter for formalized AND open problems only
  const formalizedProblems = allProblems.filter(p => {
    const isFormalized = p.formalized?.state === 'yes';
    const status = p.status?.state || 'open';
    const isOpen = ALLOWED_STATES.has(status) && !SOLVED_STATES.has(status);
    return isFormalized && isOpen;
  });
  console.log(`Found ${formalizedProblems.length} formalized open problems`);

  // Analyze each formalized problem
  console.log('\nAnalyzing Lean files...');
  const scoredProblems: ScoredProblem[] = [];

  const BATCH_SIZE = 20;
  for (let i = 0; i < formalizedProblems.length; i += BATCH_SIZE) {
    const batch = formalizedProblems.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(batch.map(async (metadata) => {
      const leanContent = await fetchLeanFile(metadata.number);
      if (!leanContent) return null;

      const analysis = analyzeLeanFile(leanContent);
      const score = scoreProblem(metadata, analysis);

      return { metadata, analysis, score };
    }));

    scoredProblems.push(...results.filter((r): r is ScoredProblem => r !== null));

    console.log(`  Analyzed ${Math.min(i + BATCH_SIZE, formalizedProblems.length)}/${formalizedProblems.length} problems`);
  }

  console.log(`\nSuccessfully analyzed ${scoredProblems.length} problems`);

  // Sort by score (lower = better)
  scoredProblems.sort((a, b) => a.score - b.score);

  // Take top N
  const topProblems = scoredProblems.slice(0, limit);

  console.log(`\nTop ${topProblems.length} easiest problems:`);
  for (const { metadata, analysis, score } of topProblems) {
    console.log(`  ${metadata.number}: score=${score.toFixed(1)}, ratio=${analysis.completenessRatio.toFixed(2)}, declarations=${analysis.totalDeclarations}, sorries=${analysis.sorryCount}, status=${metadata.status?.state}, prize=${metadata.prize || 'none'}`);
  }

  // Download the top problems
  console.log('\nDownloading problems...');
  for (const { metadata, analysis } of topProblems) {
    const leanContent = await fetchLeanFile(metadata.number);
    if (!leanContent) continue;

    const webContent = await fetchFromWayback(metadata.number);
    const markdown = generateMarkdown(metadata, analysis, webContent, leanContent);

    const filename = `${metadata.number}.md`;
    const filepath = path.join(EASY_DIR, filename);

    fs.writeFileSync(filepath, markdown);
    console.log(`  Downloaded problem ${metadata.number}`);

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\nDone!');
}

main().catch(console.error);
