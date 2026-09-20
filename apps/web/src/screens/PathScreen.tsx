import { useMemo, useState } from 'react';
import type { Card, Lexeme } from '@lang/core';
import { useApp } from '../store.js';
import { LessonPreview } from './LessonPreview.js';

/**
 * A lesson wants roughly this many words: enough to be worth opening, few
 * enough to finish in one sitting.
 */
const MIN_LESSON = 4;
const MAX_LESSON = 8;

/**
 * When a unit stops counting as "the one you're working on".
 *
 * Nearly finished is not finished, so a section at 90% is still the one to
 * open on - right up until it has also been left alone for a few days, at
 * which point you have plainly moved on and opening it again would only show
 * a wall of ticks.
 */
const SETTLED_MASTERY = 0.9;
const SETTLED_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export interface LessonNode {
  id: string;
  unit: number;
  title: string;
  lexemes: Lexeme[];
  /** Words in this lesson whose recall_he_en card has reached Review state. */
  mastered: number;
  mastery: number;
  /** Most recent answer to any card of any word in this lesson. */
  lastStudiedAt?: number;
  status: 'available' | 'complete';
}

/** One collapsible section of the path: every lesson under one unit. */
export interface UnitSummary {
  unit: number;
  nodes: LessonNode[];
  words: number;
  mastered: number;
  mastery: number;
  lastStudiedAt?: number;
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
 * Every node is open. Nodes used to unlock only once the one before it hit
 * 60% mastery - the reasoning was that gating the whole course behind one
 * stubborn word would be worse than letting mastery lag, and that is still
 * true, but the fix traded away something else: there was no way to jump
 * ahead, or back, to study one specific lesson on purpose. This is a
 * deliberate reversal of that decision, in favour of trusting the learner to
 * order their own course. The ring around each node still tracks mastery -
 * it just no longer gates anything.
 */
export function buildPath(lexemes: readonly Lexeme[], cards: ReadonlyMap<string, Card>): LessonNode[] {
  // When each word was last answered, taken from any of its cards rather than
  // only the one mastery is measured on: typing a word is still working on it.
  const lastByLexeme = new Map<string, number>();
  for (const card of cards.values()) {
    const at = card.fsrs.last_review;
    if (at === undefined) continue;
    const previous = lastByLexeme.get(card.lexemeId);
    if (previous === undefined || at > previous) lastByLexeme.set(card.lexemeId, at);
  }

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
      let lastStudiedAt: number | undefined;
      for (const lexeme of lesson.lexemes) {
        const card = cards.get(`${lexeme.id}:recall_he_en`);
        if (card && card.fsrs.state === 2) graduated++;
        const at = lastByLexeme.get(lexeme.id);
        if (at !== undefined && (lastStudiedAt === undefined || at > lastStudiedAt)) lastStudiedAt = at;
      }
      const mastery = lesson.lexemes.length === 0 ? 0 : graduated / lesson.lexemes.length;

      const node: LessonNode = {
        id: `u${unit}-l${index + 1}`,
        unit,
        title: lesson.title,
        lexemes: lesson.lexemes,
        mastered: graduated,
        mastery,
        status: mastery >= 1 ? 'complete' : 'available',
      };
      // Absent, not undefined: a lesson never studied has no date at all.
      if (lastStudiedAt !== undefined) node.lastStudiedAt = lastStudiedAt;
      nodes.push(node);
    });
  }

  return nodes;
}

/** Fold the path's lessons back into the units they came from, in unit order. */
export function buildUnits(nodes: readonly LessonNode[]): UnitSummary[] {
  const byUnit = new Map<number, UnitSummary>();
  for (const node of nodes) {
    let summary = byUnit.get(node.unit);
    if (!summary) {
      summary = { unit: node.unit, nodes: [], words: 0, mastered: 0, mastery: 0 };
      byUnit.set(node.unit, summary);
    }
    summary.nodes.push(node);
    summary.words += node.lexemes.length;
    summary.mastered += node.mastered;
    if (
      node.lastStudiedAt !== undefined &&
      (summary.lastStudiedAt === undefined || node.lastStudiedAt > summary.lastStudiedAt)
    ) {
      summary.lastStudiedAt = node.lastStudiedAt;
    }
  }

  const units = [...byUnit.values()].sort((a, b) => a.unit - b.unit);
  for (const summary of units) {
    summary.mastery = summary.words === 0 ? 0 : summary.mastered / summary.words;
  }
  return units;
}

/**
 * Which section the path opens on.
 *
 * Nine units of several lessons each is a long scroll to reach the one you
 * actually meant to study, so every section starts closed except the one you
 * are working on - which is simply the one answered most recently. The
 * exception is a section you have all but finished and then left alone: that
 * one is behind you, so the path opens on the first section still worth work
 * instead. Returns null when nothing qualifies, and everything stays closed.
 */
export function chooseOpenUnit(units: readonly UnitSummary[], now: number): number | null {
  let recent: UnitSummary | undefined;
  for (const unit of units) {
    if (unit.lastStudiedAt === undefined) continue;
    if (recent === undefined || unit.lastStudiedAt > (recent.lastStudiedAt ?? 0)) recent = unit;
  }

  if (
    recent !== undefined &&
    !(recent.mastery >= SETTLED_MASTERY && now - (recent.lastStudiedAt ?? 0) > SETTLED_AFTER_MS)
  ) {
    return recent.unit;
  }

  return units.find((u) => u.mastery < SETTLED_MASTERY)?.unit ?? null;
}

