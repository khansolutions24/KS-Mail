// Settings module: section navigation on the left, the selected section on the right.

import clsx from 'clsx';
import { Bell, CalendarDays, Database, FileText, Info, Keyboard, ListFilter, Mail, PenLine, Plane, SlidersHorizontal, Tag, Users, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Settings } from '@shared/types';
import { useApp } from '../store/app';
import { useIntentHandler } from '../store/intent';
import { Spinner } from '../components/ui';
import { useSettingsUi } from './uiState';
import { AccountsSection } from './AccountsSection';
import { AccountWizard } from './AccountWizard';
import { GeneralSection } from './GeneralSection';
import { MailSection } from './MailSection';
import { SignaturesSection, TemplatesSection } from './SignaturesSection';
import { RulesSection } from './RulesSection';
import { CategoriesSection, QuickStepsSection } from './OrganizeSections';
import { CalendarSection, NotificationsSection, OutOfOfficeSection } from './MiscSections';
import { ShortcutsSection } from './ShortcutsSection';
import { AboutSection, DataSection } from './DataSections';

interface SectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  render: (s: Settings) => JSX.Element;
}

const SECTIONS: SectionDef[] = [
  { id: 'accounts', label: 'Konten', icon: Users, group: 'Konten & E-Mail', render: (s) => <AccountsSection settings={s} /> },
  { id: 'general', label: 'Allgemein', icon: SlidersHorizontal, group: 'Konten & E-Mail', render: (s) => <GeneralSection settings={s} /> },
  { id: 'mail', label: 'E-Mail', icon: Mail, group: 'Konten & E-Mail', render: (s) => <MailSection settings={s} /> },
  { id: 'signatures', label: 'Signaturen', icon: PenLine, group: 'Konten & E-Mail', render: (s) => <SignaturesSection settings={s} /> },
  { id: 'rules', label: 'Regeln', icon: ListFilter, group: 'Organisieren', render: (s) => <RulesSection settings={s} /> },
  { id: 'categories', label: 'Kategorien', icon: Tag, group: 'Organisieren', render: (s) => <CategoriesSection settings={s} /> },
  { id: 'quicksteps', label: 'QuickSteps', icon: Zap, group: 'Organisieren', render: (s) => <QuickStepsSection settings={s} /> },
  { id: 'templates', label: 'Vorlagen', icon: FileText, group: 'Organisieren', render: (s) => <TemplatesSection settings={s} /> },
  { id: 'ooo', label: 'Automatische Antworten', icon: Plane, group: 'Organisieren', render: (s) => <OutOfOfficeSection settings={s} /> },
  { id: 'calendar', label: 'Kalender', icon: CalendarDays, group: 'App', render: (s) => <CalendarSection settings={s} /> },
  { id: 'notifications', label: 'Benachrichtigungen', icon: Bell, group: 'App', render: (s) => <NotificationsSection settings={s} /> },
  { id: 'shortcuts', label: 'Tastenkombinationen', icon: Keyboard, group: 'App', render: (s) => <ShortcutsSection settings={s} /> },
  { id: 'data', label: 'Daten & Sicherung', icon: Database, group: 'App', render: () => <DataSection /> },
  { id: 'about', label: 'Info', icon: Info, group: 'App', render: () => <AboutSection /> }
];

const GROUPS = [...new Set(SECTIONS.map((s) => s.group))];

export function SettingsView(): JSX.Element {
  const sectionId = useApp((s) => s.settingsSection);
  const settings = useApp((s) => s.settings);
  const oooActive = useApp((s) => !!s.settings?.outOfOffice.enabled);
  const accountErrors = useApp((s) => Object.values(s.sync).filter((x) => x.status === 'error').length);
  const wizard = useSettingsUi((s) => s.wizard);
  const bodyRef = useRef<HTMLDivElement>(null);

  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];

  useIntentHandler('settings', (action) => {
    if (action === 'newAccount') {
      useApp.setState({ settingsSection: 'accounts' });
      useSettingsUi.setState({ wizard: true });
    }
  });

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [section.id]);

  const select = (id: string): void => useApp.setState({ settingsSection: id });

  return (
    <div className="st-root">
      <nav className="pane pane-side st-nav" aria-label="Einstellungen">
        <div className="st-nav-title">Einstellungen</div>
        <div className="st-nav-scroll">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="nav-section">{g}</div>
              <div className="nav-list">
                {SECTIONS.filter((s) => s.group === g).map((s) => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-current={s.id === section.id ? 'page' : undefined}
                    className={clsx('nav-item', s.id === section.id && 'active')}
                    onClick={() => select(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(s.id);
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        // arrow keys move through the sections
                        e.preventDefault();
                        const i = SECTIONS.findIndex((x) => x.id === s.id);
                        const next = SECTIONS[(i + (e.key === 'ArrowDown' ? 1 : SECTIONS.length - 1)) % SECTIONS.length];
                        select(next.id);
                        e.currentTarget.closest('nav')?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
                      }
                    }}
                    data-id={s.id}
                  >
                    <s.icon size={17} />
                    <span className="grow ellipsis">{s.label}</span>
                    {s.id === 'ooo' && oooActive && <span className="st-nav-dot" title="Automatische Antworten sind eingeschaltet" />}
                    {s.id === 'accounts' && accountErrors > 0 && <span className="st-nav-dot error" title={`${accountErrors} Konto/Konten mit Fehler`} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="st-content" ref={bodyRef}>
        {settings ? (
          section.render(settings)
        ) : (
          <div className="st-loading">
            <Spinner /> Einstellungen werden geladen …
          </div>
        )}
      </div>
      <AccountWizard open={wizard} onClose={() => useSettingsUi.setState({ wizard: false })} />
    </div>
  );
}
