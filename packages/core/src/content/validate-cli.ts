/**
 * Content checker: `npm run content:check`
 *
 * Reads every markdown file under content/, parses it, and reports what the
 * app had to guess. Exits non-zero on errors so it can gate a commit hook or
 * CI, but stays quiet about warnings in the exit code - guessed roots are a
 * to-do list, not a build failure.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseContentFiles } from './parse.js';
import type { Lexeme } from '../types.js';

const RESET = '[0m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const GREEN = '[32m';
const BOLD = '[1m';

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') out.push(full);
  }
  return out;
}

function gapReport(lexemes: Lexeme[]): string[] {
  const lines: string[] = [];
  const missingRoot = lexemes.filter((l) => l.root.value.length === 0);
  const guessedRoot = lexemes.filter((l) => l.root.provenance === 'suggested' && l.root.value.length > 0);
  const noTranslit = lexemes.filter((l) => l.translit.value === '');
  const noExamples = lexemes.filter((l) => l.examples.length === 0);

  if (missingRoot.length > 0) lines.push(`${missingRoot.length} without a root`);
  if (guessedRoot.length > 0) lines.push(`${guessedRoot.length} with a guessed root to confirm`);
  if (noTranslit.length > 0) lines.push(`${noTranslit.length} without a transliteration`);
  if (noExamples.length > 0) lines.push(`${noExamples.length} without an example sentence`);
  return lines;
}

function main(): number {
  const root = process.argv[2] ?? 'content';
  let paths: string[];
  try {
    paths = markdownFiles(root);
  } catch {
    console.error(`${RED}Could not read ${root}${RESET}`);
    return 1;
  }

  if (paths.length === 0) {
    console.log(`${YELLOW}No markdown files found under ${root}.${RESET}`);
    return 0;
  }

  const files = paths.map((path) => ({
    path: relative(process.cwd(), path).replace(/\\/gu, '/'),
    source: readFileSync(path, 'utf8'),
  }));

  const { lexemes, issues } = parseContentFiles(files);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  console.log(`\n${BOLD}${lexemes.length} words${RESET} across ${files.length} files\n`);

  for (const issue of [...errors, ...warnings]) {
    const colour = issue.severity === 'error' ? RED : YELLOW;
    const where = `${issue.file}:${issue.line}`;
    const what = issue.lemma ? ` ${issue.lemma}` : '';
    console.log(`${colour}${issue.severity}${RESET} ${DIM}${where}${RESET}${what}  ${issue.message}`);
  }

  const gaps = gapReport(lexemes);
  if (gaps.length > 0) {
    console.log(`\n${BOLD}Gaps you might want to fill${RESET}`);
    for (const line of gaps) console.log(`  ${DIM}-${RESET} ${line}`);
  }

  const byUnit = new Map<number, number>();
  for (const l of lexemes) byUnit.set(l.unit, (byUnit.get(l.unit) ?? 0) + 1);
  console.log(`\n${BOLD}Units${RESET}`);
  for (const [unit, count] of [...byUnit.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${DIM}unit ${unit}${RESET}  ${count} words`);
  }

  console.log(
    errors.length === 0
      ? `\n${GREEN}No errors.${RESET} ${warnings.length} warning(s).\n`
      : `\n${RED}${errors.length} error(s).${RESET} ${warnings.length} warning(s).\n`,
  );

  return errors.length === 0 ? 0 : 1;
}

process.exit(main());
