/**
 * Golden tests: public comment mention markup (Facebook entity + Instagram handle).
 * Run: npm run test-social-comment-mention
 */

import {
  formatFacebookMentionMarkup,
  normalizeFacebookCommenterId,
  normalizeInstagramUsername,
  publicCommentMentionTag,
  usableFacebookMentionName,
  withPublicCommentMention,
} from './socialCommentMention.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function run(): void {
  assert(normalizeFacebookCommenterId('123456789') === '123456789', 'numeric PSID');
  assert(normalizeFacebookCommenterId(' 99 ') === '99', 'trim PSID');
  assert(normalizeFacebookCommenterId('12_34') === null, 'reject compound ids');
  assert(normalizeFacebookCommenterId('') === null, 'reject empty id');
  passed += 4;

  assert(normalizeInstagramUsername('@Shop.Name_1') === 'Shop.Name_1', 'strip @ and keep IG charset');
  assert(normalizeInstagramUsername('bad name') === null, 'reject spaces');
  assert(normalizeInstagramUsername('محمد') === null, 'reject display names');
  assert(normalizeInstagramUsername('user.') === null, 'reject trailing period');
  passed += 4;

  assert(usableFacebookMentionName('صديقنا') === null, 'placeholder name is not a mention name');
  assert(usableFacebookMentionName('Social User') === null, 'english placeholder');
  assert(usableFacebookMentionName('أحمد علي') === 'أحمد علي', 'arabic display name');
  assert(usableFacebookMentionName('Ann]e:X@') === 'AnneX', 'strip markup breakers');
  passed += 4;

  assert(
    formatFacebookMentionMarkup('111', 'سارة') === '@[111:سارة]',
    'entity markup with name'
  );
  assert(formatFacebookMentionMarkup('111', 'صديقنا') === '@[111:0]', 'placeholder falls back to :0');
  assert(formatFacebookMentionMarkup('111', null) === '@[111:0]', 'missing name uses :0');
  passed += 3;

  const fb = withPublicCommentMention('شكراً لتعليقك!', {
    platform: 'facebook',
    commenterId: '7509093889208238',
    commenterName: 'سارة أحمد',
  });
  assert(
    fb === '@[7509093889208238:سارة أحمد] شكراً لتعليقك!',
    `facebook prepends entity tag, got: ${fb}`
  );
  assert(
    withPublicCommentMention(fb, {
      platform: 'facebook',
      commenterId: '7509093889208238',
      commenterName: 'سارة أحمد',
    }) === fb,
    'does not double-tag facebook'
  );
  assert(
    withPublicCommentMention('hello', { platform: 'facebook', commenterId: 'abc' }) === 'hello',
    'skip facebook mention without PSID'
  );
  passed += 3;

  const ig = withPublicCommentMention('شكراً لتعليقك!', {
    platform: 'instagram',
    commenterUsername: 'shop_user',
  });
  assert(ig === '@shop_user شكراً لتعليقك!', `instagram prepends @username, got: ${ig}`);
  assert(
    withPublicCommentMention(ig, { platform: 'instagram', commenterUsername: 'shop_user' }) === ig,
    'does not double-tag instagram'
  );
  assert(
    withPublicCommentMention('hello', {
      platform: 'instagram',
      commenterName: 'أحمد',
      commenterUsername: null,
    }) === 'hello',
    'instagram never mentions a display name'
  );
  passed += 3;

  assert(
    publicCommentMentionTag({ platform: 'facebook', commenterId: '1', commenterName: 'A' }) ===
      '@[1:A]',
    'tag helper facebook'
  );
  assert(
    publicCommentMentionTag({ platform: 'instagram', commenterUsername: 'x' }) === '@x',
    'tag helper instagram'
  );
  passed += 2;

  console.log(`socialCommentMention golden: ${passed} assertions passed`);
}

run();
