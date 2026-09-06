/**
 * Local-first storage.
 *
 * Everything lives in IndexedDB on this device. No account, no network, works
 * on a plane. `SyncAdapter` is the seam where a cloud backend slots in later
 * without the rest of the app noticing.
 */

import Dexie, { type Table } from 'dexie';
import type { Card, Mnemonic, ReviewLog } from '@lang/core';

export interface StoredMnemonic extends Mnemonic {
  lexemeId: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

class LangDatabase extends Dexie {
  cards!: Table<Card, string>;
  logs!: Table<ReviewLog, string>;
  mnemonics!: Table<StoredMnemonic, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('hebrew-trainer');
    this.version(1).stores({
      // Booleans are not indexable in IndexedDB, so `suspended` is filtered in
      // memory rather than indexed. Due date is the hot path and is indexed.
      cards: 'id, lexemeId, fsrs.due, fsrs.state',
      logs: 'id, cardId, review',
      mnemonics: 'lexemeId',
      settings: 'key',
    });
  }
}

export const db = new LangDatabase();

/** Most recent logs for a card, newest last. Bounded on purpose. */
export async function recentLogs(cardId: string, limit = 10): Promise<ReviewLog[]> {
  const rows = await db.logs.where('cardId').equals(cardId).reverse().limit(limit).toArray();
  return rows.reverse();
}

/**
 * Recent logs for many cards in one pass.
 *
 * Deliberately capped: the session builder only ever looks at the last few
 * reviews per card, so loading a full history would be pure waste. See the
 * "6 rows vs 2,000 rows" test in the core package.
 */
export async function recentLogsFor(
  cardIds: readonly string[],
  perCard = 10,
): Promise<Map<string, ReviewLog[]>> {
  const out = new Map<string, ReviewLog[]>();
  await Promise.all(
    cardIds.map(async (id) => {
      const rows = await recentLogs(id, perCard);
      if (rows.length > 0) out.set(id, rows);
    }),
  );
  return out;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** Full backup. The manual answer to "sync later". */
export async function exportBackup(): Promise<string> {
  const [cards, logs, mnemonics, settings] = await Promise.all([
    db.cards.toArray(),
    db.logs.toArray(),
    db.mnemonics.toArray(),
    db.settings.toArray(),
  ]);
  return JSON.stringify({ version: 1, exportedAt: Date.now(), cards, logs, mnemonics, settings });
}

export async function importBackup(json: string): Promise<void> {
  const data = JSON.parse(json) as {
    version: number;
    cards: Card[];
    logs: ReviewLog[];
    mnemonics: StoredMnemonic[];
    settings: Setting[];
  };
  if (data.version !== 1) throw new Error(`Unsupported backup version ${data.version}`);

  await db.transaction('rw', db.cards, db.logs, db.mnemonics, db.settings, async () => {
    await Promise.all([db.cards.clear(), db.logs.clear(), db.mnemonics.clear(), db.settings.clear()]);
    await Promise.all([
      db.cards.bulkAdd(data.cards),
      db.logs.bulkAdd(data.logs),
      db.mnemonics.bulkAdd(data.mnemonics),
      db.settings.bulkAdd(data.settings),
    ]);
  });
}
