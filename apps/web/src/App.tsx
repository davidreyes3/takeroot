import { useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { SessionPlan } from '@lang/core';
import { useApp, visibleLexemes } from './store.js';
import { PathScreen } from './screens/PathScreen.js';
import { ExtrasScreen } from './screens/ExtrasScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { SessionScreen } from './screens/SessionScreen.js';

type View = 'path' | 'extras' | 'settings';

export function App() {
  const {
    ready,
    lexemes,
    cards,
    plan,
    cursor,
    issues,
    init,
    startSession,
    previewSession,
    endSession,
    sessionLength,
    typingEnabled,
    excludedLexemeIds,
  } = useApp();
  const [preview, setPreview] = useState<SessionPlan | null>(null);
  const [view, setView] = useState<View>('path');
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    void init();
  }, [init]);

  // Preview the exact session the Study button would start, so the button can
  // name what is actually coming rather than the size of the whole backlog.
  // Re-runs when the settings that shape it change, not only when cards do.
  useEffect(() => {
    if (!ready || plan) return;
    let cancelled = false;
    void (async () => {
      const next = await previewSession();
      if (!cancelled) setPreview(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, plan, cards, lexemes, excludedLexemeIds, previewSession, sessionLength, typingEnabled]);

  const visible = useMemo(
    () => visibleLexemes({ lexemes, excludedLexemeIds }),
    [lexemes, excludedLexemeIds],
  );

  const unitTitles = useMemo(() => {
    const titles = new Map<number, string>();
    for (const lexeme of lexemes) {
      if (!titles.has(lexeme.unit)) {
        // Words added from inside the app carry no source file to name a
        // unit after; they always land in one unit of their own.
        const title =
          lexeme.sourceFile === 'custom'
            ? 'Your words'
            : (/(\d+)-([\w-]+)\.md$/u.exec(lexeme.sourceFile)?.[2]?.replace(/-/gu, ' ') ?? `Unit ${lexeme.unit}`);
        titles.set(lexeme.unit, title);
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
            setPreview(null);
          }}
        />
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const stats = preview?.stats ?? null;
  const nothingToDo = preview !== null && preview.items.length === 0;
  // What this session holds, as opposed to what is outstanding overall.
  const plannedNew = preview?.items.filter((i) => i.kind === 'new').length ?? 0;
  const plannedReviews = (preview?.items.length ?? 0) - plannedNew;

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
        <button className="tab" data-active={view === 'extras'} onClick={() => setView('extras')}>
          Extras
        </button>
        <button className="tab" data-active={view === 'settings'} onClick={() => setView('settings')}>
          Settings
        </button>
      </nav>

      {view === 'path' && <PathScreen lexemes={visible} cards={cards} unitTitles={unitTitles} />}
      {view === 'extras' && <ExtrasScreen lexemes={visible} unitTitles={unitTitles} />}
      {view === 'settings' && <SettingsScreen lexemes={lexemes} unitTitles={unitTitles} />}

      {view === 'path' && (
        <div className="study-bar">
          <div className="study-bar-inner">
            <button className="btn" onClick={() => void startSession()} disabled={nothingToDo}>
              {nothingToDo
                ? 'All caught up'
                : preview
                  ? `Study — ${plannedReviews} review${plannedReviews === 1 ? '' : 's'}${plannedNew > 0 ? `, ${plannedNew} new` : ''}`
                  : 'Study'}
            </button>
            {stats !== null && stats.dueRemaining > 0 && (
              <div className="muted center" style={{ fontSize: 12, marginTop: 6 }}>
                {stats.dueRemaining} more due after this
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
