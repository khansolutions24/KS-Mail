// Contact actions shared by list, detail card and commands.

import type { Contact } from '@shared/types';
import { contactName } from '@shared/vcard';
import { api } from '../api/client';
import { attempt, toast, useApp } from '../store/app';
import { newDraft } from '../mail/compose';
import { primaryEmail } from './contactUtils';

/** Opens a new mail to the given contacts (primary address) or a specific address */
export function sendMail(contacts: Contact[], address?: string): void {
  const to = contacts
    .map((c) => ({ name: contactName(c), address: address ?? primaryEmail(c) }))
    .filter((a) => a.address);
  if (!to.length) {
    toast('info', 'Für diesen Kontakt ist keine E-Mail-Adresse hinterlegt.');
    return;
  }
  useApp.getState().openComposer(newDraft({ to }));
}

export function callNumber(number: string): void {
  void attempt(() => api.app.openExternal(`tel:${number.replace(/[^\d+*#]/g, '')}`));
}

export async function importVcf(): Promise<void> {
  const n = await attempt(() => api.contacts.importVcf());
  if (n !== undefined && n > 0) toast('success', `${n} ${n === 1 ? 'Kontakt' : 'Kontakte'} importiert`);
}

export async function importCsv(): Promise<void> {
  const n = await attempt(() => api.contacts.importCsv());
  if (n !== undefined && n > 0) toast('success', `${n} ${n === 1 ? 'Kontakt' : 'Kontakte'} importiert`);
}

/** Exports the given contacts, or all (non-collected) contacts when ids is empty */
export async function exportVcf(ids?: string[]): Promise<void> {
  const path = await attempt(() => api.contacts.exportVcf(ids?.length ? ids : undefined));
  if (path) toast('success', `Exportiert nach ${path}`);
}
