// Standalone composer window (pop-out). The draft is handed over through the local draft store.

import { useEffect, useState } from 'react';
import type { Draft } from '@shared/types';
import { api, isElectron } from '../api/client';
import { Empty } from '../components/ui';
import { Composer } from './Composer';

export function ComposeWindow({ draftId }: { draftId: string }): JSX.Element {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  useEffect(() => {
    void api.compose.localDrafts().then((list) => setDraft(list.find((d) => d.id === draftId) ?? null));
  }, [draftId]);
  useEffect(() => {
    if (draft) document.title = draft.subject || 'Neue E-Mail';
  }, [draft]);
  if (draft === undefined) return <div />;
  if (draft === null) return <Empty title="Entwurf nicht gefunden" />;
  return (
    <div className="standalone-window">
      <Composer
        draft={draft}
        standalone
        onClose={() => {
          if (isElectron) window.close();
          else history.back();
        }}
      />
    </div>
  );
}
