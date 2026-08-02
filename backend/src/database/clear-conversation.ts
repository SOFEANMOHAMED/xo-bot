import pool from './connection.js';
import { logger } from '../utils/logger.js';

async function clearAllConversations() {
  try {
    console.log('🧹 Clearing ALL conversations and messages...\n');
    
    // Count before deletion
    const messageCountResult = await pool.query('SELECT COUNT(*) FROM messages');
    const conversationCountResult = await pool.query('SELECT COUNT(*) FROM conversations');
    
    const messageCount = parseInt(messageCountResult.rows[0].count);
    const conversationCount = parseInt(conversationCountResult.rows[0].count);
    
    console.log('📊 Current state:');
    console.log(`   - Messages: ${messageCount}`);
    console.log(`   - Conversations: ${conversationCount}\n`);
    
    if (messageCount === 0 && conversationCount === 0) {
      console.log('✅ Database is already clean! No conversations or messages found.\n');
      return;
    }
    
    // مسح جميع الرسائل
    const deleteMessagesResult = await pool.query('DELETE FROM messages');
    console.log(`✅ Deleted ${deleteMessagesResult.rowCount} messages`);
    
    // مسح جميع المحادثات
    const deleteConversationsResult = await pool.query('DELETE FROM conversations');
    console.log(`✅ Deleted ${deleteConversationsResult.rowCount} conversations\n`);
    
    logger.info('All conversations cleared successfully');
    console.log('🎉 Successfully cleared all conversations and messages!');
    console.log('🧪 You can now test the bot from scratch.\n');
    
  } catch (error) {
    logger.error('Error clearing conversations', error as Error);
    console.error('❌ Error clearing conversations:', error);
    process.exit(1);
  }
}

clearAllConversations().then(() => {
  console.log('✅ Script completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
