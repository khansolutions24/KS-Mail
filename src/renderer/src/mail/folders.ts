// Folder helpers: labels, icons, tree.

import { Archive, FileText, Folder as FolderIcon, Inbox, Send, ShieldAlert, Star, Trash2, Mails, type LucideIcon } from 'lucide-react';
import type { Folder } from '@shared/types';

const LABELS: Record<string, string> = {
  inbox: 'Posteingang',
  sent: 'Gesendete Elemente',
  drafts: 'Entwürfe',
  trash: 'Gelöschte Elemente',
  junk: 'Junk-E-Mail',
  archive: 'Archiv',
  all: 'Alle E-Mails',
  flagged: 'Markiert'
};

export function folderLabel(f: Folder): string {
  if (f.specialUse && LABELS[f.specialUse] && (f.path.toUpperCase() === 'INBOX' || f.parentPath === null || f.specialUse !== 'archive')) return LABELS[f.specialUse];
  return f.name;
}

export function folderIcon(f: Folder): LucideIcon {
  switch (f.specialUse) {
    case 'inbox':
      return Inbox;
    case 'sent':
      return Send;
    case 'drafts':
      return FileText;
    case 'trash':
      return Trash2;
    case 'junk':
      return ShieldAlert;
    case 'archive':
      return Archive;
    case 'flagged':
      return Star;
    case 'all':
      return Mails;
    default:
      return FolderIcon;
  }
}

const ORDER: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, trash: 4, junk: 5, all: 6, flagged: 7 };

export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
}

export function folderTree(folders: Folder[]): FolderNode[] {
  const byPath = new Map<string, FolderNode>();
  for (const f of folders) byPath.set(f.path, { folder: f, children: [] });
  const roots: FolderNode[] = [];
  for (const n of byPath.values()) {
    const parent = n.folder.parentPath ? byPath.get(n.folder.parentPath) : undefined;
    // special folders nested under INBOX (some servers) are still shown at top level
    if (parent && !(n.folder.specialUse && n.folder.specialUse !== 'inbox' && parent.folder.specialUse === 'inbox')) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: FolderNode[]): FolderNode[] => {
    list.sort((a, b) => {
      const oa = a.folder.specialUse ? (ORDER[a.folder.specialUse] ?? 9) : 10;
      const ob = b.folder.specialUse ? (ORDER[b.folder.specialUse] ?? 9) : 10;
      return oa - ob || folderLabel(a.folder).localeCompare(folderLabel(b.folder), 'de');
    });
    for (const n of list) sort(n.children);
    return list;
  };
  return sort(roots);
}
