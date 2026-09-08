import { useEffect, useState } from 'react';
import type { Lexeme } from '@lang/core';
import { useApp, WRITING_TEMPLATES } from '../store.js';
import { MnemonicsScreen } from './MnemonicsScreen.js';

export interface ExtrasScreenProps {
  lexemes: Lexeme[];
  unitTitles: Map<number, string>;
}

type Tool = 'writing' | 'mnemonics';

/**
 * The things that are not the course.
 *
 * Writing lives here rather than in the daily queue on purpose. Typing a word
 * out is a genuinely different skill from reading it, and mixing the two means
 * every session is paced by the harder one. Kept as its own door, writing is
 * something you go and do when you want it - and the cards, and their history,
 * are the same ones either way, so nothing is lost by leaving it alone for a
 * while.
 */
export function ExtrasScreen({ lexemes, unitTitles }: ExtrasScreenProps) {
  const { startSession, previewSession, typingEnabled } = useApp();
  const [tool, setTool] = useState<Tool>('writing');
  const [waiting, setWaiting] = useState<number | null>(null);

  // How many typing cards a writing session would actually contain, so the
  // button can say what it will do instead of possibly opening an empty one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const plan = await previewSession({ templates: WRITING_TEMPLATES });
      if (!cancelled) setWaiting(plan.items.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [previewSession]);

  return (
    <div className="stack">
      <div className="tabs sub">
        <button className="tab" data-active={tool === 'writing'} onClick={() => setTool('writing')}>
          Writing practice
        </button>
        <button
          className="tab"
          data-active={tool === 'mnemonics'}
          onClick={() => setTool('mnemonics')}
        >
          Mnemonics
        </button>
      </div>

      {tool === 'writing' ? (
        <>
          <p className="muted">
            Type the Hebrew from the English, with the on-screen keyboard. Separate from the daily
            path{typingEnabled ? '' : ', which is reading only'} — these answers still count
            towards scheduling.
          </p>

          <div className="card" style={{ minHeight: 0, alignItems: 'stretch', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Spelling round</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {waiting === null
                  ? 'Working out what is ready…'
                  : waiting === 0
                    ? 'Nothing is ready to spell yet. Words become available here once you can read them.'
                    : `${waiting} word${waiting === 1 ? '' : 's'} ready.`}
              </div>
            </div>
            <button
              className="btn"
              disabled={waiting === null || waiting === 0}
              onClick={() => void startSession({ templates: WRITING_TEMPLATES })}
            >
              Start writing practice
            </button>
          </div>
        </>
      ) : (
        <MnemonicsScreen lexemes={lexemes} unitTitles={unitTitles} />
      )}
    </div>
  );
}