export interface PathScreenProps {
  lexemes: Lexeme[];
  cards: Map<string, Card>;
  unitTitles: Map<number, string>;
}

export interface LessonPathProps {
  nodes: LessonNode[];
  unitTitles: Map<number, string>;
  /** Tapping a node studies that lesson - see PathScreen. */
  onSelect: (node: LessonNode) => void;
}

/**
 * The stepping-stone path itself: one collapsible card per unit, every lesson
 * inside it open - see `buildPath` and `chooseOpenUnit`.
 *
 * The two states are deliberately asymmetric. Closed, the whole card is one
 * target, because the only thing anyone can want from a closed section is to
 * see inside it. Open, only the header bar closes it again, so reaching for a
 * lesson can never shut the section from under your finger.
 *
 * Which sections are open is not persisted. "Everything closed but where I
 * am" is a fresh answer to where you are now, not a setting to maintain.
 */
export function LessonPath({ nodes, unitTitles, onSelect }: LessonPathProps) {
  const units = useMemo(() => buildUnits(nodes), [nodes]);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => {
    const start = chooseOpenUnit(units, Date.now());
    return new Set(start === null ? [] : [start]);
  });

  function toggle(unit: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(unit)) next.add(unit);
      return next;
    });
  }

  return (
    <>
      {units.map((summary) => {
        const title = unitTitles.get(summary.unit) ?? `Unit ${summary.unit}`;
        const isOpen = open.has(summary.unit);
        const progress = `${summary.mastered} of ${summary.words} words mastered`;

        return (
          <section key={summary.unit} className="unit" data-open={isOpen}>
            <button
              className="unit-toggle"
              onClick={() => toggle(summary.unit)}
              aria-expanded={isOpen}
              aria-controls={isOpen ? `unit-${summary.unit}-lessons` : undefined}
              aria-label={`${isOpen ? 'Collapse' : 'Open'} ${title}, ${progress}`}
            >
              <span className="unit-bar">
                <span className="unit-name">{title}</span>
                <span className="unit-count">
                  {summary.mastered}
                  <span className="unit-count-of">/{summary.words}</span>
                </span>
                {/* Drawn rather than typed: the chevron characters sit off
                    the optical centre of the bar and rotate untidily. */}
                <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>

              <span className="unit-progress" aria-hidden="true">
                <span className="unit-progress-fill" style={{ width: `${summary.mastery * 100}%` }} />
              </span>

              {/* Closed, the section still says what is in it, so choosing
                  between sections never needs opening them one by one. */}
              {!isOpen && (
                <span className="unit-lessons">
                  {summary.nodes.map((node) => (
                    <span key={node.id} className="unit-lesson">
                      {node.title}
                    </span>
                  ))}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="nodes" id={`unit-${summary.unit}-lessons`}>
                {summary.nodes.map((node, i) => (
                  <div key={node.id} className="node-row" data-offset={[0, -1, 0, 1][i % 4]}>
                    <div>
                      <button
                        className="node"
                        style={{ ['--mastery' as string]: node.mastery }}
                        onClick={() => onSelect(node)}
                        aria-label={`${node.title}, ${Math.round(node.mastery * 100)}% mastered`}
                      >
                        <span className="ring" aria-hidden="true" />
                        <span className="glyph">{node.status === 'complete' ? '✓' : '✦'}</span>
                      </button>
                      <div className="node-label">{node.title}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * The path, unlocked: every lesson is tappable, and tapping one studies just
 * that lesson.
 *
 * This used to be a read-only progress display, with a separate Practice tab
 * doing what tapping a node now does directly. Folding the two together only
 * works because the lock is gone - a locked node could not honestly also be a
 * shortcut into that lesson.
 *
 * Answers here count towards scheduling, same as anywhere else. What keeps
 * that from turning into a hundred surprise reviews is scope, not the
 * counting: `startSession` is confined to the tapped lesson's words, so it
 * still takes at most one card per word and is still capped by the session
 * length - a six-word lesson can add at most six cards, no matter how often
 * it is opened.
 */
export function PathScreen({ lexemes, cards, unitTitles }: PathScreenProps) {
  const startSession = useApp((s) => s.startSession);
  const nodes = useMemo(() => buildPath(lexemes, cards), [lexemes, cards]);
  const [previewing, setPreviewing] = useState<LessonNode | null>(null);

  if (previewing) {
    return (
      <LessonPreview
        node={previewing}
        unitTitle={unitTitles.get(previewing.unit) ?? `Unit ${previewing.unit}`}
        cards={cards}
        onBack={() => setPreviewing(null)}
        onStart={() => {
          setPreviewing(null);
          void startSession({ lexemeIds: previewing.lexemes.map((l) => l.id) });
        }}
      />
    );
  }

  return (
    <div className="path">
      <LessonPath nodes={nodes} unitTitles={unitTitles} onSelect={setPreviewing} />
    </div>
  );
}
