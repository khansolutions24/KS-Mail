// Client-side mail rules: pure matching logic (the backend applies the actions).

import type { Address, Rule, RuleCondition, RuleOp } from './types';

export interface RuleSubject {
  accountId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  /** Plain text body; may be empty when not yet downloaded */
  body: string;
  hasAttachments: boolean;
  size: number;
  headers: Record<string, string>;
}

function addrText(list: Address[]): string[] {
  return list.flatMap((a) => [a.address.toLowerCase(), `${a.name} <${a.address}>`.toLowerCase()]);
}

export function testOp(op: RuleOp, hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  switch (op) {
    case 'contains':
      return h.includes(n);
    case 'notContains':
      return !h.includes(n);
    case 'equals':
      return h === n;
    case 'startsWith':
      return h.startsWith(n);
    case 'endsWith':
      return h.endsWith(n);
    case 'regex':
      try {
        return new RegExp(needle, 'i').test(hay);
      } catch {
        return false;
      }
  }
}

function testMany(op: RuleOp, values: string[], needle: string): boolean {
  if (op === 'notContains') return values.every((v) => testOp(op, v, needle));
  return values.some((v) => testOp(op, v, needle));
}

export function matchCondition(c: RuleCondition, m: RuleSubject): boolean {
  const op = c.op ?? 'contains';
  switch (c.field) {
    case 'from':
      return testMany(op, addrText([m.from]), c.value);
    case 'to':
      return testMany(op, addrText(m.to), c.value);
    case 'cc':
      return testMany(op, addrText(m.cc), c.value);
    case 'anyRecipient':
      return testMany(op, addrText([...m.to, ...m.cc]), c.value);
    case 'subject':
      return testOp(op, m.subject, c.value);
    case 'body':
      return testOp(op, m.body, c.value);
    case 'header': {
      const v = m.headers[(c.headerName ?? '').toLowerCase()];
      return v !== undefined && testOp(op, v, c.value);
    }
    case 'hasAttachment':
      return m.hasAttachments === (c.value !== 'false');
    case 'sizeGreater':
      return m.size > Number(c.value) * 1024;
    case 'importance': {
      const imp = (m.headers['importance'] ?? m.headers['x-priority'] ?? '').toLowerCase();
      const high = imp.startsWith('high') || imp.startsWith('1') || imp.startsWith('2');
      return c.value === 'high' ? high : !high;
    }
  }
}

export function matchRule(rule: Rule, m: RuleSubject): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== m.accountId) return false;
  if (!rule.conditions.length) return true;
  return rule.match === 'all' ? rule.conditions.every((c) => matchCondition(c, m)) : rule.conditions.some((c) => matchCondition(c, m));
}

/** Rules that apply to `m`, honouring "stop processing further rules" */
export function applicableRules(rules: Rule[], m: RuleSubject): Rule[] {
  const out: Rule[] = [];
  for (const r of rules) {
    if (!matchRule(r, m)) continue;
    out.push(r);
    if (r.stopProcessing) break;
  }
  return out;
}

export function needsBody(rules: Rule[]): boolean {
  return rules.some((r) => r.enabled && r.conditions.some((c) => c.field === 'body'));
}
