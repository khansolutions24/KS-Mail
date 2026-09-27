// Standalone window showing one message (opened via double click / "In neuem Fenster öffnen").

import { Archive, Flag, Forward, MailOpen, Printer, Reply, ReplyAll, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MessageHeader } from '@shared/types';
import { api, errorMessage, onEvent } from '../api/client';
import { Button, Empty, IconButton } from '../components/ui';
import { isElectron } from '../api/client';
import * as A from './actions';
import { MessageView } from './ReadingPane';
import { Composer } from './Composer';
import { useApp } from '../store/app';

export function MessageWindow({ id }: { id: number }): JSX.Element {
  const [m, setM] = useState<MessageHeader | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const composers = useApp((s) => s.composers);
  const active = useApp((s) => s.activeComposer);
  const composer = composers.find((c) => c.id === active);

  useEffect(() => {
    const load = (): void =>
      void api.mail
        .get(id)
        .then((x) => setM(x))
        .catch((e) => setError(errorMessage(e)));
    load();
    return onEvent('mail:changed', load);
  }, [id]);

  useEffect(() => {
    if (m) document.title = m.subject || 'Nachricht';
  }, [m]);

  const close = (): void => {
    if (isElectron) window.close();
    else history.back();
  };

  if (composer) return <Composer draft={composer} standalone onClose={() => useApp.getState().closeComposer(composer.id)} />;
  if (error) return <Empty title="Fehler">{error}</Empty>;
  if (m === undefined) return <div />;
  if (m === null) return <Empty title="Nachricht nicht gefunden">Die Nachricht wurde verschoben oder gelöscht.</Empty>;
  return (
    <div className="standalone-window">
      <div className="ribbon standalone-ribbon">
        <Button variant="subtle" icon={<Reply size={16} />} onClick={() => void A.reply('reply', m)}>
          Antworten
        </Button>
        <Button variant="subtle" icon={<ReplyAll size={16} />} onClick={() => void A.reply('replyAll', m)}>
          Allen antworten
        </Button>
        <Button variant="subtle" icon={<Forward size={16} />} onClick={() => void A.reply('forward', m)}>
          Weiterleiten
        </Button>
        <span className="ribbon-sep" />
        <IconButton label="Löschen" onClick={() => void A.remove(false, [m]).then(close)}>
          <Trash2 size={17} />
        </IconButton>
        <IconButton label="Archivieren" onClick={() => void A.archive([m]).then(close)}>
          <Archive size={17} />
        </IconButton>
        <IconButton label={m.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren'} onClick={() => void A.setRead(!m.seen, [m])}>
          <MailOpen size={17} />
        </IconButton>
        <IconButton label="Kennzeichnen" onClick={() => void A.toggleFlag([m])}>
          <Flag size={17} />
        </IconButton>
        <IconButton label="Drucken" onClick={() => void A.print([m])}>
          <Printer size={17} />
        </IconButton>
      </div>
      <div className="standalone-body">
        <MessageView m={m} standalone />
      </div>
    </div>
  );
}
