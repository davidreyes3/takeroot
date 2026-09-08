/**
 * Leech detection and the Leech Gym.
 *
 * The usual answer to a card you keep failing is to tag it and suspend it,
 * which is really an admission of defeat. This module is the alternative: detect the
 * word early, then escalate through progressively more aggressive
 * interventions until it sticks.
 *
 * The escalation is ordered by cognitive-science strength, not by novelty:
 *
 *   1. study            re-encode it properly before drilling it
 *   2. mnemonic         build a keyword image (only when repetition alone has failed)
 *   3. expanding drill  massed -> spaced retrieval within the session
 *   4. matching         recognition under mild time pressure
 *   5. speed            recognition under real time pressure
 *   6. final test       one *production* recall that actually counts
 *
 * Only step 6 touches the FSRS schedule. See "Why drills are not reviews".
 */

import type { Card, ExerciseKind, Lexeme, ReviewLog } from './types.js';

export interface LeechPolicy {
  /** Total lapses that mark a card as a leech. The conventional default is 8. */
  lapseThreshold: number;
  /** Consecutive `Again` answers that trigger the gym immediately. */
  againStreakThreshold: number;
  /** Rolling window of recent reviews used for the accuracy rule. */
  window: number;
  /** Accuracy below this over a full window marks a leech. */
  accuracyThreshold: number;
}

export const DEFAULT_LEECH_POLICY: LeechPolicy = {
  // Lower than the conventional 8 on purpose: with an intervention available, catching a
  // struggling word early is cheap, whereas eight failed reviews is weeks of
  // frustration for a word you still cannot read.
  lapseThreshold: 4,
  // Two Agains in a row, not three. Missing the same card twice in one
  // sitting is already good evidence you don't know it yet - waiting for a
  // third failure before offering help is making someone prove they're
  // struggling before the app will act on it.
  againStreakThreshold: 2,
  window: 6,
  accuracyThreshold: 0.6,
};

export type LeechReason = 'lapses' | 'again_streak' | 'low_accuracy';

export interface LeechVerdict {
  isLeech: boolean;
  reason?: LeechReason;
  /** 0..1, how badly the card is doing. Drives how far up the gym it starts. */
  severity: number;
  /**
   * This card's own lapses plus `companionLapses`, when a companion was
   * given. Optional so a hand-built verdict (tests, mostly) still works
   * without it - callers that care fall back to the card's own lapses.
   */
  totalLapses?: number;
}

/**
 * Decide whether a card needs intervention.
 *
 * `recentLogs` should be that card's most recent logs, newest last. Only rows
 * with `countsForScheduling` are considered, so a bad run inside a drill does
 * not immediately re-flag a card the learner is already working on.
 *
 * `companionLapses` is the word's *other* recognition-direction card's lapse
 * count, when there is one - recall_he_en's counterpart is recall_en_he and
 * vice versa. Forgetting a word is forgetting it, whichever direction you
 * were asked; a learner who fails "read it" twice and "produce it" twice has
 * failed four times, even though neither card alone has reached the
 * threshold. Left at 0 for a card with no such counterpart (type_he, cloze,
 * the form-drill templates), which only ever judge themselves.
 */
export function assessLeech(
  card: Card,
  recentLogs: readonly ReviewLog[],
  policy: LeechPolicy = DEFAULT_LEECH_POLICY,
  companionLapses = 0,
): LeechVerdict {
  const totalLapses = card.fsrs.lapses + companionLapses;

  if (card.suspended) return { isLeech: false, severity: 0, totalLapses };

  if (card.againStreak >= policy.againStreakThreshold) {
    return {
      isLeech: true,
      reason: 'again_streak',
      severity: Math.min(1, card.againStreak / (policy.againStreakThreshold * 2)),
      totalLapses,
    };
  }

  if (totalLapses >= policy.lapseThreshold) {
    return {
      isLeech: true,
      reason: 'lapses',
      severity: Math.min(1, totalLapses / (policy.lapseThreshold * 2)),
      totalLapses,
    };
  }

  const scheduled = recentLogs.filter((l) => l.countsForScheduling).slice(-policy.window);
  if (scheduled.length >= policy.window) {
    const passed = scheduled.filter((l) => l.rating > 1).length;
    const accuracy = passed / scheduled.length;
    if (accuracy < policy.accuracyThreshold) {
      return {
        isLeech: true,
        reason: 'low_accuracy',
        severity: Math.min(1, 1 - accuracy),
        totalLapses,
      };
    }
  }

  return { isLeech: false, severity: 0, totalLapses };
}

