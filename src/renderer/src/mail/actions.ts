// Mail actions on the current selection – used by commands, ribbon, context menus and hover buttons.

import type { MessageHeader, RuleAction } from '@shared/types';
import { newId } from '@shared/util';
import { api, isElectron } from '../api/client';
import { attempt, confirm, folderById, pickFolder, prompt, succeeded, toast, useApp } from '../store/app';
import { selectedMessages, useMail } from '../store/mail';
import { setIntent } from '../store/intent';
import { editDraft, replyDraft } from './compose';

function current(): MessageHeader[] {
  const list = selectedMessages();
  if (!list.length) toast('info', 'Keine Nachricht ausgewählt.');
  return list;
}

function ids(list: MessageHeader[]): number[] {
  return list.map((m) => m.id);
}

export async function reply(mode: 'reply' | 'replyAll' | 'forward', msg?: MessageHeader): Promise<void> {
  const m = msg ?? current()[0];
  if (!m) return;
  const d = await attempt(() => replyDraft(mode, m.id));
  if (d) useApp.getState().openComposer(d);
}

export async function openDraft(m: MessageHeader): Promise<void> {
  const d = await attempt(() => editDraft(m.id));
  if (d) useApp.getState().openComposer(d);
}

export async function setRead(seen: boolean, list = current()): Promise<void> {
  if (!list.length) return;
  useMail.getState().patchLocal(ids(list), { seen });
  await attempt(() => api.mail.setFlags(ids(list), { seen }));
}

export async function toggleFlag(list = current()): Promise<void> {
  if (!list.length) return;
  const flagged = !list.every((m) => m.flagged);
  useMail.getState().patchLocal(ids(list), { flagged });
  await attempt(() => api.mail.setFlags(ids(list), { flagged }));
}

export async function setFlagDue(dueAt: number | null, list = current()): Promise<void> {
  if (!list.length) return;
  useMail.getState().patchLocal(ids(list), { flagged: true, dueAt });
  await attempt(() => api.mail.setFlags(ids(list), { flagged: true, dueAt }));
}

export async function togglePin(list = current()): Promise<void> {
  if (!list.length) return;
  const pinned = !list.every((m) => m.pinned);
  useMail.getState().patchLocal(ids(list), { pinned });
  await attempt(() => api.mail.setFlags(ids(list), { pinned }));
  void useMail.getState().load();
}

function afterRemove(list: MessageHeader[]): void {
  const s = useApp.getState().settings;
  useMail.getState().removeLocal(ids(list));
  if (s?.mail.autoAdvance === 'list') useMail.getState().clearSelection();
}

export async function remove(permanent = false, list = current()): Promise<void> {
  if (!list.length) return;
  const s = useApp.getState().settings;
  // in trash/junk or without a trash folder the backend deletes for good: always confirm, no undo
  const inTrash = permanent || (await api.mail.isPermanentDelete(ids(list)).catch(() => true));
  if (inTrash) {
    if (!(await confirm('Endgültig löschen', `${list.length === 1 ? 'Diese Nachricht wird' : `${list.length} Nachrichten werden`} endgültig gelöscht und können nicht wiederhergestellt werden.`, 'Löschen', true))) return;
  } else if (s?.mail.confirmDelete) {
    if (!(await confirm('Löschen', `${list.length === 1 ? 'Nachricht' : `${list.length} Nachrichten`} in „Gelöschte Elemente“ verschieben?`, 'Löschen'))) return;
  }
  afterRemove(list);
  const ok = await succeeded(() => api.mail.remove(ids(list), permanent));
  if (ok && !permanent && !inTrash) toast('info', list.length === 1 ? 'Nachricht gelöscht' : `${list.length} Nachrichten gelöscht`, undoMove(list));
}

