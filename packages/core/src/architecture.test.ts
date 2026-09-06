/**
 * Architectural guard.
 *
 * `@lang/core` must stay framework-agnostic. The moment it imports React or
 * Dexie, the Capacitor/native path stops being a repackaging job and becomes a
 * rewrite. This test is cheap insurance against that drifting in unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  'react',
  'react-dom',
  'dexie',
  'zustand',
  '@lang/web',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('core stays framework-agnostic', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports no UI or storage framework', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
        const spec = match[1] as string;
        if (FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))) {
          offenders.push(`${file} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('touches no browser globals', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Strip comments first: prose legitimately mentions "the window" and
      // "IndexedDB", and flagging documentation would train us to ignore this.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/\/\/.*$/gmu, '');
      if (/\b(document|window|localStorage|indexedDB|navigator)\s*\./u.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
