/**
 * Integration tests for the study loop.
 *
 * These run against the real content files, the real scheduler and a real
 * IndexedDB (via fake-indexeddb), so they exercise the same path a learner
 * does. The unit tests in @lang/core prove the rules are right; these prove
 * the app is actually wired to them.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './store.js';
import { db } from './db.js';
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
