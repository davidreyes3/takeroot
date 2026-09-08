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
  cardsForLexeme,
  createScheduler,
  gradeFromResult,
  hasHebrew,
  lexemeId,
  median,
  parseContentFiles,
  reviewCard,
  syncCards,
  DEFAULT_SESSION_CONFIG,
  type Card,
  type CardTemplate,
  type ContentIssue,
  type ExerciseKind,
  type Lexeme,
  type Rating,
  type SessionConfig,
  type SessionItem,
  type SessionPlan,
} from '@lang/core';
import { db, recentLogsFor, getSetting, setSetting } from './db.js';
import { contentFiles } from './content.js';
import {
  customWordToLexeme,
  makeCustomWord,
  orderCustomWords,
  resolvePos,
  validateCustomWord,
  type AddCustomWordInput,
} from './customWords.js';

/** Rolling window of answer times, used as the learner's personal baseline. */
const TIMING_WINDOW = 30;

/** Session lengths offered in Settings, shortest first. */
export const SESSION_LENGTHS = [8, 12, 20, 30] as const;

/**
 * The templates the typing setting governs.
 *
 * Typing is off by default because reading is the goal being worked towards
 * right now; producing the spelling from memory is a different skill, and
 * mixing it in makes every session longer and harder for no gain against that
 * goal. It is not deleted, only set aside - the cards and their history stay,
 * and Extras > Writing practice studies exactly these when they are wanted.
 */
export const WRITING_TEMPLATES: CardTemplate[] = ['type_he'];

/**
 * The words a session, the path, or Extras should actually offer -
 * everything except what has been hidden in Settings.
 *
 * A plain array filter rather than a stored field: recomputing this from
 * `lexemes` and `excludedLexemeIds` is cheap at this size and means the two
 * can never drift out of sync with each other.
 */
export function visibleLexemes(state: { lexemes: Lexeme[]; excludedLexemeIds: Set<string> }): Lexeme[] {
  return state.lexemes.filter((l) => !state.excludedLexemeIds.has(l.id));
}

/**
 * Guards `init` against overlapping calls.
 *
 * React StrictMode mounts, unmounts and remounts every component once in
 * development, firing the effect that calls init() twice before the first
 * run has written a single card. Both would otherwise read the cards table
 * as empty and race to bulkAdd the same rows, and the loser throws a Dexie
 * BulkError. Sharing one in-flight promise makes the second caller just wait
 * for the first instead of repeating its reads.
 */
let initPromise: Promise<void> | null = null;

interface AppState {
  ready: boolean;
  lexemes: Lexeme[];
  issues: ContentIssue[];
  cards: Map<string, Card>;
  plan: SessionPlan | null;
  cursor: number;
  recentTimings: number[];
  desiredRetention: number;
  /** Cards per session, the learner's own ceiling on one sitting. */
  sessionLength: number;
  /** Whether typing cards appear in ordinary sessions at all. */
  typingEnabled: boolean;
  /**
   * Words hidden from study - the path, sessions, Extras. Nothing about the
   * word is deleted: its cards and history stay exactly as they are, and
   * unchecking it in Settings brings it straight back where it left off.
   */
  excludedLexemeIds: Set<string>;
  /**
   * The unit number words added from inside the app land in - one past
   * whatever the authored content uses. Recomputed on every `init`, so it
   * never collides with a unit a later content edit introduces.
   */
  customUnit: number;
  /** Words answered this session, for the summary screen. */
  sessionResults: { lexemeId: string; rating: Rating }[];

  init: () => Promise<void>;
  startSession: (options?: StartSessionOptions) => Promise<void>;
  /** Build the same plan without starting it, so the UI can describe it. */
  previewSession: (options?: StartSessionOptions) => Promise<SessionPlan>;
  answer: (input: AnswerInput) => Promise<void>;
  endSession: () => void;
  setDesiredRetention: (value: number) => Promise<void>;
  setSessionLength: (value: number) => Promise<void>;
  setTypingEnabled: (value: boolean) => Promise<void>;
  /** Hide or restore one word. */
  setLexemeExcluded: (id: string, excluded: boolean) => Promise<void>;
  /** Hide or restore every word in one lesson at once. */
  setLexemesExcluded: (ids: readonly string[], excluded: boolean) => Promise<void>;
  /** Add a word, creating its lesson if the name given is a new one. */
  addCustomWord: (input: AddCustomWordInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  saveMnemonic: (lexemeId: string, keyword: string, image: string) => Promise<void>;
}

export interface StartSessionOptions {
  /** Confine the session to these words - one lesson's worth, for practice. */
  lexemeIds?: readonly string[];
  /**
   * Override the template filter. Left unset, the typing setting decides:
   * everything, or everything but typing.
   */
  templates?: readonly CardTemplate[];
  config?: Partial<SessionConfig>;
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
  sessionLength: DEFAULT_SESSION_CONFIG.maxItems,
  typingEnabled: false,
  excludedLexemeIds: new Set(),
  customUnit: 0,
  sessionResults: [],

