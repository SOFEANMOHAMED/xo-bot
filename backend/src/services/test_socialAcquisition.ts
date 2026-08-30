/**
 * Golden tests: story reply extraction + acquisition notes (no DB).
 * Run: npm run test-social-acquisition
 */

import {
  STORY_REACTION_PLACEHOLDER,
  STORY_REPLY_PLACEHOLDER,
  buildAcquisitionContextNote,
  extractReferralFromMessagingEvent,
  extractStoryReplyFromMessagingEvent,
  isStoryReplyMessagingEvent,
  resolveInboundMessagingText,
  type AcquisitionContext,
} from './socialAcquisition.js';
import { mergeMessengerStylePayloads, type IngressPart } from './conversationIngressQueue.js';
import { isDirectStoryImageUrl } from './socialStoryMedia.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function storyEvent(extra: Record<string, unknown> = {}) {
  return {
    sender: { id: 'igsid-1' },
    recipient: { id: 'ig-biz' },
    message: {
      mid: 'm1',
      text: 'كم السعر؟',
      reply_to: {
        story: { id: '17893310459840806', url: 'https://lookaside.fbsbx.com/story.jpg' },
      },
      ...extra,
    },
  };
}

function run(): void {
  const igStory = storyEvent();
  const extracted = extractStoryReplyFromMessagingEvent(igStory);
  assert(extracted?.storyId === '17893310459840806', 'IG reply_to.story.id');
  assert(extracted?.storyUrl?.includes('lookaside') === true, 'IG story CDN url');
  assert(isStoryReplyMessagingEvent(igStory) === true, 'isStoryReply true');
  passed += 3;

  const signals = extractReferralFromMessagingEvent(igStory);
  assert(signals?.storyId === '17893310459840806', 'referral extractor includes storyId');
  assert(!signals?.postId, 'story reply does not invent ads postId');
  passed += 2;

  const mention = {
    referral: {
      source: 'STORY_MENTION',
      story: { id: 'customer-story-9', url: 'https://example.com/x' },
    },
  };
  assert(extractStoryReplyFromMessagingEvent(mention) == null, 'STORY_MENTION is not merchant story');
  assert(isStoryReplyMessagingEvent(mention) === false, 'mention is not product-link story');
  passed += 2;

  const ads = {
    referral: {
      source: 'ADS',
      ad_id: 'ad-1',
      ads_context_data: { post_id: 'post-99', ad_id: 'ad-1' },
    },
  };
  const adsSignals = extractReferralFromMessagingEvent(ads);
  assert(adsSignals?.adId === 'ad-1', 'ads ad_id');
  assert(adsSignals?.postId === 'post-99', 'ads post_id');
  assert(!adsSignals?.storyId, 'ads event has no storyId');
  passed += 3;

  const emptyStory = storyEvent({ text: '' });
  assert(resolveInboundMessagingText(emptyStory, '') === STORY_REPLY_PLACEHOLDER, 'empty story reply placeholder');
  const heart = {
    message: {
      text: '',
      attachments: [{ type: 'like_heart' }],
      reply_to: { story: { id: 's1' } },
    },
  };
  assert(resolveInboundMessagingText(heart, '') === STORY_REACTION_PLACEHOLDER, 'story heart placeholder');
  assert(resolveInboundMessagingText({ message: { text: '' } }, '') === '', 'plain empty stays empty');
  passed += 3;

  const storyNote: AcquisitionContext = {
    source: 'STORY',
    post_id: '17893310459840806',
    captured_at: new Date().toISOString(),
  };
  const withProduct = buildAcquisitionContextNote(storyNote, 'فستان سهرة');
  assert(withProduct.includes('ستوري'), 'story note mentions ستوري');
  assert(withProduct.includes('فستان سهرة'), 'story note includes product');
  const withoutProduct = buildAcquisitionContextNote(storyNote, null);
  assert(withoutProduct.includes('ستوري'), 'unlinked story note mentions ستوري');
  assert(!withoutProduct.includes('فستان'), 'unlinked story note has no product name');
  passed += 4;

  const postNote = buildAcquisitionContextNote(
    { source: 'ADS', post_id: 'p1', ad_id: 'a1', captured_at: new Date().toISOString() },
    'ساعة'
  );
  assert(postNote.includes('المنشور/الإعلان'), 'ads note keeps post/ad wording');
  assert(!postNote.includes('ستوري'), 'ads note does not say story');
  passed += 2;

  const followUp: IngressPart<Record<string, any>>[] = [
    { text: '', receivedAt: 1, payload: emptyStory, externalMessageId: 'm1' },
    {
      text: 'كم السعر؟',
      receivedAt: 2,
      payload: { message: { mid: 'm2', text: 'كم السعر؟' } },
      externalMessageId: 'm2',
    },
  ];
  const merged = mergeMessengerStylePayloads(followUp);
  assert(merged.message.text === 'كم السعر؟', 'merged text is follow-up');
  assert(merged.message.reply_to?.story?.id === '17893310459840806', 'merge keeps story id from earlier part');
  passed += 2;

  const officialSafe = extractReferralFromMessagingEvent(igStory);
  assert(
    !!officialSafe && !officialSafe.postId && !officialSafe.adId && !officialSafe.ref,
    'official page ads condition stays false for story-only'
  );
  passed += 1;

  assert(isDirectStoryImageUrl('https://scontent-fra5-2.xx.fbcdn.net/v/t39.30808-6/photo.jpg') === true, 'regional fbcdn host');
  assert(isDirectStoryImageUrl('https://lookaside.fbsbx.com/story.jpg') === true, 'lookaside image');
  assert(
    isDirectStoryImageUrl('https://facebook.com/stories/108/Uzpf/?view_single=1') === false,
    'story permalink is not an image'
  );
  assert(isDirectStoryImageUrl('https://scontent.cdninstagram.com/v/t51.2885-15/x.jpg') === true, 'ig cdn image');
  assert(isDirectStoryImageUrl(null) === false, 'null url');
  passed += 5;

  console.log(`social acquisition tests passed: ${passed}`);
}

run();
