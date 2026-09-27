// "Gekennzeichnete E-Mails" view: flagged mails as read-only task rows.

import { Flag, ListPlus, Paperclip } from 'lucide-react';
import type { MessageHeader } from '@shared/types';
import { api } from '../api/client';
import { attempt, toast } from '../store/app';
import { runCommand } from '../lib/commands';
import { Empty, IconButton, Spinner } from '../components/ui';
import { useTasks } from './store';
import { RoundCheck } from './TaskRow';
import { dueLabel } from './taskUtils';
import { startOfDay } from '../lib/format';

function FlaggedRow({ m }: { m: MessageHeader }): JSX.Element {
  const unflag = async (): Promise<void> => {
    // optimistic: hide the row right away; mail:changed reloads the list
    useTasks.setState({ flagged: useTasks.getState().flagged.filter((x) => x.id !== m.id) });
    const ok = await attempt(() => api.mail.setFlags([m.id], { flagged: false }).then(() => true));
    if (!ok) void useTasks.getState().loadFlagged();
    else toast('info', 'Kennzeichnung entfernt', { label: 'Rückgängig', run: () => void attempt(() => api.mail.setFlags([m.id], { flagged: true })) });
  };
  const toTask = async (): Promise<void> => {
    const t = await attempt(() => api.tasks.fromMessage(m.id));
    if (t) {
      await useTasks.getState().load();
      useTasks.getState().setView(`list:${t.listId}`);
      useTasks.getState().select(t.id);
    }
  };
  const overdue = m.dueAt !== null && startOfDay(m.dueAt) < startOfDay(Date.now());
  return (
    <div className="task-row flagged-row" onClick={() => void runCommand('open.message', String(m.id))} title="E-Mail öffnen">
      <RoundCheck checked={false} onToggle={() => void unflag()} label="Als erledigt markieren (Kennzeichnung entfernen)" />
      <div className="grow task-row-main">
        <div className={`task-row-title ellipsis${m.seen ? '' : ' unread'}`}>{m.subject || '(Ohne Betreff)'}</div>
        <div className="task-meta">
          <span className="task-meta-item">{m.from.name || m.from.address}</span>
          {m.dueAt !== null && (
            <>
              <span className="task-meta-sep">·</span>
              <span className={`task-meta-item${overdue ? ' overdue' : ''}`}>Fällig: {dueLabel(m.dueAt)}</span>
            </>
          )}
          {m.hasAttachments && (
            <>
              <span className="task-meta-sep">·</span>
              <span className="task-meta-item">
                <Paperclip size={12} />
              </span>
            </>
          )}
        </div>
      </div>
      <IconButton
        small
        label="Als Aufgabe übernehmen"
        onClick={(e) => {
          e.stopPropagation();
          void toTask();
        }}
      >
        <ListPlus size={16} />
      </IconButton>
      <Flag size={16} className="flagged-icon" />
    </div>
  );
}

export function FlaggedMails(): JSX.Element {
  const flagged = useTasks((s) => s.flagged);
  const loaded = useTasks((s) => s.flaggedLoaded);
  if (!loaded) {
    return (
      <div className="row muted" style={{ padding: 24, justifyContent: 'center' }}>
        <Spinner /> Wird geladen …
      </div>
    );
  }
  if (!flagged.length) {
    return (
      <Empty icon={<Flag size={40} />} title="Keine gekennzeichneten E-Mails">
        Kennzeichnen Sie E-Mails zur Nachverfolgung – sie erscheinen dann hier.
      </Empty>
    );
  }
  return (
    <div className="task-rows">
      {flagged.map((m) => (
        <FlaggedRow key={m.id} m={m} />
      ))}
    </div>
  );
}