  async init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const { lexemes: contentLexemes, issues } = parseContentFiles(contentFiles);
      const now = Date.now();

      // Words added from inside the app are stored separately from the
      // authored content and merged in here - see customWords.ts for why.
      const customUnit = contentLexemes.reduce((max, l) => Math.max(max, l.unit), 0) + 1;
      const customRecords = orderCustomWords(await db.customWords.toArray());
      const customLexemes = customRecords.map((r, i) => customWordToLexeme(r, customUnit, i));
      const lexemes = [...contentLexemes, ...customLexemes];

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
      const sessionLength = await getSetting('sessionLength', DEFAULT_SESSION_CONFIG.maxItems);
      const typingEnabled = await getSetting('typingEnabled', false);
      const excludedIds = await getSetting<string[]>('excludedLexemeIds', []);

      set({
        ready: true,
        lexemes,
        issues,
        cards: new Map(all.map((c) => [c.id, c])),
        desiredRetention: retention,
        sessionLength,
        typingEnabled,
        excludedLexemeIds: new Set(excludedIds),
        customUnit,
      });
    })();
    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  },

  async startSession(options) {
    const plan = await get().previewSession(options);
    set({ plan, cursor: 0, sessionResults: [] });
  },

  async previewSession(options) {
    const state = get();
    const { cards, sessionLength, typingEnabled } = state;
    const list = [...cards.values()];
    const logsByCard = await recentLogsFor(list.map((c) => c.id));
    // Writing practice narrows the queue to typing; the typing setting
    // disables it outright. The two are different, and buildSession treats
    // them differently - see BuildSessionInput.
    const writing = options?.templates !== undefined;
    return buildSession({
      cards: list,
      lexemes: visibleLexemes(state),
      logsByCard,
      now: Date.now(),
      config: { maxItems: sessionLength, ...options?.config },
      ...(options?.templates ? { templates: options.templates } : {}),
      ...(typingEnabled || writing ? {} : { disabledTemplates: WRITING_TEMPLATES }),
      ...(options?.lexemeIds ? { lexemeIds: options.lexemeIds } : {}),
    });
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

  async setSessionLength(value) {
    await setSetting('sessionLength', value);
    set({ sessionLength: value });
  },

  async setTypingEnabled(value) {
    await setSetting('typingEnabled', value);
    set({ typingEnabled: value });
  },

  async setLexemeExcluded(id, excluded) {
    const next = new Set(get().excludedLexemeIds);
    if (excluded) next.add(id);
    else next.delete(id);
    await setSetting('excludedLexemeIds', [...next]);
    set({ excludedLexemeIds: next });
  },

  async setLexemesExcluded(ids, excluded) {
    const next = new Set(get().excludedLexemeIds);
    for (const id of ids) {
      if (excluded) next.add(id);
      else next.delete(id);
    }
    await setSetting('excludedLexemeIds', [...next]);
    set({ excludedLexemeIds: next });
  },

  async addCustomWord(input) {
    const error = validateCustomWord(input, hasHebrew);
    if (error) return { ok: false, error };

    const state = get();
    const id = lexemeId(input.lemma, resolvePos(input.pos));
    if (state.lexemes.some((l) => l.id === id)) {
      return { ok: false, error: 'This word is already in your course.' };
    }

    const record = makeCustomWord(id, input);
    await db.customWords.add(record);

    // Re-derive the whole custom block rather than just appending: adding a
    // word to an existing lesson out of order still has to land it next to
    // that lesson's other words - see orderCustomWords.
    const contentLexemes = state.lexemes.filter((l) => l.sourceFile !== 'custom');
    const customRecords = orderCustomWords(
      await db.customWords.toArray(),
    );
    const customLexemes = customRecords.map((r, i) => customWordToLexeme(r, state.customUnit, i));
    const lexemes = [...contentLexemes, ...customLexemes];

    const now = Date.now();
    const newLexeme = customLexemes.find((l) => l.id === id)!;
    const newCards = cardsForLexeme(newLexeme, now);
    await db.cards.bulkAdd(newCards);

    const cardsNext = new Map(state.cards);
    for (const card of newCards) cardsNext.set(card.id, card);

    set({ lexemes, cards: cardsNext });
    return { ok: true };
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
