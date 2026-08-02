/**
 * Find conversations eligible for an abandoned-checkout reminder.
 * Tenant-scoped via merchant_settings join; never mixes merchants.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import {
  ABANDONED_CHECKOUT_PLATFORMS,
  CHECKOUT_STAGE_IDS,
  DEFAULT_REMINDER_DELAY_MINUTES,
  MAX_REMINDERS_PER_CHECKOUT,
  MAX_REMINDERS_PER_CYCLE,
  MESSAGING_WINDOW_HOURS,
} from './constants.js';
import type { EligibleAbandonedConversation, MerchantReminderSettings } from './types.js';
import type { ConversationState } from '../../core/types.js';
import type { AbandonedCheckoutPlatform } from './constants.js';

function mapSettings(row: any): MerchantReminderSettings {
  const delay = Number(row.abandoned_reminder_delay_minutes);
  return {
    abandoned_reminder_enabled: row.abandoned_reminder_enabled !== false,
    abandoned_reminder_delay_minutes:
      Number.isFinite(delay) && delay >= 5 ? Math.min(delay, 12 * 60) : DEFAULT_REMINDER_DELAY_MINUTES,
    abandoned_reminder_message: row.abandoned_reminder_message || null,
    store_name: row.store_name || null,
  };
}

/**
 * Claim a conversation for reminder send (optimistic lock).
 * Returns true if this worker won the claim.
 */
