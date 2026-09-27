// "Nur dieses Vorkommen oder die ganze Serie?" question for recurring events.

import { Repeat } from 'lucide-react';
import { Button, Dialog } from '../components/ui';
import { useCalendar, type SeriesChoice } from './store';

export function SeriesDialog(): JSX.Element | null {
  const q = useCalendar((s) => s.series);
  if (!q) return null;
  const close = (choice: SeriesChoice | null): void => {
    useCalendar.setState({ series: null });
    q.resolve(choice);
  };
  return (
    <Dialog
      open
      onClose={() => close(null)}
      title={q.title}
      width={440}
      footer={
        <>
          <Button onClick={() => close(null)}>Abbrechen</Button>
          <Button onClick={() => close('series')}>Ganze Serie</Button>
          <Button variant="primary" autoFocus onClick={() => close('one')}>
            Nur dieses Vorkommen
          </Button>
        </>
      }
    >
      <div className="row cal-series-text">
        <Repeat size={20} className="muted" />
        <span>{q.text}</span>
      </div>
    </Dialog>
  );
}
