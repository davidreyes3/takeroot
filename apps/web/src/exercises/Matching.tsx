import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lexeme } from '@lang/core';
import { Word } from '../components/Word.js';

export interface MatchingProps {
  /** The word being drilled. Always included in the grid. */
  target: Lexeme;
  /** Distractors. Up to four are used. */
  pool: Lexeme[];
  onDone: (result: { mistakes: number; elapsedMs: number }) => void;
}

interface Tile {
  lexemeId: string;
  text: string;
  hebrew: boolean;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * The pairing grid: Hebrew on one side, English on the other,
 * tap one of each to clear the pair.
 *
 * This is a *recognition* exercise, and the app treats it as one. It is
 * excellent for building fast form-meaning links under mild pressure, and
 * useless as evidence of recall - which is why a clean run here never earns an
 * Easy, and never on its own gets a word out of the gym.
 */
export function Matching({ target, pool, onDone }: MatchingProps) {
  /**
   * De-duplicate by word.
   *
   * The gym's pool is assembled from *cards*, and one word owns several cards,
   * so the same word can legitimately arrive twice. Rendering it twice put two
   * identical tiles on the board that greyed out together and made the grid
   * unfinishable. The pool is filtered upstream too; this is the belt to that
   * pair of braces, because a stuck exercise strands the learner completely.
   */
  const words = useMemo(() => {
    const seen = new Set<string>();
    const unique: Lexeme[] = [];
    for (const candidate of [target, ...pool]) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      unique.push(candidate);
      if (unique.length === 5) break;
    }
    return unique;
  }, [target, pool]);

  const seed = useMemo(() => words.length * 7919 + target.id.length, [words, target.id]);

  const hebrewTiles = useMemo<Tile[]>(
    () => shuffle(words.map((w) => ({ lexemeId: w.id, text: w.lemma, hebrew: true })), seed),
    [words, seed],
  );
  const englishTiles = useMemo<Tile[]>(
    () =>
      shuffle(
        words.map((w) => ({ lexemeId: w.id, text: w.glosses[0] ?? '', hebrew: false })),
        seed + 1,
      ),
    [words, seed],
  );

  const [pickedHe, setPickedHe] = useState<string | null>(null);
  const [pickedEn, setPickedEn] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string | null>(null);
  const mistakes = useRef(0);
  const startedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing the timeout on unmount matters: without it, a learner who leaves
  // mid-grid leaves a callback holding this component's state alive.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * Completion is derived from state, not signalled from inside the click
   * handler.
   *
   * The original version fired `onDone` at the moment of the final match, and
   * compared a Set of word ids against a tile count - so any mismatch between
   * those two numbers meant the grid could never report finished, and the
   * learner had no way out but to abandon the session. Deriving it means the
   * grid re-checks whenever state settles and cannot be left hanging.
   */
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (finished.current) return;
    // Fewer than two pairs is not a game; hand back rather than stick.
    if (words.length >= 2 && matched.size < words.length) return;

    finished.current = true;
    onDoneRef.current({ mistakes: mistakes.current, elapsedMs: Date.now() - startedAt.current });
  }, [matched, words.length]);

  useEffect(() => {
    if (pickedHe === null || pickedEn === null) return;

    if (pickedHe === pickedEn) {
      const next = new Set(matched);
      next.add(pickedHe);
      setMatched(next);
      setPickedHe(null);
      setPickedEn(null);
    } else {
      mistakes.current += 1;
      setWrong(pickedHe);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setWrong(null);
        setPickedHe(null);
        setPickedEn(null);
      }, 450);
    }
  }, [pickedHe, pickedEn]);

  /**
   * While a wrong pair is flashing red the board ignores taps. Accepting them
   * mid-flash let a stray click land against the still-selected tile and score
   * phantom mistakes, and it made the board feel unresponsive rather than
   * deliberate.
   */
  const stateOf = (id: string, picked: string | null) => {
    if (matched.has(id)) return 'matched';
    if (wrong !== null && picked === id) return 'wrong';
    if (picked === id) return 'picked';
    return undefined;
  };

  return (
    <div>
      <div className="match-grid">
        <div className="match-col">
          {hebrewTiles.map((tile) => (
            <button
              key={`he-${tile.lexemeId}`}
              className="match"
              data-state={stateOf(tile.lexemeId, pickedHe)}
              onClick={() => {
                if (wrong === null) setPickedHe(tile.lexemeId);
              }}
            >
              <Word text={tile.text} hebrew />
            </button>
          ))}
        </div>
        <div className="match-col">
          {englishTiles.map((tile) => (
            <button
              key={`en-${tile.lexemeId}`}
              className="match"
              data-state={stateOf(tile.lexemeId, pickedEn)}
              onClick={() => {
                if (wrong === null) setPickedEn(tile.lexemeId);
              }}
            >
              {tile.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
