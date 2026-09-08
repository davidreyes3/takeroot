import { useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { buildSession, type SessionStats } from '@lang/core';
import { useApp } from './store.js';
import { recentLogsFor } from './db.js';
import { PathScreen } from './screens/PathScreen.js';
import { PracticeScreen } from './screens/PracticeScreen.js';
import { MnemonicsScreen } from './screens/MnemonicsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { SessionScreen } from './screens/SessionScreen.js';

type View = 'path' | 'practice' | 'mnemonics' | 'settings';

export function App() {
  const { ready, lexemes, cards, plan, cursor, issues, init, startSession, endSession } = useApp();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [view, setView] = useState<View>('path');
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    void init();
  }, [init]);

  // Preview what a session would contain, so the study button can be honest
  // about what is waiting rather than just saying "Study".
  useEffect(() => {
    if (!ready || plan) return;
    let cancelled = false;
    void (async () => {
      const list = [...cards.values()];
      const logsByCard = await recentLogsFor(list.map((c) => c.id));
      if (cancelled) return;
      const preview = buildSession({ cards: list, lexemes, logsByCard, now: Date.now() });
      setStats(preview.stats);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, plan, cards, lexemes]);

  const unitTitles = useMemo(() => {
    const titles = new Map<number, string>();
    for (const lexeme of lexemes) {
      if (!titles.has(lexeme.unit)) {
        const fromFile = /(\d+)-([\w-]+)\.md$/u.exec(lexeme.sourceFile)?.[2];
        titles.set(lexeme.unit, fromFile ? fromFile.replace(/-/gu, ' ') : `Unit ${lexeme.unit}`);
      }
    }
    return titles;
  }, [lexemes]);

  if (!ready) {
    return (
      <div className="app">
        <p className="muted center">Loading…</p>
      </div>
    );
  }

  if (plan) {
    return (
      <div className="app">
        <SessionScreen
          plan={plan}
          cursor={cursor}
          cards={cards}
          lexemes={lexemes}
          onFinish={() => {
            endSession();
            setStats(null);
          }}
        />
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const nothingToDo = stats !== null && stats.dueCount === 0 && stats.newAvailable === 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Hebrew</h1>
        <div className="stats">
          {stats && stats.leechCount > 0 && (
            <span className="pill alert">
              <b>{stats.leechCount}</b> stuck
            </span>
          )}
          <span className="pill">
            <b>{stats?.dueCount ?? 0}</b> due
          </span>
          <span className="pill">
            <b>{lexemes.length}</b> words
          </span>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="banner">
          {errors.length} content error{errors.length === 1 ? '' : 's'}. Run{' '}
          <code>npm run content:check</code> to see them.
        </div>
      )}

      {needRefresh && (
        <div className="banner calm">
          An update is ready.{' '}
          <button className="link-btn" onClick={() => void updateServiceWorker(true)}>
            Reload to apply
          </button>
        </div>
      )}

      <nav className="tabs">
        <button className="tab" data-active={view === 'path'} onClick={() => setView('path')}>
          Path
        </button>
        <button className="tab" data-active={view === 'practice'} onClick={() => setView('practice')}>
          Practice
        </button>
        <button className="tab" data-active={view === 'mnemonics'} onClick={() => setView('mnemonics')}>
          Mnemonics
        </button>
        <button className="tab" data-active={view === 'settings'} onClick={() => setView('settings')}>
          Settings
        </button>
      </nav>

      {view === 'path' && <PathScreen lexemes={lexemes} cards={cards} unitTitles={unitTitles} />}
      {view === 'practice' && (
        <PracticeScreen lexemes={lexemes} cards={cards} unitTitles={unitTitles} />
      )}
      {view === 'mnemonics' && <MnemonicsScreen lexemes={lexemes} unitTitles={unitTitles} />}
      {view === 'settings' && <SettingsScreen />}

      {view === 'path' && (
        <div className="study-bar">
          <div className="study-bar-inner">
            <button className="btn" onClick={() => void startSession()} disabled={nothingToDo}>
              {nothingToDo
                ? 'All caught up'
                : stats
                  ? `Study — ${stats.dueCount} due${stats.newHeldBack ? '' : `, ${Math.min(8, stats.newAvailable)} new`}`
                  : 'Study'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
