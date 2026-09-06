import { useMemo } from 'react';
import type { Card, Lexeme } from '@lang/core';

const LESSON_SIZE = 6;

export interface LessonNode {
  id: string;
  unit: number;
  title: string;
  lexemes: Lexeme[];
  mastery: number;
  status: 'locked' | 'available' | 'complete';
}

/**
 * Build the path.
 *
 * Units come from the content files' frontmatter and are chunked into lessons
 * of six words - small enough that a node is finishable in one sitting, which
 * is the whole psychological trick of a stepping-stone path.
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
    for (let i = 0; i < words.length; i += LESSON_SIZE) {
      const chunk = words.slice(i, i + LESSON_SIZE);
      const lessonNumber = Math.floor(i / LESSON_SIZE) + 1;

      let graduated = 0;
      for (const lexeme of chunk) {
        const card = cards.get(`${lexeme.id}:recall_he_en`);
        if (card && card.fsrs.state === 2) graduated++;
      }
      const mastery = chunk.length === 0 ? 0 : graduated / chunk.length;

      nodes.push({
        id: `u${unit}-l${lessonNumber}`,
        unit,
        title: chunk[0]?.glosses[0] ?? `Lesson ${lessonNumber}`,
        lexemes: chunk,
        mastery,
        status: 'locked',
      });
    }
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
