// Tasks module (Microsoft To Do style): smart lists + own lists, task list and detail panel.

import { useEffect, useRef } from 'react';
import { onEvent } from '../api/client';
import { useIntentHandler } from '../store/intent';
import { Splitter, useSplit } from '../components/ui';
import { useTasks } from './store';
import { TaskNav } from './TaskNav';
import { TaskListPane } from './TaskListPane';
import { TaskDetail } from './TaskDetail';
import { inView } from './taskUtils';

export function TasksView(): JSX.Element {
  const selectedId = useTasks((s) => s.selectedId);
  const [navW, startNav, dragNav] = useSplit('tasks-nav', 240, 180, 360);
  const [detailW, startDetail, dragDetail] = useSplit('tasks-detail', 360, 300, 560);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Task id requested by an intent before tasks were loaded */
  const pendingOpen = useRef<string | null>(null);

  useEffect(() => {
    void useTasks
      .getState()
      .load()
      .then(() => {
        if (pendingOpen.current) openTask(pendingOpen.current);
        pendingOpen.current = null;
      });
    void useTasks.getState().loadFlagged();
    let mailTimer: number | undefined;
    const offs = [
      onEvent('tasks:changed', () => void useTasks.getState().load()),
      onEvent('mail:changed', () => {
        window.clearTimeout(mailTimer);
        mailTimer = window.setTimeout(() => void useTasks.getState().loadFlagged(), 200);
      })
    ];
    return () => {
      window.clearTimeout(mailTimer);
      offs.forEach((o) => o());
    };
  }, []);

  useIntentHandler('tasks', (action, arg) => {
    const st = useTasks.getState();
    if (action === 'newTask') {
      if (st.view === 'done' || st.view === 'flagged') st.setView('myDay');
      // wait for the quick-add input to render
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else if (action === 'openTask' && arg) {
      if (st.loaded) openTask(arg);
      else pendingOpen.current = arg;
    }
  });

  return (
    <div className="tasks-view">
      <div style={{ width: navW, flex: 'none', display: 'flex' }}>
        <TaskNav />
      </div>
      <Splitter onPointerDown={(e) => startNav(e)} dragging={dragNav} />
      <TaskListPane inputRef={inputRef} />
      {selectedId && (
        <>
          <Splitter onPointerDown={(e) => startDetail(e, true)} dragging={dragDetail} />
          <div style={{ width: detailW, flex: 'none', display: 'flex' }}>
            <TaskDetail />
          </div>
        </>
      )}
    </div>
  );
}

/** Selects a task, switching to its list unless the current view already shows it */
function openTask(id: string): void {
  const st = useTasks.getState();
  const t = st.tasks.find((x) => x.id === id);
  if (!t) return;
  if (!inView(t, st.view) || st.view === 'flagged') st.setView(t.done ? 'done' : `list:${t.listId}`);
  st.select(id);
}
