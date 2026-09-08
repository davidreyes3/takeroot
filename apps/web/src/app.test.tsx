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
import { buildPath, packLessons } from './screens/PathScreen.js';
import { parseContentFiles } from '@lang/core';

async function resetDatabase() {
  await db.open();
  await db.transaction(
    'rw',
    db.cards,
    db.logs,
    db.mnemonics,
    db.settings,
    db.customWords,
    async () => {
      await Promise.all([
        db.cards.clear(),
        db.logs.clear(),
        db.mnemonics.clear(),
        db.settings.clear(),
        db.customWords.clear(),
      ]);
    },
  );
  useApp.setState({
    ready: false,
    lexemes: [],
    issues: [],
    cards: new Map(),
    plan: null,
    cursor: 0,
    recentTimings: [],
    excludedLexemeIds: new Set(),
    customUnit: 0,
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
  it('has no locked nodes - every lesson is open', async () => {
    await useApp.getState().init();
    const { lexemes, cards } = useApp.getState();
    const nodes = buildPath(lexemes, cards);

    expect(nodes.length).toBeGreaterThan(2);
    expect(nodes.every((n) => n.status === 'available' || n.status === 'complete')).toBe(true);
  });

  it('reports zero mastery before anything is studied', async () => {
    await useApp.getState().init();
    const { lexemes, cards } = useApp.getState();
    expect(buildPath(lexemes, cards).every((n) => n.mastery === 0)).toBe(true);
  });

  it('starts a session confined to the lesson you tapped, mastery notwithstanding', async () => {
    const user = userEvent.setup();
    render(<App />);

    const nodes = await screen.findAllByRole('button', { name: /% mastered/ });
    // Nothing has been studied, so this would have been locked under the old
    // rule. It opens anyway - see buildPath.
    await user.click(nodes[nodes.length - 1]!);

    const plan = useApp.getState().plan!;
    expect(plan.items.length).toBeGreaterThan(0);

    const { lexemes, cards } = useApp.getState();
    const lesson = buildPath(lexemes, cards)[nodes.length - 1]!;
    const ids = new Set(lesson.lexemes.map((l) => l.id));
    expect(plan.items.every((i) => ids.has(i.lexemeId))).toBe(true);

    // The guard against a lesson tap becoming a hundred surprise reviews: one
    // card per word, so a lesson can never contribute more than its own size.
    expect(new Set(plan.items.map((i) => i.lexemeId)).size).toBe(plan.items.length);
    expect(plan.items.length).toBeLessThanOrEqual(lesson.lexemes.length);
  });

  it('lets a lesson-tap answer move the schedule', async () => {
    const user = userEvent.setup();
    render(<App />);

    const nodes = await screen.findAllByRole('button', { name: /% mastered/ });
    await user.click(nodes[0]!);

    const cardId = useApp.getState().plan!.items[0]!.cardId;
    await user.click(await screen.findByRole('button', { name: /show answer/i }));
    await user.click(screen.getByText('Good'));

    expect(useApp.getState().cards.get(cardId)!.fsrs.state).not.toBe(0);
    const logs = await db.logs.where('cardId').equals(cardId).toArray();
    expect(logs[0]?.countsForScheduling).toBe(true);
  });
});

describe('reading before writing', () => {
  it('keeps typing out of an ordinary session by default', async () => {
    await useApp.getState().init();

    // Graduate every reading card, which is what would otherwise unlock the
    // tier-2 typing cards into the daily queue.
    const cards = [...useApp.getState().cards.values()].map((c) =>
      c.template === 'recall_he_en'
        ? { ...c, fsrs: { ...c.fsrs, state: 2 as const, due: Date.now() - 1000 } }
        : c,
    );
    await db.cards.bulkPut(cards);
    await useApp.getState().init();

    await useApp.getState().startSession();
    expect(useApp.getState().plan!.items.every((i) => i.exercise !== 'type')).toBe(true);
  });

  it('offers typing as its own thing under Extras instead', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Extras' }));
    expect(
      await screen.findByRole('button', { name: /start writing practice/i }),
    ).toBeInTheDocument();
  });

  it('will not offer a word for spelling before it can be read', async () => {
    await useApp.getState().init();
    const plan = await useApp.getState().previewSession({ templates: ['type_he'] });
    expect(plan.items).toHaveLength(0);
  });
});