/** Undo for delete/move/archive: moves the messages back to where they were */
function undoMove(list: MessageHeader[]): { label: string; run: () => void } {
  const origin = new Map(list.map((m) => [m.id, m.folderId]));
  return {
    label: 'Rückgängig',
    run: () => {
      const groups = new Map<string, number[]>();
      for (const [id, f] of origin) groups.set(f, [...(groups.get(f) ?? []), id]);
      void (async () => {
        for (const [f, idList] of groups) await attempt(() => api.mail.move(idList, f));
        void useMail.getState().load();
      })();
    }
  };
}

export async function archive(list = current()): Promise<void> {
  if (!list.length) return;
  afterRemove(list);
  const ok = await succeeded(() => api.mail.archive(ids(list)));
  if (ok) toast('info', list.length === 1 ? 'Archiviert' : `${list.length} Nachrichten archiviert`, undoMove(list));
}

export async function moveTo(folderId?: string, list = current(), copy = false): Promise<void> {
  if (!list.length) return;
  const target = folderId ?? (await pickFolder(copy ? 'Kopieren nach' : 'Verschieben nach'));
  if (!target) return;
  if (copy) {
    await attempt(() => api.mail.copy(ids(list), target), 'Kopiert');
    return;
  }
  if (list.every((m) => m.folderId === target)) return;
  afterRemove(list);
  const ok = await succeeded(() => api.mail.move(ids(list), target));
  const f = folderById(target);
  if (ok) toast('info', `Verschoben nach „${f?.name ?? 'Ordner'}“`, undoMove(list));
}

export async function junk(isJunk: boolean, list = current()): Promise<void> {
  if (!list.length) return;
  afterRemove(list);
  await attempt(() => api.mail.junk(ids(list), isJunk), isJunk ? 'Als Junk markiert' : 'Kein Junk – in den Posteingang verschoben');
}

export async function blockSender(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  if (!(await confirm('Absender blockieren', `E-Mails von ${m.from.address} werden künftig automatisch in „Junk-E-Mail“ verschoben.`, 'Blockieren', true))) return;
  afterRemove([m]);
  await attempt(() => api.mail.blockSender(m.id), 'Absender blockiert');
}

export async function setCategory(category: string, list = current()): Promise<void> {
  if (!list.length) return;
  const has = list.every((m) => m.categories.includes(category));
  for (const m of list) {
    const cats = has ? m.categories.filter((c) => c !== category) : [...new Set([...m.categories, category])];
    useMail.getState().patchLocal([m.id], { categories: cats });
    await attempt(() => api.mail.setCategories([m.id], cats));
  }
}

export async function clearCategories(list = current()): Promise<void> {
  if (!list.length) return;
  useMail.getState().patchLocal(ids(list), { categories: [] });
  await attempt(() => api.mail.setCategories(ids(list), []));
}

export function snooze(list = current()): void {
  if (!list.length) return;
  useApp.getState().setOverlay({ kind: 'snooze', ids: ids(list) });
}

export async function snoozeUntil(at: number, list = current()): Promise<void> {
  if (!list.length) return;
  afterRemove(list);
  await attempt(() => api.mail.snooze(ids(list), at), 'Zurückgestellt');
}

export async function toTask(list = current()): Promise<void> {
  for (const m of list) await attempt(() => api.tasks.fromMessage(m.id));
  if (list.length) toast('success', list.length === 1 ? 'Aufgabe erstellt' : `${list.length} Aufgaben erstellt`);
}

export async function runQuickStep(actions: RuleAction[], list = current()): Promise<void> {
  if (!list.length) return;
  if (actions.some((a) => a.type === 'move' || a.type === 'delete')) afterRemove(list);
  await attempt(() => api.mail.applyActions(ids(list), actions));
  void useMail.getState().load();
}

export async function print(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  if (isElectron) await attempt(() => api.mail.print(m.id));
  else window.print();
}

export async function saveAs(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  const p = await attempt(() => api.mail.saveAs(m.id));
  if (p) toast('success', `Gespeichert: ${p}`);
}

export function showSource(list = current()): void {
  const m = list[0];
  if (m) useApp.getState().setOverlay({ kind: 'source', messageId: m.id });
}

