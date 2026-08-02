/**
 * Simple endpoint to enable/disable Full AI Mode (no auth for admin use)
 * POST /enable-full-ai
 */

import express from 'express';
import pool from '../database/connection.js';

const router = express.Router();

router.post('/enable-full-ai', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE bots
       SET bot_config = COALESCE(bot_config, '{}'::jsonb) || '{"use_full_ai_mode": true}'::jsonb
       WHERE merchant_id = '231ddf1d-c35f-48c0-82f5-72f896e8404e'
       RETURNING id, name, bot_config`
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    
    const bot = result.rows[0];
    console.log('✅ Full AI Mode enabled!');
    console.log('📋 Config:', bot.bot_config);
    
    return res.json({
      success: true,
      message: 'Full AI Mode enabled successfully',
      config: bot.bot_config
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/disable-full-ai', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE bots
       SET bot_config = COALESCE(bot_config, '{}'::jsonb) || '{"use_full_ai_mode": false}'::jsonb
       WHERE merchant_id = '231ddf1d-c35f-48c0-82f5-72f896e8404e'
       RETURNING id, name, bot_config`
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    
    const bot = result.rows[0];
    console.log('🔀 Full AI Mode disabled');
    console.log('📋 Config:', bot.bot_config);
    
    return res.json({
      success: true,
      message: 'Full AI Mode disabled successfully',
      config: bot.bot_config
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