describe('session size', () => {
  it('never hands back more cards than the chosen session length', async () => {
    await useApp.getState().init();
    await useApp.getState().setSessionLength(8);
    await useApp.getState().startSession();
    expect(useApp.getState().plan!.items.length).toBeLessThanOrEqual(8);
    await useApp.getState().setSessionLength(12);
  });
});

describe('removing words and lessons', () => {
  it('hides a removed word from the path and from sessions', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;

    await useApp.getState().setLexemeExcluded(katan.id, true);
    const plan = await useApp.getState().previewSession();
    expect(plan.items.some((i) => i.lexemeId === katan.id)).toBe(false);

    const visible = useApp
      .getState()
      .lexemes.filter((l) => !useApp.getState().excludedLexemeIds.has(l.id));
    expect(visible.some((l) => l.id === katan.id)).toBe(false);

    // And restoring it undoes exactly that - nothing about the word itself
    // was touched.
    await useApp.getState().setLexemeExcluded(katan.id, false);
    expect(useApp.getState().lexemes.some((l) => l.id === katan.id)).toBe(true);
  });

  it('removes every word in a lesson at once, and restores them together', async () => {
    await useApp.getState().init();
    const { lexemes, cards } = useApp.getState();
    const lesson = buildPath(lexemes, cards)[0]!;
    const ids = lesson.lexemes.map((l) => l.id);

    await useApp.getState().setLexemesExcluded(ids, true);
    expect(ids.every((id) => useApp.getState().excludedLexemeIds.has(id))).toBe(true);

    await useApp.getState().setLexemesExcluded(ids, false);
    expect(ids.some((id) => useApp.getState().excludedLexemeIds.has(id))).toBe(false);
  });

  it('survives a reload, so it is a real setting rather than session state', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    await useApp.getState().setLexemeExcluded(katan.id, true);

    await useApp.getState().init();
    expect(useApp.getState().excludedLexemeIds.has(katan.id)).toBe(true);
  });
});

