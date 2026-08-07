/**
 * Merchant-scoped persistence for content publications.
 */

import type { QueryResult, QueryResultRow } from 'pg';
import pool from '../../database/connection.js';
import type {
  ContentPublicationDetail,
  ContentPublicationMediaRow,
  ContentPublicationRow,
  ContentPublicationTargetRow,
  ListPublicationsFilter,
  MediaKind,
  PublicationMediaInput,
  PublicationStatus,
  PublicationTargetInput,
  TargetStatus
} from './types.js';

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<QueryResult<T>>;
};

function deriveMediaKind(media: PublicationMediaInput[]): MediaKind {
  if (!media.length) return 'none';
  if (media.length === 1) {
    return media[0].mediaType === 'video' ? 'video' : 'image';
  }
  return 'carousel';
}

function mapPublication(row: ContentPublicationRow): ContentPublicationRow {
  return {
    ...row,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {}
  };
}

async function loadMedia(publicationIds: string[]): Promise<Map<string, ContentPublicationMediaRow[]>> {
  const map = new Map<string, ContentPublicationMediaRow[]>();
  if (!publicationIds.length) return map;
  const result = await pool.query<ContentPublicationMediaRow>(
    `SELECT * FROM content_publication_media
     WHERE publication_id = ANY($1::uuid[])
     ORDER BY sort_order ASC`,
    [publicationIds]
  );
  for (const row of result.rows) {
    const list = map.get(row.publication_id) || [];
    list.push(row);
    map.set(row.publication_id, list);
  }
  return map;
}

async function loadTargets(
  publicationIds: string[]
): Promise<Map<string, ContentPublicationTargetRow[]>> {
  const map = new Map<string, ContentPublicationTargetRow[]>();
  if (!publicationIds.length) return map;
  const result = await pool.query<ContentPublicationTargetRow>(
    `SELECT * FROM content_publication_targets
     WHERE publication_id = ANY($1::uuid[])
     ORDER BY platform ASC, account_label ASC NULLS LAST`,
    [publicationIds]
  );
  for (const row of result.rows) {
    const list = map.get(row.publication_id) || [];
    list.push(row);
    map.set(row.publication_id, list);
  }
  return map;
}

export async function attachRelations(
  rows: ContentPublicationRow[]
): Promise<ContentPublicationDetail[]> {
  const ids = rows.map((r) => r.id);
  const [mediaMap, targetsMap] = await Promise.all([loadMedia(ids), loadTargets(ids)]);
  return rows.map((row) => ({
    ...mapPublication(row),
    media: mediaMap.get(row.id) || [],
    targets: targetsMap.get(row.id) || []
  }));
}

export async function getPublicationById(
  merchantId: string,
  publicationId: string
): Promise<ContentPublicationDetail | null> {
  const result = await pool.query<ContentPublicationRow>(
    `SELECT * FROM content_publications
     WHERE id = $1 AND merchant_id = $2`,
    [publicationId, merchantId]
  );
  if (!result.rows[0]) return null;
  const [detail] = await attachRelations([result.rows[0]]);
  return detail;
}

export async function listPublications(
  merchantId: string,
  filter: ListPublicationsFilter = {}
): Promise<{ items: ContentPublicationDetail[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);
  const conditions = ['p.merchant_id = $1'];
  const values: unknown[] = [merchantId];
  let i = 2;

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(`p.status = ANY($${i}::text[])`);
    values.push(statuses);
    i += 1;
  }
  if (filter.platform) {
    conditions.push(
      `EXISTS (
         SELECT 1 FROM content_publication_targets t
         WHERE t.publication_id = p.id AND t.merchant_id = p.merchant_id AND t.platform = $${i}
       )`
    );
    values.push(filter.platform);
    i += 1;
  }
  if (filter.from) {
    conditions.push(`COALESCE(p.scheduled_at, p.created_at) >= $${i}`);
    values.push(new Date(filter.from));
    i += 1;
  }
  if (filter.to) {
    conditions.push(`COALESCE(p.scheduled_at, p.created_at) <= $${i}`);
    values.push(new Date(filter.to));
    i += 1;
  }

  const where = conditions.join(' AND ');
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM content_publications p WHERE ${where}`,
    values
  );
  const listResult = await pool.query<ContentPublicationRow>(
    `SELECT p.* FROM content_publications p
     WHERE ${where}
     ORDER BY COALESCE(p.scheduled_at, p.created_at) DESC, p.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...values, limit, offset]
  );

  const items = await attachRelations(listResult.rows);
  return { items, total: Number(countResult.rows[0]?.count || 0) };
}

