/**
 * Unit tests for comment reaction domain helpers (no DB / Graph).
 * Run: npx tsx src/services/test_commentReactions.ts
 */

import assert from 'node:assert/strict';
import {
  applyCommentReaction,
  COMMENT_REACTION_TYPES,
  DEFAULT_COMMENT_REACTION,
  isCommentReactionType,
  normalizeCommentReactionType,
  parseCommentReactionType,
  platformSupportsCommentReactions,
} from './commentReactions.js';

function testNormalize() {
  assert.equal(normalizeCommentReactionType('love'), 'LOVE');
  assert.equal(normalizeCommentReactionType('LIKE'), 'LIKE');
  assert.equal(normalizeCommentReactionType('nope'), null);
  assert.equal(normalizeCommentReactionType(null), null);
  assert.equal(parseCommentReactionType('haha'), 'HAHA');
  assert.equal(parseCommentReactionType('x'), DEFAULT_COMMENT_REACTION);
  assert.ok(isCommentReactionType('CARE'));
  assert.equal(isCommentReactionType('FIRE'), false);
  assert.equal(COMMENT_REACTION_TYPES.length, 7);
}

function testPlatformCapability() {
  assert.equal(platformSupportsCommentReactions('facebook'), true);
  assert.equal(platformSupportsCommentReactions('instagram'), false);
}

async function testApplyDisabled() {
  let called = false;
  const result = await applyCommentReaction({
    enabled: false,
    reactionType: 'LOVE',
    platform: 'facebook',
    commentId: 'c1',
    accessToken: 't',
    sendReaction: async () => {
      called = true;
      return true;
    },
  });
  assert.equal(result.attempted, false);
  assert.equal(result.skippedReason, 'disabled');
  assert.equal(called, false);
}

async function testApplyUnsupportedPlatform() {
  const result = await applyCommentReaction({
    enabled: true,
    reactionType: 'LIKE',
    platform: 'instagram',
    commentId: 'c1',
    accessToken: 't',
    sendReaction: async () => true,
  });
  assert.equal(result.attempted, false);
  assert.equal(result.skippedReason, 'unsupported_platform');
}

async function testApplySuccess() {
  const calls: Array<{ id: string; type: string }> = [];
  const result = await applyCommentReaction({
    enabled: true,
    reactionType: 'love',
    platform: 'facebook',
    commentId: 'c99',
    accessToken: 'tok',
    sendReaction: async (commentId, reactionType) => {
      calls.push({ id: commentId, type: reactionType });
      return true;
    },
  });
  assert.equal(result.attempted, true);
  assert.equal(result.success, true);
  assert.equal(result.reactionType, 'LOVE');
  assert.deepEqual(calls, [{ id: 'c99', type: 'LOVE' }]);
}

async function main() {
  testNormalize();
  testPlatformCapability();
  await testApplyDisabled();
  await testApplyUnsupportedPlatform();
  await testApplySuccess();
  console.log('test_commentReactions: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