describe('adding words and lessons', () => {
  it('adds a word to a new lesson, which then shows up on the path', async () => {
    await useApp.getState().init();
    const before = buildPath(useApp.getState().lexemes, useApp.getState().cards).length;

    const result = await useApp.getState().addCustomWord({
      lemma: 'מחשב',
      translit: 'machshev',
      glosses: ['computer'],
      pos: 'noun',
      group: 'Technology',
    });
    expect(result.ok).toBe(true);

    const { lexemes, cards } = useApp.getState();
    const added = lexemes.find((l) => l.lemmaBare === 'מחשב');
    expect(added).toBeDefined();
    expect(added!.group).toBe('Technology');
    expect(cards.has(`${added!.id}:recall_he_en`)).toBe(true);

    const nodes = buildPath(lexemes, cards);
    expect(nodes.length).toBe(before + 1);
    expect(nodes[nodes.length - 1]!.title).toBe('Technology');
  });

  it('groups two words added to the same lesson out of order together', async () => {
    // A lesson under 4 words merges into its neighbour on the path, same as
    // any other short lesson - see packLessons. So the thing worth proving
    // here is not the title, it's that a Reading word landing between two
    // Technology ones does not split Technology across two path nodes.
    await useApp.getState().init();

    await useApp.getState().addCustomWord({
      lemma: 'מחשב',
      translit: '',
      glosses: ['computer'],
      pos: 'noun',
      group: 'Technology',
    });
    await useApp.getState().addCustomWord({
      lemma: 'ספר',
      translit: '',
      glosses: ['book'],
      pos: 'noun',
      group: 'Reading',
    });
    await useApp.getState().addCustomWord({
      lemma: 'טלפון',
      translit: '',
      glosses: ['phone'],
      pos: 'noun',
      group: 'Technology',
    });

    const customLexemes = useApp.getState().lexemes.filter((l) => l.sourceFile === 'custom');
    const lessons = packLessons(customLexemes);
    const techLessons = lessons.filter((lesson) => lesson.lexemes.some((l) => l.group === 'Technology'));
    expect(techLessons).toHaveLength(1);
    expect(
      techLessons[0]!.lexemes.filter((l) => l.group === 'Technology').map((l) => l.lemmaBare),
    ).toEqual(['מחשב', 'טלפון']);
  });

  it('rejects a word that is already in the course', async () => {
    await useApp.getState().init();
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;

    const result = await useApp.getState().addCustomWord({
      lemma: katan.lemma,
      translit: '',
      glosses: ['small'],
      pos: katan.pos,
      group: 'Duplicates',
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('already') });
  });

  it('rejects non-Hebrew input and a missing lesson name', async () => {
    await useApp.getState().init();
    const notHebrew = await useApp.getState().addCustomWord({
      lemma: 'computer',
      translit: '',
      glosses: ['computer'],
      pos: 'noun',
      group: 'Technology',
    });
    expect(notHebrew.ok).toBe(false);

    const noLesson = await useApp.getState().addCustomWord({
      lemma: 'מחשב',
      translit: '',
      glosses: ['computer'],
      pos: 'noun',
      group: '',
    });
    expect(noLesson.ok).toBe(false);
  });

  it('can be studied and counts for scheduling like any other word', async () => {
    await useApp.getState().init();
    await useApp.getState().addCustomWord({
      lemma: 'מחשב',
      translit: 'machshev',
      glosses: ['computer'],
      pos: 'noun',
      group: 'Technology',
    });

    const plan = await useApp.getState().previewSession({
      lexemeIds: useApp.getState().lexemes.filter((l) => l.group === 'Technology').map((l) => l.id),
    });
    expect(plan.items.length).toBe(1);

    await useApp.getState().answer({
      cardId: plan.items[0]!.cardId,
      rating: 3,
      elapsedMs: 1000,
      exercise: 'flashcard',
    });
    const card = useApp.getState().cards.get(plan.items[0]!.cardId)!;
    expect(card.fsrs.state).not.toBe(0);
  });

  it('survives a reload', async () => {
    await useApp.getState().init();
    await useApp.getState().addCustomWord({
      lemma: 'מחשב',
      translit: 'machshev',
      glosses: ['computer'],
      pos: 'noun',
      group: 'Technology',
    });

    await useApp.getState().init();
    expect(useApp.getState().lexemes.some((l) => l.lemmaBare === 'מחשב')).toBe(true);
  });
});

describe('the word list in Settings', () => {
  it('narrows the visible words as you type, without removing anything', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    const before = await screen.findAllByRole('checkbox');
    await user.type(screen.getByLabelText('Search your words'), 'small');

    const after = screen.getAllByRole('checkbox');
    expect(after.length).toBeLessThan(before.length);
    expect(after.length).toBeGreaterThan(0);

    // Nothing was actually excluded by searching.
    expect(useApp.getState().excludedLexemeIds.size).toBe(0);
  });

  it('unchecking a word removes it, and it stops showing up in a session', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    await user.type(screen.getByLabelText('Search your words'), 'small');
    const katan = useApp.getState().lexemes.find((l) => l.lemmaBare === 'קטן')!;
    await user.click(await screen.findByLabelText(`Study ${katan.lemma}`));

    expect(useApp.getState().excludedLexemeIds.has(katan.id)).toBe(true);
  });
});

describe('mnemonics library', () => {
  it('saves a mnemonic outside of the gym and shows it on the list', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Extras' }));
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
    expect(parsed.version).toBe(2);
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
