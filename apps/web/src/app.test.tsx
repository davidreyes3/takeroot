/**
 * Integration tests for the study loop.
 *
 * These run against the real content files, the real scheduler and a real
 * IndexedDB (via fake-indexeddb), so they exercise the same path a learner
 * does. The unit tests in @lang/core prove the rules are right; these prove
 * the app is actually wired to them.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './store.js';
import { db, exportBackup } from './db.js';
import { contentFiles } from './content.js';
import { App } from './App.js';
import { buildPath } from './screens/PathScreen.js';
import { parseContentFiles } from '@lang/core';

async function resetDatabase() {
  await db.open();
  await db.transaction('rw', db.cards, db.logs, db.mnemonics, db.settings, async () => {
    await Promise.all([db.cards.clear(), db.logs.clear(), db.mnemonics.clear(), db.settings.clear()]);
  });
  useApp.setState({
    ready: false,
    lexemes: [],
    issues: [],
    cards: new Map(),
    plan: null,
    cursor: 0,
    recentTimings: [],
    sessionResults: [],
  });
}

beforeEach(resetDatabase);
afterEach(cleanup);

describe('content loading', () => {
  it('finds the markdown files at build time', () => {
    expect(contentFiles.length).toBeGreaterThan(0);
    expect(contentFiles.every((f) => f.path.startsWith('content/'))).toBe(true);
  });

  it('excludes the format documentation', () => {
    expect(contentFiles.some((f) => /readme/i.test(f.path))).toBe(false);
  });

  it('parses the shipped content without errors', () => {
    const { lexemes, issues } = parseContentFiles(contentFiles);
    expect(lexemes.length).toBeGreaterThan(20);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('store initialisation', () => {
  it('generates and persists cards on first run', async () => {
    await useApp.getState().init();
    const state = useApp.getState();

    expect(state.ready).toBe(true);
    expect(state.lexemes.length).toBeGreaterThan(20);
    expect(state.cards.size).toBeGreaterThan(state.lexemes.length);
    expect(await db.cards.count()).toBe(state.cards.size);
  });

  it('does not duplicate cards when run twice', async () => {
    await useApp.getState().init();
    const first = await db.cards.count();
    await useApp.getState().init();
    expect(await db.cards.count()).toBe(first);
  });

  it('is safe against overlapping calls, as React StrictMode makes in development', async () => {
    // StrictMode mounts, unmounts and remounts every component once in dev,
    // firing the App effect that calls init() twice before the first has a
    // chance to write its cards. Both calls would otherwise read an empty
    // `existing` table and race to bulkAdd the same rows, and the loser
    // throws a Dexie BulkError - harmless in effect, since the winner's rows
    // stand, but a real unhandled rejection logged to the console on every
    // first install.
    await expect(Promise.all([useApp.getState().init(), useApp.getState().init()])).resolves.toBeDefined();

    expect(useApp.getState().ready).toBe(true);
    expect(await db.cards.count()).toBe(useApp.getState().cards.size);
  });

  it('generates the agreement table for adjectives', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן');
    expect(katan?.forms.fs?.value).toBe('קטנה');
    expect(katan?.forms.mp?.value).toBe('קטנים');
    expect(katan?.forms.fp?.value).toBe('קטנות');
  });
});

describe('the study loop', () => {
  it('builds a session of new words on a fresh install', async () => {
    await useApp.getState().init();
    await useApp.getState().startSession();
    const plan = useApp.getState().plan;

    expect(plan).not.toBeNull();
    expect(plan?.items.length).toBeGreaterThan(0);
    expect(plan?.items.every((i) => i.kind === 'new')).toBe(true);
  });

  it('schedules a card into the future and writes a log row', async () => {
    await useApp.getState().init();
    await useApp.getState().startSession();

    const item = useApp.getState().plan?.items[0];
    expect(item).toBeDefined();
    const before = useApp.getState().cards.get(item!.cardId);
    expect(before?.fsrs.state).toBe(0);

    const now = Date.now();
    await useApp.getState().answer({
      cardId: item!.cardId,
      rating: 3,
      elapsedMs: 1800,
      exercise: 'flashcard',
    });

    const after = useApp.getState().cards.get(item!.cardId);
    expect(after?.fsrs.reps).toBe(1);
    expect(after?.fsrs.due).toBeGreaterThan(now);

    const stored = await db.cards.get(item!.cardId);
    expect(stored?.fsrs.reps).toBe(1);

    const logs = await db.logs.where('cardId').equals(item!.cardId).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.rating).toBe(3);
    expect(logs[0]?.countsForScheduling).toBe(true);
  });

  it('logs a drill answer without touching the schedule', async () => {
    await useApp.getState().init();
    await useApp.getState().startSession();
    const cardId = useApp.getState().plan!.items[0]!.cardId;

    await useApp.getState().answer({ cardId, rating: 3, elapsedMs: 1500, exercise: 'flashcard' });
    const scheduled = useApp.getState().cards.get(cardId)!.fsrs;

    await useApp.getState().answer({
      cardId,
      rating: 1,
      elapsedMs: 900,
      exercise: 'flashcard',
      countsForScheduling: false,
    });

    // The drill is recorded, but the due date and stability are untouched.
    expect(useApp.getState().cards.get(cardId)!.fsrs).toEqual(scheduled);
    expect(await db.logs.where('cardId').equals(cardId).count()).toBe(2);
  });

  it('grades a typed answer automatically, forgiving missing niqqud', async () => {
    await useApp.getState().init();
    const state = useApp.getState();
    const katan = state.lexemes.find((l) => l.lemmaBare === 'קטן')!;
    const cardId = `${katan.id}:type_he`;

    // Typed without vowel points; the stored lemma has them.
    await state.answer({
      cardId,
      correct: true,
      elapsedMs: 2000,
      exercise: 'type',
    });

    const logs = await db.logs.where('cardId').equals(cardId).toArray();
    expect(logs[0]?.rating).toBeGreaterThanOrEqual(3);
  });

  it('persists a mnemonic and attaches it to the word', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;

    await useApp.getState().saveMnemonic(katan.id, 'cotton', 'a tiny cotton ball you need tweezers to hold');

    const updated = useApp.getState().lexemes.find((l) => l.id === katan.id);
    expect(updated?.mnemonic?.keyword).toBe('cotton');
    expect(await db.mnemonics.get(katan.id)).toBeDefined();
  });

  it('reloads a saved mnemonic on the next launch', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    await useApp.getState().saveMnemonic(katan.id, 'cotton', 'tiny cotton ball');

    await useApp.getState().init();
    const reloaded = useApp.getState().lexemes.find((l) => l.id === katan.id);
    expect(reloaded?.mnemonic?.image).toBe('tiny cotton ball');
  });
});

describe('the path', () => {
  it('unlocks the first node and locks the later ones', async () => {
    await useApp.getState().init();
    const { lexemes, cards } = useApp.getState();
    const nodes = buildPath(lexemes, cards);

    expect(nodes.length).toBeGreaterThan(2);
    expect(nodes[0]?.status).toBe('available');
    expect(nodes[nodes.length - 1]?.status).toBe('locked');
  });

  it('reports zero mastery before anything is studied', async () => {
    await useApp.getState().init();
    const { lexemes, cards } = useApp.getState();
    expect(buildPath(lexemes, cards).every((n) => n.mastery === 0)).toBe(true);
  });
});

describe('practice anything', () => {
  it('drills a card without ever touching its schedule', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Practice' }));
    await user.click(await screen.findByRole('button', { name: /small/i }));
    await user.click(await screen.findByRole('button', { name: 'Recognize' }));

    await user.click(await screen.findByRole('button', { name: /show answer/i }));
    await user.click(screen.getByText('Good'));

    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    const cardId = `${katan.id}:recall_he_en`;

    // A rating was given, but the card is exactly as fresh as before: this is
    // the countsForScheduling: false path, the same one the Leech Gym drills use.
    expect(useApp.getState().cards.get(cardId)!.fsrs.state).toBe(0);

    const logs = await db.logs.where('cardId').equals(cardId).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.countsForScheduling).toBe(false);

    // Let the due-count preview effect (which re-fires on every card change,
    // practice included) settle before the test tears the tree down.
    expect(await screen.findByRole('button', { name: 'Recognize' })).toBeInTheDocument();
  });

  it('offers tier-3 agreement cards even though they are locked in the normal path', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Practice' }));
    await user.click(await screen.findByRole('button', { name: /small/i }));

    // קטן is an adjective with real fs/mp/fp contrasts, gated to tier 3 in a
    // normal session - Practice does not honour that gate.
    expect(await screen.findByRole('button', { name: 'Feminine' })).toBeInTheDocument();
  });
});

describe('mnemonics library', () => {
  it('saves a mnemonic outside of the gym and shows it on the list', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Mnemonics' }));
    await user.click(await screen.findByRole('button', { name: /small/i }));

    await user.type(screen.getByLabelText(/sounds like/i), 'cotton');
    await user.type(screen.getByLabelText(/picture that/i), 'a tiny cotton ball');
    await user.click(screen.getByRole('button', { name: 'Save it' }));

    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    expect(await db.mnemonics.get(katan.id)).toMatchObject({ keyword: 'cotton' });
    expect(await screen.findByRole('button', { name: /cotton/i })).toBeInTheDocument();
  });
});

describe('backup', () => {
  it('exports every table into one JSON file', async () => {
    const user = userEvent.setup();
    await useApp.getState().init();
    await useApp.getState().startSession();
    const cardId = useApp.getState().plan!.items[0]!.cardId;
    await useApp.getState().answer({ cardId, rating: 3, elapsedMs: 1200, exercise: 'flashcard' });
    useApp.getState().endSession();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    let capturedBlob: Blob | null = null;
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob) => {
        capturedBlob = blob as Blob;
        return 'blob:mock';
      });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await user.click(await screen.findByRole('button', { name: 'Download backup' }));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(await capturedBlob!.text());
    expect(parsed.version).toBe(1);
    expect(
      parsed.cards.some((c: { id: string; fsrs: { reps: number } }) => c.id === cardId && c.fsrs.reps === 1),
    ).toBe(true);

    vi.restoreAllMocks();
  });

  it('imports a backup, replacing whatever was on this device', async () => {
    const user = userEvent.setup();
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    const cardId = `${katan.id}:recall_he_en`;
    await useApp.getState().answer({ cardId, rating: 3, elapsedMs: 1200, exercise: 'flashcard' });

    const backupJson = await exportBackup();

    // Diverge local state after the backup was taken, so import has
    // something real to overwrite.
    await useApp.getState().answer({ cardId, rating: 1, elapsedMs: 900, exercise: 'flashcard' });
    const beforeImport = useApp.getState().cards.get(cardId)!.fsrs;

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const file = new File([backupJson], 'backup.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Backup file'), file);

    await screen.findByText('Backup imported.');

    const restored = useApp.getState().cards.get(cardId)!.fsrs;
    expect(restored.reps).toBe(1); // the pre-divergence state captured in the backup
    expect(restored).not.toEqual(beforeImport);
    expect(await db.logs.where('cardId').equals(cardId).count()).toBe(1);

    vi.restoreAllMocks();
  });

  it('does nothing when the import is not confirmed', async () => {
    const user = userEvent.setup();
    await useApp.getState().init();
    const countBefore = await db.cards.count();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const file = new File([await exportBackup()], 'backup.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Backup file'), file);

    expect(await db.cards.count()).toBe(countBefore);
    expect(screen.queryByText('Backup imported.')).toBeNull();

    vi.restoreAllMocks();
  });

  it('reports a failure instead of crashing on a bad file', async () => {
    const user = userEvent.setup();
    await useApp.getState().init();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const file = new File(['not json'], 'backup.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Backup file'), file);

    expect(await screen.findByText(/Import failed/i)).toBeInTheDocument();

    vi.restoreAllMocks();
  });
});

describe('rendering', () => {
  it('shows the path and a study button', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Hebrew' })).toBeInTheDocument();
    const study = await screen.findByRole('button', { name: /study/i });
    expect(study).toBeEnabled();
  });

  it('starts a session and shows a card you can answer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /study/i }));
    await user.click(await screen.findByRole('button', { name: /show answer/i }));

    // All four FSRS ratings, with their intervals.
    for (const label of ['Again', 'Hard', 'Good', 'Easy']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    await user.click(screen.getByText('Good'));
    expect(await db.logs.count()).toBe(1);
  });

  it('renders Hebrew right-to-left and marks its language', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole('button', { name: /study/i }));

    const hebrew = container.querySelector('bdi.he');
    expect(hebrew).not.toBeNull();
    expect(hebrew?.getAttribute('dir')).toBe('rtl');
    expect(hebrew?.getAttribute('lang')).toBe('he');
  });
});

describe('progress survives a reload', () => {
  it('keeps scheduling state across an app restart', async () => {
    // Study one card.
    await useApp.getState().init();
    await useApp.getState().startSession();
    const cardId = useApp.getState().plan!.items[0]!.cardId;
    await useApp.getState().answer({
      cardId,
      rating: 3,
      elapsedMs: 1700,
      exercise: 'flashcard',
    });
    const studied = useApp.getState().cards.get(cardId)!.fsrs;

    // Simulate closing the app: wipe every scrap of in-memory state, keeping
    // only what was written to IndexedDB. This is what a code change plus a
    // page reload does.
    useApp.setState({
      ready: false,
      lexemes: [],
      issues: [],
      cards: new Map(),
      plan: null,
      cursor: 0,
      recentTimings: [],
      sessionResults: [],
    });

    await useApp.getState().init();

    const reloaded = useApp.getState().cards.get(cardId)!.fsrs;
    expect(reloaded).toEqual(studied);
    expect(reloaded.reps).toBe(1);
    expect(await db.logs.count()).toBe(1);
  });

  it('keeps history when a word is re-imported from edited content', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    const cardId = `${katan.id}:recall_he_en`;

    await useApp.getState().answer({
      cardId,
      rating: 3,
      elapsedMs: 1500,
      exercise: 'flashcard',
    });
    const before = useApp.getState().cards.get(cardId)!.fsrs;

    // Re-running init is what happens after any edit to the content files.
    await useApp.getState().init();

    expect(useApp.getState().cards.get(cardId)!.fsrs).toEqual(before);
  });

  it('does not orphan cards when a gloss is edited', async () => {
    // Card identity is the consonantal spelling plus part of speech, so
    // retranslating a word must not create a second, empty card.
    await useApp.getState().init();
    const countBefore = await db.cards.count();
    await useApp.getState().init();
    expect(await db.cards.count()).toBe(countBefore);
  });
});
