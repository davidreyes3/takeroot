/**
 * App state.
 *
 * Zustand rather than Context because the session screen updates on every
 * keystroke, and re-rendering the whole tree for a timer tick is exactly the
 * kind of avoidable waste that makes a study app feel sluggish on a phone.
 *
 * Rule of thumb honoured here: this file coordinates, it does not decide.
 * Every scheduling judgement is made in @lang/core and merely applied here.
 */

import { create } from 'zustand';
import {
  buildSession,
  createScheduler,
  gradeFromResult,
  median,
  parseContentFiles,
  reviewCard,
  syncCards,
  type Card,
  type ContentIssue,
  type ExerciseKind,
  type Lexeme,
  type Rating,
  type SessionItem,
  type SessionPlan,
} from '@lang/core';
import { db, recentLogsFor, getSetting, setSetting } from './db.js';
import { contentFiles } from './content.js';

/** Rolling window of answer times, used as the learner's personal baseline. */
const TIMING_WINDOW = 30;

interface AppState {
  ready: boolean;
  lexemes: Lexeme[];
  issues: ContentIssue[];
  cards: Map<string, Card>;
  plan: SessionPlan | null;
  cursor: number;
  recentTimings: number[];
  desiredRetention: number;
  /** Words answered this session, for the summary screen. */
  sessionResults: { lexemeId: string; rating: Rating }[];

  init: () => Promise<void>;
  startSession: () => Promise<void>;
  answer: (input: AnswerInput) => Promise<void>;
  endSession: () => void;
  setDesiredRetention: (value: number) => Promise<void>;
  saveMnemonic: (lexemeId: string, keyword: string, image: string) => Promise<void>;
}

export interface AnswerInput {
  cardId: string;
  /** Supplied directly by self-graded flashcards. */
  rating?: Rating;
  /** Supplied by auto-graded exercises instead of a rating. */
  correct?: boolean;
  usedHint?: boolean;
  elapsedMs: number;
  exercise: ExerciseKind;
  countsForScheduling?: boolean;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  lexemes: [],
  issues: [],
  cards: new Map(),
  plan: null,
  cursor: 0,
  recentTimings: [],
  desiredRetention: 0.9,
  sessionResults: [],

  async init() {
    const { lexemes, issues } = parseContentFiles(contentFiles);
    const now = Date.now();

    const existing = await db.cards.toArray();
    const { created } = syncCards(lexemes, existing, now);
    if (created.length > 0) await db.cards.bulkAdd(created);

    const all = await db.cards.toArray();
    const mnemonics = await db.mnemonics.toArray();
    const byLexeme = new Map(mnemonics.map((m) => [m.lexemeId, m]));
    for (const lexeme of lexemes) {
      const m = byLexeme.get(lexeme.id);
      if (m) lexeme.mnemonic = { keyword: m.keyword, image: m.image, createdAt: m.createdAt, shownCount: m.shownCount };
    }

    const retention = await getSetting('desiredRetention', 0.9);

    set({
      ready: true,
      lexemes,
      issues,
      cards: new Map(all.map((c) => [c.id, c])),
      desiredRetention: retention,
    });
  },

  async startSession() {
    const { cards, lexemes } = get();
    const list = [...cards.values()];
    const logsByCard = await recentLogsFor(list.map((c) => c.id));
    const plan = buildSession({ cards: list, lexemes, logsByCard, now: Date.now() });
    set({ plan, cursor: 0, sessionResults: [] });
  },

  async answer(input) {
    const state = get();
    const card = state.cards.get(input.cardId);
    if (!card) return;

    const scheduler = createScheduler({ requestRetention: state.desiredRetention });
    const rating: Rating =
      input.rating ??
      gradeFromResult({
        correct: input.correct ?? false,
        elapsedMs: input.elapsedMs,
        medianMs: median(state.recentTimings),
        usedHint: input.usedHint ?? false,
        exercise: input.exercise,
      });

    const { card: next, log } = reviewCard(scheduler, {
      card,
      rating,
      now: Date.now(),
      durationMs: input.elapsedMs,
      exercise: input.exercise,
      countsForScheduling: input.countsForScheduling ?? true,
    });

    await db.transaction('rw', db.cards, db.logs, async () => {
      await db.cards.put(next);
      await db.logs.add(log);
    });

    const cardsNext = new Map(state.cards);
    cardsNext.set(next.id, next);

    // Bounded: keep only the most recent timings, never the whole history.
    const timings = [...state.recentTimings, input.elapsedMs].slice(-TIMING_WINDOW);

    set({
      cards: cardsNext,
      recentTimings: timings,
      sessionResults:
        input.countsForScheduling === false
          ? state.sessionResults
          : [...state.sessionResults, { lexemeId: next.lexemeId, rating }],
    });
  },

  endSession() {
    set({ plan: null, cursor: 0 });
  },

  async setDesiredRetention(value) {
    await setSetting('desiredRetention', value);
    set({ desiredRetention: value });
  },

  async saveMnemonic(lexemeId, keyword, image) {
    const record = { lexemeId, keyword, image, createdAt: Date.now(), shownCount: 0 };
    await db.mnemonics.put(record);
    set((s) => ({
      lexemes: s.lexemes.map((l) =>
        l.id === lexemeId
          ? { ...l, mnemonic: { keyword, image, createdAt: record.createdAt, shownCount: 0 } }
          : l,
      ),
    }));
  },
}));

/** Advance to the next item; returns false when the session is finished. */
export function advance(): boolean {
  const { plan, cursor } = useApp.getState();
  if (!plan) return false;
  const next = cursor + 1;
  useApp.setState({ cursor: next });
  return next < plan.items.length;
}

export function currentItem(): SessionItem | null {
  const { plan, cursor } = useApp.getState();
  return plan?.items[cursor] ?? null;
}
