/**
 * Golden tests: WhatsApp Web history content placeholders (no bot turn).
 * Run: npm run test-whatsapp-history-import
 */

import { describeWhatsAppHistoryContent } from './whatsappWeb/historyImport.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function run(): void {
  assert(describeWhatsAppHistoryContent(null) === null, 'null content skipped');
  passed += 1;

  const text = describeWhatsAppHistoryContent({ conversation: 'مرحبا' });
  assert(text?.text === 'مرحبا', 'plain conversation text');
  passed += 1;

  const caption = describeWhatsAppHistoryContent({
    imageMessage: { caption: 'هذه الصورة' },
  });
  assert(caption?.text === 'هذه الصورة', 'image caption preferred over placeholder');
  passed += 1;

  const image = describeWhatsAppHistoryContent({ imageMessage: {} });
  assert(image?.text === '📷 صورة', 'image placeholder');
  passed += 1;

  const audio = describeWhatsAppHistoryContent({ audioMessage: {} });
  assert(audio?.text === '🎤 رسالة صوتية', 'audio placeholder');
  passed += 1;

  const video = describeWhatsAppHistoryContent({ videoMessage: {} });
  assert(video?.text === '🎬 فيديو', 'video placeholder');
  passed += 1;

  const doc = describeWhatsAppHistoryContent({ documentMessage: {} });
  assert(doc?.text === '📎 ملف', 'document placeholder');
  passed += 1;

  const empty = describeWhatsAppHistoryContent({});
  assert(empty === null, 'protocol/empty skipped');
  passed += 1;

  console.log(`whatsapp history import tests passed: ${passed}`);
}

run();
