/**
 * Core domain types.
 *
 * Design rule: this package is framework-agnostic. Nothing here may import
 * React, Dexie, or anything DOM-specific. The web app depends on core;
 * core never depends on the app. This is what makes the Capacitor/native
 * path cheap later, and it is enforced by `no-ui-imports.test.ts`.
 */

// ---------------------------------------------------------------------------
// Lexemes (one real-world word, which generates many cards)
// ---------------------------------------------------------------------------

export type Pos =
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'prep'
  | 'pron'
  | 'num'
  | 'particle'
  | 'phrase';

export type Gender = 'm' | 'f' | 'mf';
export type GramNumber = 'sg' | 'pl' | 'dual';

/** The four agreement slots a Hebrew adjective inflects for. */
export type AgreementSlot = 'ms' | 'fs' | 'mp' | 'fp';

/** Where a piece of data came from. Drives UI trust cues and the gap report. */
export type Provenance = 'authored' | 'derived' | 'suggested';

export interface Sourced<T> {
  value: T;
  provenance: Provenance;
  /** Human-readable reason, shown in the content gap report. */
  note?: string;
}

export interface Lexeme {
  id: string;
  /** Hebrew as authored, niqqud included if the author supplied it. */
  lemma: string;
  /** Niqqud stripped, final letters preserved. Used for display fallback. */
  lemmaBare: string;
  /** Approximate Modern Israeli transliteration. Auto unless authored. */
  translit: Sourced<string>;
  /** English meanings, first is primary. */
  glosses: string[];
  pos: Pos;
  gender?: Sourced<Gender>;
  number?: Sourced<GramNumber>;
  /** Consonantal root, e.g. ['ק','ט','נ']. Empty when unknown. */
  root: Sourced<string[]>;
  /** Inflected forms keyed by slot; unpointed unless authored. */
  forms: Partial<Record<AgreementSlot, Sourced<string>>>;
  /** Example sentences used by cloze and context exercises. */
  examples: Example[];
  tags: string[];
  /** Unit number from the content file's frontmatter. Drives path order. */
  unit: number;
  /** Source file path, for round-tripping edits back to markdown. */
  sourceFile: string;
  sourceLine: number;
  notes?: string;
  mnemonic?: Mnemonic;
}

export interface Example {
  he: string;
  en: string;
}

/**
 * A keyword mnemonic, in the "200 Words a Day" / Linkword tradition:
 * an English sound-alike keyword plus a deliberately absurd image linking
 * it to the meaning. Absurdity is the point - it is what makes it stick.
 */
export interface Mnemonic {
  /** English word that sounds like the Hebrew, e.g. "kotton" for קָטָן. */
  keyword: string;
  /** The absurd linking image, authored by the learner. */
  image: string;
  createdAt: number;
  /** Times this mnemonic was shown as a hint. */
  shownCount: number;
}

// ---------------------------------------------------------------------------
// Cards (the schedulable unit; several per lexeme)
// ---------------------------------------------------------------------------

export type CardTemplate =
  | 'recall_he_en' // see Hebrew, recall English
  | 'recall_en_he' // see English, produce Hebrew (harder)
  | 'type_he' // see English, type the Hebrew
  | 'form_fs' // given ms adjective, produce feminine singular
  | 'form_mp'
  | 'form_fp'
  | 'cloze'; // word removed from an example sentence

/** Mirrors ts-fsrs `Card`, stored as plain data (timestamps as epoch ms). */
export interface FsrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: 0 | 1 | 2 | 3; // New | Learning | Review | Relearning
  last_review?: number;
}

export interface Card {
  id: string;
  lexemeId: string;
  template: CardTemplate;
  fsrs: FsrsState;
  /** Consecutive `Again` ratings. Reset on any pass. Feeds leech detection. */
  againStreak: number;
  /** True once the card trips the leech rule; cleared by graduating the gym. */
  isLeech: boolean;
  /** Suspended cards never enter any queue. */
  suspended: boolean;
  /** Set when the card is introduced, so the path can show progress. */
  introducedAt?: number;
}

export type Rating = 1 | 2 | 3 | 4; // Again | Hard | Good | Easy

/**
 * Append-only. Never mutated, never deleted - this is the training set for
 * the FSRS parameter optimizer later, and rewriting history would silently
 * corrupt the personalised weights.
 */
export interface ReviewLog {
  id: string;
  cardId: string;
  lexemeId: string;
  rating: Rating;
  /** Card state *before* this review. */
  state: 0 | 1 | 2 | 3;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: number;
  /** Milliseconds from prompt shown to answer submitted. */
  durationMs: number;
  /** Which exercise produced this rating. */
  exercise: ExerciseKind;
  /**
   * False for massed in-session drill repetitions. Only `true` rows are fed
   * to the optimizer - see docs/PLAN.md "Why drills are not reviews".
   */
  countsForScheduling: boolean;
}

export type ExerciseKind =
  | 'flashcard'
  | 'choice'
  | 'type'
  | 'matching'
  | 'speed'
  | 'cloze'
  | 'form';

// ---------------------------------------------------------------------------
// Path (the stepping-stone journey through the course)
// ---------------------------------------------------------------------------

export type TrackId = 'vocab' | 'grammar';

export interface LessonNode {
  id: string;
  track: TrackId;
  unit: number;
  title: string;
  lexemeIds: string[];
  /** Exercises this node uses, in order. */
  exercises: ExerciseKind[];
  /** Node ids that must be complete before this unlocks. */
  requires: string[];
}

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'complete';

export interface PathProgress {
  nodeId: string;
  status: NodeStatus;
  /** 0..1, fraction of the node's cards that have graduated to Review. */
  mastery: number;
  completedAt?: number;
}
