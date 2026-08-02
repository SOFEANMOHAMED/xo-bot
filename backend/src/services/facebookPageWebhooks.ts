/**
 * Shared Facebook/Instagram Page webhook subscription helpers.
 * Kept separate to avoid circular imports between controllers.
 */

/** Fields for Messenger human takeover + Page feed (comments arrive via `feed`). */
export const FACEBOOK_PAGE_SUBSCRIBED_FIELDS =
  'messages,messaging_postbacks,message_deliveries,message_reads,message_echoes,feed';

export async function subscribeFacebookPageWebhooks(
  pageId: string,
  pageAccessToken: string
): Promise<{ ok: boolean; data?: unknown }> {
  const subscribeResponse = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/subscribed_apps`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: FACEBOOK_PAGE_SUBSCRIBED_FIELDS,
        access_token: pageAccessToken
      })
    }
  );
  const subscribeData = await subscribeResponse.json();
  return { ok: subscribeResponse.ok, data: subscribeData };
}
