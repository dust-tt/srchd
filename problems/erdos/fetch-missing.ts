/**
 * Script to fetch missing problem statements from erdosproblems.com
 * Uses slow rate limiting to avoid hitting the 50/hour limit
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPEN_DIR = path.join(__dirname, 'open');

interface WebContent {
  statement: string;
  additionalText: string;
}

async function fetchFromWayback(number: string): Promise<WebContent | null> {
  // Get available snapshots from CDX API
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=www.erdosproblems.com/${number}&output=json&limit=-1&filter=statuscode:200`;
  try {
    const cdxResp = await fetch(cdxUrl);
    if (!cdxResp.ok) return null;

    const data = await cdxResp.json() as string[][];
    if (data.length < 2) return null;

    // Get the most recent snapshot (last entry)
    const timestamps = data.slice(1).map(row => row[1]);
    const latestTimestamp = timestamps[timestamps.length - 1];

    const archiveUrl = `https://web.archive.org/web/${latestTimestamp}id_/https://www.erdosproblems.com/${number}`;
    const response = await fetch(archiveUrl);
    if (!response.ok) {
      console.log(`  [${number}] Archive HTTP ${response.status}`);
      return null;
    }
    const html = await response.text();
    return extractWebContent(html);
  } catch (e) {
    console.log(`  [${number}] Error: ${e}`);
    return null;
  }
}

async function fetchFromSite(number: string): Promise<WebContent | null> {
  // Try Wayback first
  const waybackContent = await fetchFromWayback(number);
  if (waybackContent && waybackContent.statement) {
    return waybackContent;
  }

  // Fall back to direct site
  const url = `https://www.erdosproblems.com/${number}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    if (!response.ok) {
      console.log(`  [${number}] HTTP ${response.status}`);
      return null;
    }
    const html = await response.text();
    return extractWebContent(html);
  } catch (e) {
    console.log(`  [${number}] Error: ${e}`);
    return null;
  }
}

function extractWebContent(html: string): WebContent {
  const result: WebContent = {
    statement: '',
    additionalText: ''
  };

  // Extract main problem statement from <div id="content">
  const contentMatch = html.match(/<div id="content">([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    result.statement = cleanHtml(contentMatch[1]);
  }

  // Extract additional text - look for the first problem-additional-text div
  const additionalMatch = html.match(/<div class="problem-additional-text">\s*([\s\S]*?)(?=<\/div>\s*<div class="problem-|<\/div>\s*<div class="image-container"|<\/div>\s*<div id="next_id">|<div id="bib-container)/i);
  if (additionalMatch) {
    let text = cleanHtml(additionalMatch[1]);
    // Remove common footer/nav text
    text = text.replace(/\s*\[(Previous|Next)\]\([^)]+\)\s*/gi, '');
    text = text.replace(/\[View the LaTeX source\].*$/gi, '');
    text = text.replace(/External data from.*$/gis, '');
    text = text.replace(/Formal(ized|ised) statement\?.*$/gis, '');
    text = text.replace(/Related OEIS sequences:.*$/gis, '');
    text = text.replace(/When referring to this problem.*$/gis, '');
    text = text.replace(/Additional thanks to:.*$/gis, '');
    text = text.replace(/\d+ comments on this problem.*$/gis, '');
    text = text.replace(/\s+$/, '').trim();
    if (text.length > 20) {  // Only keep if meaningful content
      result.additionalText = text;
    }
  }

  return result;
}

function cleanHtml(html: string): string {
  return html
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

function updateMarkdownFile(filepath: string, content: WebContent): boolean {
  const md = fs.readFileSync(filepath, 'utf-8');

  if (!md.includes('Problem statement not available')) {
    return false; // Already has content
  }

  if (!content.statement) {
    return false;
  }

  // Split the file at "## Problem Statement"
  const parts = md.split('## Problem Statement');
  if (parts.length !== 2) {
    return false;
  }

  const beforeStatement = parts[0];
  const afterStatementSection = parts[1];

  // Find where the next section starts (or end of file)
  const nextSectionMatch = afterStatementSection.match(/\n## [A-Z]/);
  let restOfFile = '';
  if (nextSectionMatch && nextSectionMatch.index !== undefined) {
    restOfFile = afterStatementSection.slice(nextSectionMatch.index);
  }

  // Build the new content
  let newContent = beforeStatement + '## Problem Statement\n\n' + content.statement + '\n';

  // Add background if we have it
  if (content.additionalText) {
    newContent += '\n## Background\n\n' + content.additionalText + '\n';
  }

  // Add rest of file (other sections like Variants)
  if (restOfFile) {
    newContent += restOfFile;
  }

  fs.writeFileSync(filepath, newContent);
  return true;
}

async function main() {
  // Find files missing content
  const files = fs.readdirSync(OPEN_DIR).filter(f => f.endsWith('.md'));
  const missing: string[] = [];

  for (const file of files) {
    const filepath = path.join(OPEN_DIR, file);
    const content = fs.readFileSync(filepath, 'utf-8');
    if (content.includes('Problem statement not available')) {
      missing.push(file.replace('.md', ''));
    }
  }

  console.log(`Found ${missing.length} problems missing statements`);

  // Fetch with rate limiting - 1 request every 1.5 seconds (safe for 50/hour limit)
  const DELAY_MS = 1500;
  let fetched = 0;
  let updated = 0;

  for (const num of missing) {
    console.log(`Fetching problem ${num}...`);
    const content = await fetchFromSite(num);

    if (content && content.statement) {
      const filepath = path.join(OPEN_DIR, `${num}.md`);
      if (updateMarkdownFile(filepath, content)) {
        updated++;
        console.log(`  [${num}] Updated!`);
      }
      fetched++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone! Fetched ${fetched}, updated ${updated} files.`);
}

main().catch(console.error);