export async function unsubscribe(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  if (!(await confirm('Abo kündigen', `Vom Newsletter „${m.from.name || m.from.address}“ abmelden?`, 'Abmelden'))) return;
  const msg = await attempt(() => api.mail.unsubscribe(m.id));
  if (msg) toast('success', msg);
}

export async function openInWindow(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  if (m.draft || folderById(m.folderId)?.specialUse === 'drafts') {
    await openDraft(m);
    return;
  }
  if (isElectron) await attempt(() => api.app.newWindow(`/message/${m.id}`));
  else window.open(`${location.pathname}#/message/${m.id}`, '_blank', 'width=980,height=760');
}

export async function newRuleFrom(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  const s = useApp.getState().settings;
  if (!s) return;
  const target = await pickFolder(`Nachrichten von ${m.from.address} verschieben nach`);
  if (!target) return;
  const f = folderById(target);
  const name = await prompt('Neue Regel', `Von ${m.from.name || m.from.address}`, 'Name der Regel', 'Erstellen');
  if (!name) return;
  const rules = [
    ...s.rules,
    {
      id: newId(),
      name,
      enabled: true,
      accountId: m.accountId,
      match: 'all' as const,
      conditions: [{ field: 'from' as const, op: 'contains' as const, value: m.from.address }],
      actions: [{ type: 'move' as const, folderPath: f?.path ?? target }],
      stopProcessing: false
    }
  ];
  await attempt(() => api.settings.saveRules(rules), 'Regel erstellt');
  if (await confirm('Regel ausführen', 'Regel jetzt auf den aktuellen Ordner anwenden?', 'Ausführen')) {
    const n = await attempt(() => api.settings.runRules(m.folderId));
    if (n !== undefined) toast('success', `${n} Nachricht(en) verarbeitet`);
  }
}

export async function toEvent(list = current()): Promise<void> {
  const m = list[0];
  if (!m) return;
  // opens the calendar's event editor prefilled with the mail (user can adjust before saving)
  setIntent('calendar', 'newEvent', JSON.stringify({ title: m.subject, notes: `${m.from.name || m.from.address}: ${m.snippet}` }));
}

export async function markFolderRead(folderId: string): Promise<void> {
  await attempt(() => api.mail.markFolderRead(folderId));
  void useMail.getState().load();
}

export async function emptyFolder(folderId: string): Promise<void> {
  const f = folderById(folderId);
  if (!f) return;
  if (!(await confirm(`„${f.name}“ leeren`, 'Alle Nachrichten in diesem Ordner werden endgültig gelöscht.', 'Leeren', true))) return;
  await attempt(() => api.mail.emptyFolder(folderId), 'Ordner geleert');
  void useMail.getState().load();
}

export async function newFolder(accountId: string, parentPath: string | null): Promise<void> {
  const name = await prompt(parentPath ? 'Neuer Unterordner' : 'Neuer Ordner', '', 'Ordnername', 'Erstellen');
  if (name) await attempt(() => api.mail.createFolder(accountId, parentPath, name), 'Ordner erstellt');
}

export async function renameFolder(folderId: string): Promise<void> {
  const f = folderById(folderId);
  if (!f) return;
  const name = await prompt('Ordner umbenennen', f.name, 'Neuer Name', 'Umbenennen');
  if (name && name !== f.name) await attempt(() => api.mail.renameFolder(folderId, name));
}

export async function deleteFolder(folderId: string): Promise<void> {
  const f = folderById(folderId);
  if (!f) return;
  if (!(await confirm('Ordner löschen', `Den Ordner „${f.name}“ mit allen Nachrichten und Unterordnern löschen?`, 'Löschen', true))) return;
  await attempt(() => api.mail.deleteFolder(folderId), 'Ordner gelöscht');
  if (useMail.getState().folderId === folderId) useMail.getState().setFolder('virtual:inbox');
}
