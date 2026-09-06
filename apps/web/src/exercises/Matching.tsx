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
  const words = useMemo(() => [target, ...pool.slice(0, 4)], [target.id, pool]);
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

  useEffect(() => {
    if (pickedHe === null || pickedEn === null) return;

    if (pickedHe === pickedEn) {
      const next = new Set(matched);
      next.add(pickedHe);
      setMatched(next);
      setPickedHe(null);
      setPickedEn(null);

      if (next.size === words.length) {
        onDone({ mistakes: mistakes.current, elapsedMs: Date.now() - startedAt.current });
      }
    } else {
      mistakes.current += 1;
      setWrong(pickedHe);
      timer.current = setTimeout(() => {
        setWrong(null);
        setPickedHe(null);
        setPickedEn(null);
      }, 450);
    }
  }, [pickedHe, pickedEn]);

  const stateOf = (id: string, picked: string | null) => {
    if (matched.has(id)) return 'matched';
    if (wrong !== null && picked === id) return 'wrong';
    if (picked === id) return 'picked';
    return undefined;
  };

  return (
    <div>
      <div className="banner calm">Match each word to its meaning.</div>
      <div className="match-grid">
        <div className="match-col">
          {hebrewTiles.map((tile) => (
            <button
              key={`he-${tile.lexemeId}`}
              className="match"
              data-state={stateOf(tile.lexemeId, pickedHe)}
              onClick={() => setPickedHe(tile.lexemeId)}
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
              onClick={() => setPickedEn(tile.lexemeId)}
            >
              {tile.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