// --- The gym ---------------------------------------------------------------

export type GymStepKind =
  | 'study'
  | 'mnemonic'
  | 'drill'
  | 'matching'
  | 'speed'
  | 'final_test';

export interface GymStep {
  kind: GymStepKind;
  /** The exercise this step renders as, if it is a graded one. */
  exercise?: ExerciseKind;
  /** Card ids in presentation order. For `drill`, includes interleaved fillers. */
  sequence: string[];
  /** Only ever true on the final test. */
  countsForScheduling: boolean;
  /** Shown above the step so the learner knows why they are doing it. */
  prompt: string;
  /** Milliseconds allowed per item; undefined means untimed. */
  timeLimitMs?: number;
}

export interface GymPlan {
  targetCardId: string;
  lexemeId: string;
  reason: LeechReason;
  steps: GymStep[];
}

/**
 * Build the interleaved repetition sequence: the "say it, go away, come back"
 * pattern.
 *
 * Two things are happening at once.
 *
 * The gaps expand (0, 1, 2, then 4 filler items) because expanding retrieval
 * practice beats both massed repetition and fixed spacing within a session -
 * each successful recall happens nearer the edge of forgetting, which is where
 * the strengthening actually happens.
 *
 * And each time the target comes back it comes back in a *different
 * direction*: Hebrew-to-English, then English-to-Hebrew, and round again.
 * That matters more than it looks. Repeating an identical prompt back to back
 * mostly reads the answer out of short-term memory, whereas flipping the
 * direction is a genuinely different retrieval each time. It also means the
 * drill still works when there is nothing else to interleave - the gap is
 * filled by a real task rather than padding.
 *
 * Degrades safely: with neither variants nor fillers it still terminates.
 */
export function buildDrillSequence(
  targetCardIds: readonly string[],
  fillerCardIds: readonly string[],
  repeats = 4,
): string[] {
  const variants = targetCardIds.filter((id) => id !== '');
  if (variants.length === 0) return [];

  const gaps = [0, 1, 2, 4];
  const sequence: string[] = [];
  let fillerIndex = 0;

  const safeRepeats = Math.max(1, Math.min(repeats, 8));
  for (let i = 0; i < safeRepeats; i++) {
    const gap = gaps[Math.min(i, gaps.length - 1)] as number;
    for (let g = 0; g < gap && fillerCardIds.length > 0; g++) {
      sequence.push(fillerCardIds[fillerIndex % fillerCardIds.length] as string);
      fillerIndex++;
    }
    sequence.push(variants[i % variants.length] as string);
  }
  return sequence;
}

export interface GymPlanInput {
  card: Card;
  lexeme: Lexeme;
  verdict: LeechVerdict;
  /**
   * The target word's cards, primary first. The drill rotates through these so
   * each repetition asks a different direction rather than repeating a prompt.
   */
  targetVariantIds?: readonly string[];
  /** Other cards available to interleave as filler. */
  fillerCardIds: readonly string[];
  /** Cards to populate the matching grid, target excluded. */
  matchingPoolIds: readonly string[];
  /**
   * Whether the closing test is typed. Defaults to true.
   *
   * Typing is the strongest closing test there is - producing the spelling
   * from nothing - and it is what the gym uses by default. But a learner
   * working purely on reading has turned typing off everywhere else, and
   * ending the gym with the one exercise they have opted out of would be a
   * wall rather than a test. With this false the gym closes on a self-graded
   * recall of the same card instead: weaker evidence, but still a real
   * retrieval, and still the one answer allowed to move the schedule.
   */
  typedFinalTest?: boolean;
}

