/**
 * Admin endpoint to enable Full AI Mode
 * POST /api/admin/enable-full-ai
 */

import type { Request, Response } from 'express';
import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export const enableFullAIMode = async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }
    
    // Update bot config to enable full AI mode
    const result = await pool.query(
      `UPDATE bots
       SET bot_config = COALESCE(bot_config, '{}'::jsonb) || '{"use_full_ai_mode": true}'::jsonb
       WHERE merchant_id = $1
       RETURNING id, name, bot_config`,
      [merchantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found for merchant' });
    }
    
    const bot = result.rows[0];
    
    logger.info('Full AI Mode enabled', {
      merchantId,
      botId: bot.id,
      botName: bot.name
    });
    
    console.log('✅ Full AI Mode enabled for bot:', bot.name);
    console.log('📋 New Config:', bot.bot_config);
    
    return res.json({
      success: true,
      message: 'Full AI Mode enabled successfully',
      bot: {
        id: bot.id,
        name: bot.name,
        config: bot.bot_config
      }
    });
    
  } catch (error) {
    logger.error('Failed to enable Full AI Mode', error as Error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const disableFullAIMode = async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }
    
    // Update bot config to disable full AI mode
    const result = await pool.query(
      `UPDATE bots
       SET bot_config = COALESCE(bot_config, '{}'::jsonb) || '{"use_full_ai_mode": false}'::jsonb
       WHERE merchant_id = $1
       RETURNING id, name, bot_config`,
      [merchantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found for merchant' });
    }
    
    const bot = result.rows[0];
    
    logger.info('Full AI Mode disabled', {
      merchantId,
      botId: bot.id,
      botName: bot.name
    });
    
    console.log('🔀 Full AI Mode disabled for bot:', bot.name);
    console.log('📋 New Config:', bot.bot_config);
    
    return res.json({
      success: true,
      message: 'Full AI Mode disabled successfully',
      bot: {
        id: bot.id,
        name: bot.name,
        config: bot.bot_config
      }
    });
    
  } catch (error) {
    logger.error('Failed to disable Full AI Mode', error as Error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