async function replaceMedia(
  client: Queryable,
  merchantId: string,
  publicationId: string,
  media: PublicationMediaInput[]
): Promise<void> {
  await client.query(
    `DELETE FROM content_publication_media
     WHERE publication_id = $1 AND merchant_id = $2`,
    [publicationId, merchantId]
  );
  for (let idx = 0; idx < media.length; idx += 1) {
    const item = media[idx];
    await client.query(
      `INSERT INTO content_publication_media (
         merchant_id, publication_id, sort_order, media_type, media_url, thumbnail_url, alt_text
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        merchantId,
        publicationId,
        item.sortOrder ?? idx,
        item.mediaType,
        item.mediaUrl,
        item.thumbnailUrl ?? null,
        item.altText ?? null
      ]
    );
  }
}

async function replaceTargets(
  client: Queryable,
  merchantId: string,
  publicationId: string,
  targets: PublicationTargetInput[]
): Promise<void> {
  await client.query(
    `DELETE FROM content_publication_targets
     WHERE publication_id = $1 AND merchant_id = $2`,
    [publicationId, merchantId]
  );
  for (const target of targets) {
    await client.query(
      `INSERT INTO content_publication_targets (
         merchant_id, publication_id, platform, account_ref, account_label, status
       ) VALUES ($1,$2,$3,$4,$5,'pending')`,
      [
        merchantId,
        publicationId,
        target.platform,
        target.accountRef,
        target.accountLabel ?? null
      ]
    );
  }
}

export async function createPublication(
  merchantId: string,
  input: {
    caption?: string | null;
    media: PublicationMediaInput[];
    targets: PublicationTargetInput[];
    status: PublicationStatus;
    scheduledAt?: Date | null;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<ContentPublicationDetail> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mediaKind = deriveMediaKind(input.media);
    const inserted = await client.query<ContentPublicationRow>(
      `INSERT INTO content_publications (
         merchant_id, caption, media_kind, status, scheduled_at, created_by, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [
        merchantId,
        input.caption ?? null,
        mediaKind,
        input.status,
        input.scheduledAt ?? null,
        input.createdBy ?? null,
        JSON.stringify(input.metadata || {})
      ]
    );
    const publication = inserted.rows[0];
    await replaceMedia(client, merchantId, publication.id, input.media);
    await replaceTargets(client, merchantId, publication.id, input.targets);
    await client.query('COMMIT');
    const detail = await getPublicationById(merchantId, publication.id);
    if (!detail) throw new Error('Failed to load created publication');
    return detail;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePublication(
  merchantId: string,
  publicationId: string,
  input: {
    caption?: string | null;
    media?: PublicationMediaInput[];
    targets?: PublicationTargetInput[];
    status?: PublicationStatus;
    scheduledAt?: Date | null;
    clearSchedule?: boolean;
    errorSummary?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<ContentPublicationDetail | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<ContentPublicationRow>(
      `SELECT * FROM content_publications
       WHERE id = $1 AND merchant_id = $2
       FOR UPDATE`,
      [publicationId, merchantId]
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const sets: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let i = 1;

    if (input.caption !== undefined) {
      sets.push(`caption = $${i++}`);
      values.push(input.caption);
    }
    if (input.media) {
      sets.push(`media_kind = $${i++}`);
      values.push(deriveMediaKind(input.media));
    }
    if (input.status) {
      sets.push(`status = $${i++}`);
      values.push(input.status);
    }
    if (input.clearSchedule) {
      sets.push('scheduled_at = NULL');
    } else if (input.scheduledAt !== undefined) {
      sets.push(`scheduled_at = $${i++}`);
      values.push(input.scheduledAt);
    }
    if (input.errorSummary !== undefined) {
      sets.push(`error_summary = $${i++}`);
      values.push(input.errorSummary);
    }
    if (input.metadata) {
      sets.push(`metadata = $${i++}::jsonb`);
      values.push(JSON.stringify(input.metadata));
    }

    values.push(publicationId, merchantId);
    await client.query(
      `UPDATE content_publications
       SET ${sets.join(', ')}
       WHERE id = $${i} AND merchant_id = $${i + 1}`,
      values
    );

    if (input.media) {
      await replaceMedia(client, merchantId, publicationId, input.media);
    }
    if (input.targets) {
      await replaceTargets(client, merchantId, publicationId, input.targets);
    }

    await client.query('COMMIT');
    return getPublicationById(merchantId, publicationId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePublication(
  merchantId: string,
  publicationId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM content_publications
     WHERE id = $1 AND merchant_id = $2`,
    [publicationId, merchantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markPublicationPublishing(
  merchantId: string,
  publicationId: string
): Promise<ContentPublicationDetail | null> {
  const result = await pool.query<ContentPublicationRow>(
    `UPDATE content_publications
     SET status = 'publishing', error_summary = NULL, updated_at = NOW()
     WHERE id = $1 AND merchant_id = $2
       AND status IN ('draft', 'scheduled', 'failed', 'partial')
     RETURNING *`,
    [publicationId, merchantId]
  );
  if (!result.rows[0]) return null;
  await pool.query(
    `UPDATE content_publication_targets
     SET status = 'pending', error_message = NULL, updated_at = NOW()
     WHERE publication_id = $1 AND merchant_id = $2
       AND status IN ('pending', 'failed', 'skipped')`,
    [publicationId, merchantId]
  );
  return getPublicationById(merchantId, publicationId);
}

export async function updateTargetResult(
  merchantId: string,
  targetId: string,
  result: {
    status: TargetStatus;
    externalPostId?: string | null;
    permalink?: string | null;
    containerId?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  // Avoid reusing the same bind param in assignment + comparison (PG 42P08).
  const setPublishedAt = result.status === 'published';
  const metadataJson = result.metadata ? JSON.stringify(result.metadata) : null;

  await pool.query(
    `UPDATE content_publication_targets
     SET status = $1,
         external_post_id = COALESCE($2, external_post_id),
         permalink = COALESCE($3, permalink),
         container_id = COALESCE($4, container_id),
         error_message = $5,
         published_at = CASE WHEN $6::boolean THEN NOW() ELSE published_at END,
         metadata = CASE
           WHEN $7::jsonb IS NULL THEN metadata
           ELSE metadata || $7::jsonb
         END,
         updated_at = NOW()
     WHERE id = $8 AND merchant_id = $9`,
    [
      result.status,
      result.externalPostId ?? null,
      result.permalink ?? null,
      result.containerId ?? null,
      result.errorMessage ?? null,
      setPublishedAt,
      metadataJson,
      targetId,
      merchantId
    ]
  );
}

export async function finalizePublicationStatus(
  merchantId: string,
  publicationId: string
): Promise<ContentPublicationDetail | null> {
  const targets = await pool.query<{ status: TargetStatus }>(
    `SELECT status FROM content_publication_targets
     WHERE publication_id = $1 AND merchant_id = $2`,
    [publicationId, merchantId]
  );
  if (!targets.rows.length) {
    await pool.query(
      `UPDATE content_publications
       SET status = 'failed', error_summary = $3, updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2`,
      [publicationId, merchantId, 'لا توجد حسابات مستهدفة']
    );
    return getPublicationById(merchantId, publicationId);
  }

  const published = targets.rows.filter((t) => t.status === 'published').length;
  const failed = targets.rows.filter((t) => t.status === 'failed').length;
  const total = targets.rows.length;

  let status: PublicationStatus;
  let errorSummary: string | null = null;

  if (published === total) {
    status = 'published';
  } else if (published > 0) {
    status = 'partial';
    errorSummary = `تم النشر على ${published} من ${total} حسابات`;
  } else if (failed === total) {
    status = 'failed';
    const sample = await pool.query<{ error_message: string | null }>(
      `SELECT error_message FROM content_publication_targets
       WHERE publication_id = $1 AND merchant_id = $2 AND status = 'failed'
       LIMIT 1`,
      [publicationId, merchantId]
    );
    errorSummary = sample.rows[0]?.error_message || 'فشل النشر على جميع الحسابات';
  } else {
    status = 'failed';
    errorSummary = 'لم يكتمل النشر';
  }

  const setPublishedAt = status === 'published' || status === 'partial';
  await pool.query(
    `UPDATE content_publications
     SET status = $3,
         published_at = CASE WHEN $5::boolean THEN COALESCE(published_at, NOW()) ELSE published_at END,
         error_summary = $4,
         updated_at = NOW()
     WHERE id = $1 AND merchant_id = $2`,
    [publicationId, merchantId, status, errorSummary, setPublishedAt]
  );

  return getPublicationById(merchantId, publicationId);
}

/**
 * Atomically claim due scheduled publications for the worker.
 * Uses SKIP LOCKED so multiple processes won't double-publish.
 */
export async function claimDuePublications(limit: number): Promise<
  Array<{ id: string; merchant_id: string }>
> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ id: string; merchant_id: string }>(
      `WITH due AS (
         SELECT id
         FROM content_publications
         WHERE status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE content_publications p
       SET status = 'publishing', error_summary = NULL, updated_at = NOW()
       FROM due
       WHERE p.id = due.id
       RETURNING p.id, p.merchant_id`,
      [limit]
    );
    await client.query('COMMIT');
    return claimed.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