/**
 * Assemble the gym session for one struggling card.
 *
 * Two escalation rules worth knowing about:
 *
 *  - The mnemonic step only appears once plain repetition has *already*
 *    failed (severity is high, or the word has real lapses). Asking someone to
 *    invent an absurd image for every hard word is exhausting, and the
 *    technique works best when it is reserved for the genuinely stubborn ones.
 *  - The speed round only appears at high severity. Time pressure on a word
 *    you barely know produces guessing, not learning.
 */
export function buildGymPlan(input: GymPlanInput): GymPlan {
  const { card, lexeme, verdict, fillerCardIds, matchingPoolIds } = input;
  const variants =
    input.targetVariantIds && input.targetVariantIds.length > 0
      ? [...input.targetVariantIds]
      : [card.id];
  const steps: GymStep[] = [];
  const target = card.id;

  steps.push({
    kind: 'study',
    sequence: [target],
    countsForScheduling: false,
    prompt: `Let's take another run at ${lexeme.lemma}. Read it, say it out loud, then we'll drill it.`,
  });

  // `totalLapses` folds in the word's other recognition-direction card when
  // assessLeech was given one, so a word failed from both sides earns the
  // mnemonic step even if neither card alone has 3 lapses. Falls back to this
  // card's own count for a hand-built verdict that never set it.
  const wantsMnemonic =
    !lexeme.mnemonic && (verdict.severity >= 0.5 || (verdict.totalLapses ?? card.fsrs.lapses) >= 3);
  if (wantsMnemonic) {
    steps.push({
      kind: 'mnemonic',
      sequence: [target],
      countsForScheduling: false,
      prompt:
        'Repetition alone is not working on this one. Build a memory hook: find an English word that sounds like it, then picture something absurd. The stranger the image, the better it sticks.',
    });
  }

  steps.push({
    kind: 'drill',
    exercise: 'flashcard',
    sequence: buildDrillSequence(variants, fillerCardIds),
    countsForScheduling: false,
    prompt:
      variants.length > 1
        ? 'Rapid fire. The word comes back at longer gaps, and from both directions.'
        : 'Rapid fire. The word comes back at longer and longer gaps.',
  });

  if (matchingPoolIds.length >= 3) {
    steps.push({
      kind: 'matching',
      exercise: 'matching',
      sequence: [target, ...matchingPoolIds.slice(0, 4)],
      countsForScheduling: false,
      prompt: 'Match them up.',
    });
  }

  if (verdict.severity >= 0.6 && matchingPoolIds.length >= 1) {
    steps.push({
      kind: 'speed',
      exercise: 'speed',
      sequence: [target, ...matchingPoolIds.slice(0, 1)],
      countsForScheduling: false,
      prompt: 'Fast round. Go with your gut.',
      timeLimitMs: 3000,
    });
  }

  // The final test always grades the target card itself, never a sibling.
  // The card is here because *its* againStreak and lapses flagged it, and only
  // answering that card resets them - grading a sibling would leave the word
  // flagged and drag it back into the gym next session, forever.
  const typed = input.typedFinalTest ?? true;
  steps.push({
    kind: 'final_test',
    exercise: typed ? 'type' : 'flashcard',
    sequence: [target],
    countsForScheduling: true,
    prompt: typed
      ? 'Now for real, no help: type it.'
      : 'Now for real, no help. Answer it, then grade yourself honestly.',
  });

  return {
    targetCardId: target,
    lexemeId: lexeme.id,
    reason: verdict.reason ?? 'lapses',
    steps,
  };
}

/**
 * Has the card earned its way out of leech status?
 *
 * Requires the final production test to have been passed, not merely the
 * drills - passing a drill five seconds after seeing the answer proves
 * nothing about tomorrow.
 */
export function graduatesFromGym(finalTestRating: number): boolean {
  return finalTestRating >= 3;
}