export async function claimAbandonedReminder(conversationId: string, merchantId: string): Promise<boolean> {
  const claimedAt = new Date().toISOString();
  const result = await pool.query(
    `UPDATE conversations
     SET conversation_state = jsonb_set(
           COALESCE(conversation_state, '{}'::jsonb),
           '{abandoned_checkout}',
           COALESCE(conversation_state->'abandoned_checkout', '{}'::jsonb) ||
             jsonb_build_object('reminder_claimed_at', $3::text),
           true
         ),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND merchant_id = $2
       AND COALESCE(bot_disabled, false) = false
       AND COALESCE(status, 'bot') <> 'human'
       AND (
         conversation_state->'abandoned_checkout'->>'reminder_sent_at' IS NULL
       )
       AND (
         conversation_state->'abandoned_checkout'->>'reminder_claimed_at' IS NULL
         OR (conversation_state->'abandoned_checkout'->>'reminder_claimed_at')::timestamptz
              < NOW() - INTERVAL '10 minutes'
       )
       AND COALESCE(
             (conversation_state->'abandoned_checkout'->>'reminder_count')::int,
             0
           ) < $4
     RETURNING id`,
    [conversationId, merchantId, claimedAt, MAX_REMINDERS_PER_CHECKOUT]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markAbandonedReminderSent(
  conversationId: string,
  merchantId: string
): Promise<void> {
  const sentAt = new Date().toISOString();
  try {
    await pool.query(
      `UPDATE conversations
       SET conversation_state = jsonb_set(
             COALESCE(conversation_state, '{}'::jsonb),
             '{abandoned_checkout}',
             COALESCE(conversation_state->'abandoned_checkout', '{}'::jsonb) ||
               jsonb_build_object(
                 'reminder_sent_at', $3::text,
                 'reminder_count',
                   COALESCE((conversation_state->'abandoned_checkout'->>'reminder_count')::int, 0) + 1,
                 'last_error', null
               ),
             true
           ),
           last_message_at = CURRENT_TIMESTAMP,
           last_bot_response_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId, sentAt]
    );
  } catch (error: any) {
    if (error?.code === '42703') {
      await pool.query(
        `UPDATE conversations
         SET conversation_state = jsonb_set(
               COALESCE(conversation_state, '{}'::jsonb),
               '{abandoned_checkout}',
               COALESCE(conversation_state->'abandoned_checkout', '{}'::jsonb) ||
                 jsonb_build_object(
                   'reminder_sent_at', $3::text,
                   'reminder_count',
                     COALESCE((conversation_state->'abandoned_checkout'->>'reminder_count')::int, 0) + 1,
                   'last_error', null
                 ),
               true
             ),
             last_message_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND merchant_id = $2`,
        [conversationId, merchantId, sentAt]
      );
      return;
    }
    throw error;
  }
}

export async function releaseAbandonedReminderClaim(
  conversationId: string,
  merchantId: string,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET conversation_state = (
           COALESCE(conversation_state, '{}'::jsonb)
           || jsonb_build_object(
                'abandoned_checkout',
                (
                  COALESCE(conversation_state->'abandoned_checkout', '{}'::jsonb)
                  - 'reminder_claimed_at'
                ) || CASE
                  WHEN $3::text IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object('last_error', $3::text)
                END
              )
         ),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND merchant_id = $2`,
    [conversationId, merchantId, errorMessage || null]
  );
}

/** Clear abandoned-checkout meta after a confirmed order (or fresh reset). */
export function clearAbandonedCheckoutFromState(state: ConversationState): void {
  if (state && 'abandoned_checkout' in state) {
    delete (state as ConversationState & { abandoned_checkout?: unknown }).abandoned_checkout;
  }
}

export async function findEligibleAbandonedConversations(): Promise<EligibleAbandonedConversation[]> {
  const stageIds = CHECKOUT_STAGE_IDS as unknown as string[];
  const platforms = ABANDONED_CHECKOUT_PLATFORMS as unknown as string[];

  try {
    const result = await pool.query(
      `SELECT
         c.id,
         c.merchant_id,
         c.platform,
         c.user_id,
         c.user_name,
         c.conversation_state,
         c.session_metadata,
         last_user.created_at AS last_user_message_at,
         ms.abandoned_reminder_enabled,
         ms.abandoned_reminder_delay_minutes,
         ms.abandoned_reminder_message,
         ms.store_name
       FROM conversations c
       INNER JOIN merchant_settings ms ON ms.merchant_id = c.merchant_id
       INNER JOIN LATERAL (
         SELECT m.created_at
         FROM messages m
         WHERE m.conversation_id = c.id
           AND m.role = 'user'
         ORDER BY m.created_at DESC
         LIMIT 1
       ) last_user ON TRUE
       WHERE COALESCE(ms.abandoned_reminder_enabled, TRUE) = TRUE
         AND COALESCE(c.bot_disabled, FALSE) = FALSE
         AND COALESCE(c.status, 'bot') <> 'human'
         AND c.platform = ANY($1::text[])
         AND c.user_id IS NOT NULL
         AND NULLIF(BTRIM(c.user_id), '') IS NOT NULL
         AND (
           c.conversation_state->>'salesgpt_stage_id' = ANY($2::text[])
           OR c.conversation_state->>'current_stage' = 'close'
           OR c.stage = 'close'
         )
         AND NULLIF(BTRIM(c.conversation_state->'extracted_entities'->>'name'), '') IS NOT NULL
         AND NULLIF(BTRIM(c.conversation_state->'extracted_entities'->>'phone'), '') IS NOT NULL
         AND c.conversation_state->'abandoned_checkout'->>'reminder_sent_at' IS NULL
         AND COALESCE(
               (c.conversation_state->'abandoned_checkout'->>'reminder_count')::int,
               0
             ) < $3
         AND (
           c.conversation_state->'abandoned_checkout'->>'reminder_claimed_at' IS NULL
           OR (c.conversation_state->'abandoned_checkout'->>'reminder_claimed_at')::timestamptz
                < NOW() - INTERVAL '10 minutes'
         )
         AND last_user.created_at <= NOW() - make_interval(
               mins => GREATEST(
                 COALESCE(ms.abandoned_reminder_delay_minutes, $4)::int,
                 5
               )
             )
         AND last_user.created_at >= NOW() - make_interval(hours => $5)
         -- Still waiting on the customer (last activity is not a fresher user reply than we already used)
         AND NOT EXISTS (
           SELECT 1
           FROM orders o
           WHERE o.merchant_id = c.merchant_id
             AND o.customer_phone = BTRIM(c.conversation_state->'extracted_entities'->>'phone')
             AND o.status IN ('pending', 'new', 'processing', 'paid', 'fulfilled')
             AND o.created_at >= last_user.created_at
         )
       ORDER BY last_user.created_at ASC
       LIMIT $6`,
      [
        platforms,
        stageIds,
        MAX_REMINDERS_PER_CHECKOUT,
        DEFAULT_REMINDER_DELAY_MINUTES,
        MESSAGING_WINDOW_HOURS,
        MAX_REMINDERS_PER_CYCLE,
      ]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      merchant_id: row.merchant_id,
      platform: row.platform as AbandonedCheckoutPlatform,
      user_id: row.user_id,
      user_name: row.user_name,
      conversation_state: (row.conversation_state || { message_count: 0 }) as ConversationState,
      session_metadata: row.session_metadata || null,
      last_user_message_at: new Date(row.last_user_message_at),
      settings: mapSettings(row),
    }));
  } catch (error: any) {
    // Migration not applied yet — skip silently with a clear log
    if (error?.code === '42703') {
      logger.warn('Abandoned checkout: merchant_settings columns missing — run migration', {
        message: error.message,
      });
      return [];
    }
    throw error;
  }
}
