import express from 'express';
import {
  getConversations,
  getConversation,
  createConversation,
  addMessage,
  getOrCreateConversation,
  disableBotForConversation,
  enableBotForConversation,
  sendHumanMessage,
  setInboxTyping,
  markInboxRead,
} from '../controllers/conversation.controller.js';
import { streamInboxEvents } from '../controllers/inboxStream.controller.js';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';

const router = express.Router();

router.use(authenticate);
router.use(checkSubscriptionStatus);

router.get('/', getConversations);
router.get('/stream', streamInboxEvents);
router.get('/get-or-create', getOrCreateConversation);
router.get('/:id', getConversation);
router.post('/', createConversation);
router.post('/:id/messages', addMessage);

// Bot management endpoints
router.put('/:conversationId/disable-bot', disableBotForConversation);
router.put('/:conversationId/enable-bot', enableBotForConversation);
router.post('/:conversationId/send-human-message', sendHumanMessage);
router.post('/:conversationId/typing', setInboxTyping);
router.post('/:conversationId/mark-read', markInboxRead);

export default router;

