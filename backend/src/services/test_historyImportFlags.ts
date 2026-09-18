/**
 * Golden tests: history-import flags (pre-link messages are not billable).
 * Run: npm run test-history-import-flags
 */

import {
  buildImportedHistoryMetadata,
  conversationHasLiveMessagesSql,
  historyCutoffFromLinkedAt,
  isBeforeChannelLink,
  isBillableBotResponseSql,
  isImportedHistoryMessageSql,
  isLiveCustomerMessageSql,
  META_HISTORY_IMPORT_SOURCE,
  parseChannelEventTime,
  WHATSAPP_WEB_HISTORY_ORIGIN,
} from './inbox/historyImportFlags.js';
import { isWhatsAppHistoryTimestamp } from './whatsappWeb/historyImport.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function run(): void {
  const meta = buildImportedHistoryMetadata({ origin: WHATSAPP_WEB_HISTORY_ORIGIN });
  assert(meta.imported === true, 'imported flag set');
  assert(meta.historyOnly === true, 'historyOnly flag set');
  assert(meta.origin === WHATSAPP_WEB_HISTORY_ORIGIN, 'origin preserved');
  passed += 3;

  const sql = isImportedHistoryMessageSql('m');
  assert(sql.includes("m.metadata->>'imported'"), 'sql checks imported');
  assert(sql.includes(WHATSAPP_WEB_HISTORY_ORIGIN), 'sql checks whatsapp origin');
  assert(sql.includes(META_HISTORY_IMPORT_SOURCE), 'sql checks meta import source');
  passed += 3;

  const botSql = isBillableBotResponseSql('msg');
  assert(botSql.includes("msg.role = 'assistant'"), 'billable requires assistant');
  assert(botSql.includes("sender_type"), 'billable requires bot sender');
  assert(botSql.includes('NOT'), 'billable excludes imported');
  passed += 3;

  const liveSql = isLiveCustomerMessageSql('msg');
  assert(liveSql.includes("msg.role = 'user'"), 'live customer is user role');
  assert(liveSql.includes('NOT'), 'live customer excludes imported');
  passed += 2;

  const existsSql = conversationHasLiveMessagesSql('c');
  assert(existsSql.includes('EXISTS'), 'conversation live-message exists');
  assert(existsSql.includes('c.id'), 'exists scoped to conversation');
  passed += 2;

  const linked = new Date('2026-09-19T10:00:00.000Z');
  assert(
    isBeforeChannelLink(new Date('2026-09-18T10:00:00.000Z'), linked) === true,
    'day-old message is pre-link'
  );
  assert(
    isBeforeChannelLink(new Date('2026-09-19T10:02:00.000Z'), linked) === false,
    'message after link is live'
  );
  assert(
    isBeforeChannelLink(new Date('2026-09-19T09:59:30.000Z'), linked) === false,
    'pairing grace keeps near-link messages live'
  );
  assert(isBeforeChannelLink(null, linked) === false, 'missing timestamp is not pre-link');
  passed += 4;

  const ms = parseChannelEventTime(1_700_000_000);
  assert(ms instanceof Date && ms.getTime() === 1_700_000_000_000, 'unix seconds to date');
  const ms2 = parseChannelEventTime(1_700_000_000_000);
  assert(ms2 instanceof Date && ms2.getTime() === 1_700_000_000_000, 'unix ms unchanged');
  assert(parseChannelEventTime(0) === null, 'zero timestamp ignored');
  passed += 3;

  const cutoff = historyCutoffFromLinkedAt(linked);
  assert(cutoff.getTime() === linked.getTime() - 60_000, 'cutoff is linked minus grace');
  passed += 1;

  const oldWa = {
    messageTimestamp: Math.floor(new Date('2026-09-01T00:00:00.000Z').getTime() / 1000),
  } as any;
  const newWa = {
    messageTimestamp: Math.floor(new Date('2026-09-19T12:00:00.000Z').getTime() / 1000),
  } as any;
  assert(isWhatsAppHistoryTimestamp(oldWa, cutoff) === true, 'old wa notify is history');
  assert(isWhatsAppHistoryTimestamp(newWa, cutoff) === false, 'new wa notify is live');
  passed += 2;

  console.log(`history import flags tests passed: ${passed}`);
}

run();
