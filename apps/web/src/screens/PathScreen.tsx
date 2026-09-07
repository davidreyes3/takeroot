import { useMemo } from 'react';
import type { Card, Lexeme } from '@lang/core';

/**
 * A lesson wants roughly this many words: enough to be worth opening, few
 * enough to finish in one sitting.
 */
const MIN_LESSON = 4;
const MAX_LESSON = 8;

export interface LessonNode {
  id: string;
  unit: number;
  title: string;
  lexemes: Lexeme[];
  mastery: number;
  status: 'locked' | 'available' | 'complete';
}

/**
 * Pack a unit's words into lessons along the `##` headings they were written
 * under.
 *
 * Mechanical chunking produced two bad outcomes. Lessons straddled meaning - a
 * greeting filed together with "yes / no / but / or" - and units ended in
 * ragged tails: unit 1 finished with a two-word lesson that completed almost
 * instantly, so the path showed a node as done while the learner was still on
 * the first one.
 *
 * So a group is never split across lessons unless it is larger than
 * MAX_LESSON, and a group too small to stand alone is absorbed into its
 * neighbour. Merged lessons are named for both groups; split ones are
 * numbered.
 */
export function packLessons(words: readonly Lexeme[]): { title: string; lexemes: Lexeme[] }[] {
  const groups: { name: string; words: Lexeme[] }[] = [];
  for (const word of words) {
    const last = groups[groups.length - 1];
    if (last && last.name === word.group) last.words.push(word);
    else groups.push({ name: word.group, words: [word] });
  }

  const lessons: { title: string; lexemes: Lexeme[] }[] = [];

  for (const group of groups) {
    // Too big for one sitting: split into evenly sized numbered parts.
    if (group.words.length > MAX_LESSON) {
      lessons.push(...splitEvenly(group.name, group.words));
      continue;
    }

    // Small enough to join the lesson before it, if that one has room.
    const previous = lessons[lessons.length - 1];
    if (
      previous &&
      group.words.length < MIN_LESSON &&
      previous.lexemes.length + group.words.length <= MAX_LESSON
    ) {
      previous.title = `${previous.title} & ${group.name}`;
      previous.lexemes.push(...group.words);
      continue;
    }

    lessons.push({ title: group.name, lexemes: [...group.words] });
  }

  // A leftover tail still too small folds backwards, so no lesson can be
  // finished in two answers. Combining may overflow the cap, so the pair is
  // re-split evenly rather than simply concatenated.
  const last = lessons[lessons.length - 1];
  const secondLast = lessons[lessons.length - 2];
  if (last && secondLast && last.lexemes.length < MIN_LESSON) {
    const combined = [...secondLast.lexemes, ...last.lexemes];
    lessons.splice(-2, 2, ...splitEvenly(`${secondLast.title} & ${last.title}`, combined));
  }

  return lessons;
}

/**
 * Divide words into parts that are all as close to the same size as possible.
 *
 * Slicing by a fixed size instead leaves a remainder: 50 words in chunks of 8
 * ends with a lesson of 2, which is exactly the ragged tail this is meant to
 * avoid. Spreading the remainder across the earlier parts keeps every lesson
 * within one of every other.
 */
function splitEvenly(name: string, words: readonly Lexeme[]): { title: string; lexemes: Lexeme[] }[] {
  const parts = Math.max(1, Math.ceil(words.length / MAX_LESSON));
  const base = Math.floor(words.length / parts);
  const remainder = words.length % parts;

  const out: { title: string; lexemes: Lexeme[] }[] = [];
  let cursor = 0;
  for (let p = 0; p < parts; p++) {
    const size = base + (p < remainder ? 1 : 0);
    out.push({
      title: parts === 1 ? name : `${name} ${p + 1}`,
      lexemes: words.slice(cursor, cursor + size),
    });
    cursor += size;
  }
  return out;
}

/**
 * Build the path.
 *
 * A node unlocks when the one before it is 60% mastered rather than 100%.
 * Requiring perfection would gate the entire course behind whichever word you
 * personally find impossible, and that word is exactly what the Leech Gym is
 * for - it does not belong in the way of new material.
 */
export function buildPath(lexemes: readonly Lexeme[], cards: ReadonlyMap<string, Card>): LessonNode[] {
  const byUnit = new Map<number, Lexeme[]>();
  for (const lexeme of lexemes) {
    const list = byUnit.get(lexeme.unit);
    if (list) list.push(lexeme);
    else byUnit.set(lexeme.unit, [lexeme]);
  }

  const nodes: LessonNode[] = [];
  for (const [unit, words] of [...byUnit.entries()].sort((a, b) => a[0] - b[0])) {
    packLessons(words).forEach((lesson, index) => {
      let graduated = 0;
      for (const lexeme of lesson.lexemes) {
        const card = cards.get(`${lexeme.id}:recall_he_en`);
        if (card && card.fsrs.state === 2) graduated++;
      }
      const mastery = lesson.lexemes.length === 0 ? 0 : graduated / lesson.lexemes.length;

      nodes.push({
        id: `u${unit}-l${index + 1}`,
        unit,
        title: lesson.title,
        lexemes: lesson.lexemes,
        mastery,
        status: 'locked',
      });
    });
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as LessonNode;
    const previous = nodes[i - 1];
    if (node.mastery >= 1) node.status = 'complete';
    else if (i === 0 || (previous && previous.mastery >= 0.6)) node.status = 'available';
    else node.status = 'locked';
  }

  return nodes;
}

export interface PathScreenProps {
  lexemes: Lexeme[];
  cards: Map<string, Card>;
  unitTitles: Map<number, string>;
}

export function PathScreen({ lexemes, cards, unitTitles }: PathScreenProps) {
  const nodes = useMemo(() => buildPath(lexemes, cards), [lexemes, cards]);

  const units = useMemo(() => {
    const grouped = new Map<number, LessonNode[]>();
    for (const node of nodes) {
      const list = grouped.get(node.unit);
      if (list) list.push(node);
      else grouped.set(node.unit, [node]);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  }, [nodes]);

  return (
    <div className="path">
      {units.map(([unit, unitNodes]) => (
        <section key={unit} className="unit">
          <div className="unit-head">
            <h2>{unitTitles.get(unit) ?? `Unit ${unit}`}</h2>
          </div>
          <div className="nodes">
            {unitNodes.map((node, i) => (
              <div key={node.id} className="node-row" data-offset={[0, -1, 0, 1][i % 4]}>
                <div>
                  <button
                    className="node"
                    disabled={node.status === 'locked'}
                    style={{ ['--mastery' as string]: node.mastery }}
                    aria-label={`${node.title}, ${Math.round(node.mastery * 100)}% mastered`}
                  >
                    <span className="ring" aria-hidden="true" />
                    <span className="glyph">
                      {node.status === 'complete' ? '✓' : node.status === 'locked' ? '\u{1F512}' : '✦'}
                    </span>
                  </button>
                  <div className="node-label">{node.title}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
