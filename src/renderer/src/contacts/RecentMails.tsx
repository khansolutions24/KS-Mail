// "Letzte E-Mails" section of the contact card: latest inbox messages from the contact's addresses.

import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { VIRTUAL, type MessageHeader } from '@shared/types';
import { api, onEvent } from '../api/client';
import { runCommand } from '../lib/commands';
import { listDate } from '../lib/format';
import { Spinner } from '../components/ui';

export function RecentMails({ emails }: { emails: string[] }): JSX.Element {
  const [items, setItems] = useState<MessageHeader[] | null>(null);
  const key = emails.join('|');

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        // one query per address (max. 3), merged and sorted by date
        const pages = await Promise.all(emails.slice(0, 3).map((e) => api.mail.list({ folderId: VIRTUAL.unifiedInbox, search: `von:${e}`, limit: 10 })));
        const seen = new Set<number>();
        const merged = pages
          .flatMap((p) => p.items)
          .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
          .sort((a, b) => b.date - a.date)
          .slice(0, 10);
        if (alive) setItems(merged);
      } catch {
        if (alive) setItems([]);
      }
    };
    setItems(emails.length ? null : []);
    if (emails.length) void load();
    const off = onEvent('mail:changed', () => {
      if (emails.length) void load();
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (items === null) {
    return (
      <div className="row muted small-text">
        <Spinner /> Wird geladen …
      </div>
    );
  }
  if (!items.length) return <div className="muted small-text">Keine E-Mails von diesem Kontakt im Posteingang.</div>;
  return (
    <div className="contact-mails">
      {items.map((m) => (
        <button key={m.id} type="button" className={`contact-mail${m.seen ? '' : ' unread'}`} onClick={() => void runCommand('open.message', String(m.id))}>
          <div className="row">
            <span className="grow ellipsis contact-mail-subject">{m.subject || '(Ohne Betreff)'}</span>
            {m.hasAttachments && <Paperclip size={12} className="muted" />}
            <span className="muted small-text">{listDate(m.date)}</span>
          </div>
          {m.snippet && <div className="ellipsis muted small-text">{m.snippet}</div>}
        </button>
      ))}
    </div>
  );
}
