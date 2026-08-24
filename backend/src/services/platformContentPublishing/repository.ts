/**
 * Platform-scoped persistence for official-page content publications.
 * No merchant_id — isolated from merchant content_publications.
 */

import type { QueryResult, QueryResultRow } from 'pg';
import pool from '../../database/connection.js';
import type {
  ListPublicationsFilter,
  MediaKind,
  PublicationMediaInput,
  PublicationStatus,
  PublicationTargetInput,
  TargetStatus,
} from '../contentPublishing/types.js';
import { ensurePlatformContentPublishingTables } from './ensure.js';
import type {
  PlatformPublicationDetail,
  PlatformPublicationMediaRow,
  PlatformPublicationRow,
  PlatformPublicationTargetRow,
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

function mapPublication(row: PlatformPublicationRow): PlatformPublicationRow {
  return {
    ...row,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
  };
}

async function loadMedia(
  publicationIds: string[]
): Promise<Map<string, PlatformPublicationMediaRow[]>> {
  const map = new Map<string, PlatformPublicationMediaRow[]>();
  if (!publicationIds.length) return map;
  const result = await pool.query<PlatformPublicationMediaRow>(
    `SELECT * FROM platform_content_publication_media
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
): Promise<Map<string, PlatformPublicationTargetRow[]>> {
  const map = new Map<string, PlatformPublicationTargetRow[]>();
  if (!publicationIds.length) return map;
  const result = await pool.query<PlatformPublicationTargetRow>(
    `SELECT * FROM platform_content_publication_targets
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
  rows: PlatformPublicationRow[]
): Promise<PlatformPublicationDetail[]> {
  const ids = rows.map((r) => r.id);
  const [mediaMap, targetsMap] = await Promise.all([loadMedia(ids), loadTargets(ids)]);
  return rows.map((row) => ({
    ...mapPublication(row),
    media: mediaMap.get(row.id) || [],
    targets: targetsMap.get(row.id) || [],
  }));
}

export async function getPlatformPublicationById(
  publicationId: string
): Promise<PlatformPublicationDetail | null> {
  await ensurePlatformContentPublishingTables();
  const result = await pool.query<PlatformPublicationRow>(
    `SELECT * FROM platform_content_publications WHERE id = $1`,
    [publicationId]
  );
  if (!result.rows[0]) return null;
  const [detail] = await attachRelations([result.rows[0]]);
  return detail;
}

export async function listPlatformPublications(
  filter: ListPublicationsFilter = {}
): Promise<{ items: PlatformPublicationDetail[]; total: number }> {
  await ensurePlatformContentPublishingTables();
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(`p.status = ANY($${i}::text[])`);
    values.push(statuses);
    i += 1;
  }
  if (filter.platform) {
    conditions.push(
      `EXISTS (
         SELECT 1 FROM platform_content_publication_targets t
         WHERE t.publication_id = p.id AND t.platform = $${i}
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform_content_publications p ${where}`,
    values
  );
  const listResult = await pool.query<PlatformPublicationRow>(
    `SELECT p.* FROM platform_content_publications p
     ${where}
     ORDER BY COALESCE(p.scheduled_at, p.created_at) DESC, p.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...values, limit, offset]
  );

  const items = await attachRelations(listResult.rows);
  return { items, total: Number(countResult.rows[0]?.count || 0) };
}

async function replaceMedia(
  client: Queryable,
  publicationId: string,
  media: PublicationMediaInput[]
): Promise<void> {
  await client.query(`DELETE FROM platform_content_publication_media WHERE publication_id = $1`, [
    publicationId,
  ]);
  for (let idx = 0; idx < media.length; idx += 1) {
    const item = media[idx];
    await client.query(
      `INSERT INTO platform_content_publication_media (
         publication_id, sort_order, media_type, media_url, thumbnail_url, alt_text
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        publicationId,
        item.sortOrder ?? idx,
        item.mediaType,
        item.mediaUrl,
        item.thumbnailUrl ?? null,
        item.altText ?? null,
      ]
    );
  }
}

async function replaceTargets(
  client: Queryable,
  publicationId: string,
  targets: PublicationTargetInput[]
): Promise<void> {
  await client.query(
    `DELETE FROM platform_content_publication_targets WHERE publication_id = $1`,
    [publicationId]
  );
  for (const target of targets) {
    await client.query(
      `INSERT INTO platform_content_publication_targets (
         publication_id, platform, account_ref, account_label, status
       ) VALUES ($1,$2,$3,$4,'pending')`,
      [publicationId, target.platform, target.accountRef, target.accountLabel ?? null]
    );
  }
}

export async function createPlatformPublication(input: {
  pageId: string;
  caption?: string | null;
  media: PublicationMediaInput[];
  targets: PublicationTargetInput[];
  status: PublicationStatus;
  scheduledAt?: Date | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PlatformPublicationDetail> {
  await ensurePlatformContentPublishingTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mediaKind = deriveMediaKind(input.media);
    const inserted = await client.query<PlatformPublicationRow>(
      `INSERT INTO platform_content_publications (
         page_id, caption, media_kind, status, scheduled_at, created_by, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [
        input.pageId,
        input.caption ?? null,
        mediaKind,
        input.status,
        input.scheduledAt ?? null,
        input.createdBy ?? null,
        JSON.stringify(input.metadata || {}),
      ]
    );
    const publication = inserted.rows[0];
    await replaceMedia(client, publication.id, input.media);
    await replaceTargets(client, publication.id, input.targets);
    await client.query('COMMIT');
    const detail = await getPlatformPublicationById(publication.id);
    if (!detail) throw new Error('Failed to load created platform publication');
    return detail;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePlatformPublication(
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
): Promise<PlatformPublicationDetail | null> {
  await ensurePlatformContentPublishingTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<PlatformPublicationRow>(
      `SELECT * FROM platform_content_publications WHERE id = $1 FOR UPDATE`,
      [publicationId]
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

    values.push(publicationId);
    await client.query(
      `UPDATE platform_content_publications SET ${sets.join(', ')} WHERE id = $${i}`,
      values
    );

    if (input.media) {
      await replaceMedia(client, publicationId, input.media);
    }
    if (input.targets) {
      await replaceTargets(client, publicationId, input.targets);
    }

    await client.query('COMMIT');
    return getPlatformPublicationById(publicationId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePlatformPublication(publicationId: string): Promise<boolean> {
  await ensurePlatformContentPublishingTables();
  const result = await pool.query(`DELETE FROM platform_content_publications WHERE id = $1`, [
    publicationId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function markPlatformPublicationPublishing(
  publicationId: string
): Promise<PlatformPublicationDetail | null> {
  await ensurePlatformContentPublishingTables();
  const result = await pool.query<PlatformPublicationRow>(
    `UPDATE platform_content_publications
     SET status = 'publishing', error_summary = NULL, updated_at = NOW()
     WHERE id = $1
       AND status IN ('draft', 'scheduled', 'failed', 'partial')
     RETURNING *`,
    [publicationId]
  );
  if (!result.rows[0]) return null;
  await pool.query(
    `UPDATE platform_content_publication_targets
     SET status = 'pending', error_message = NULL, updated_at = NOW()
     WHERE publication_id = $1
       AND status IN ('pending', 'failed', 'skipped')`,
    [publicationId]
  );
  return getPlatformPublicationById(publicationId);
}

export async function updatePlatformTargetResult(
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
  const setPublishedAt = result.status === 'published';
  const metadataJson = result.metadata ? JSON.stringify(result.metadata) : null;

  await pool.query(
    `UPDATE platform_content_publication_targets
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
     WHERE id = $8`,
    [
      result.status,
      result.externalPostId ?? null,
      result.permalink ?? null,
      result.containerId ?? null,
      result.errorMessage ?? null,
      setPublishedAt,
      metadataJson,
      targetId,
    ]
  );
}

export async function finalizePlatformPublicationStatus(
  publicationId: string
): Promise<PlatformPublicationDetail | null> {
  const targets = await pool.query<{ status: TargetStatus }>(
    `SELECT status FROM platform_content_publication_targets WHERE publication_id = $1`,
    [publicationId]
  );
  if (!targets.rows.length) {
    await pool.query(
      `UPDATE platform_content_publications
       SET status = 'failed', error_summary = $2, updated_at = NOW()
       WHERE id = $1`,
      [publicationId, 'لا توجد حسابات مستهدفة']
    );
    return getPlatformPublicationById(publicationId);
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
      `SELECT error_message FROM platform_content_publication_targets
       WHERE publication_id = $1 AND status = 'failed'
       LIMIT 1`,
      [publicationId]
    );
    errorSummary = sample.rows[0]?.error_message || 'فشل النشر على جميع الحسابات';
  } else {
    status = 'failed';
    errorSummary = 'لم يكتمل النشر';
  }

  const setPublishedAt = status === 'published' || status === 'partial';
  await pool.query(
    `UPDATE platform_content_publications
     SET status = $2,
         published_at = CASE WHEN $4::boolean THEN COALESCE(published_at, NOW()) ELSE published_at END,
         error_summary = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [publicationId, status, errorSummary, setPublishedAt]
  );

  return getPlatformPublicationById(publicationId);
}

export async function claimDuePlatformPublications(
  limit: number
): Promise<Array<{ id: string }>> {
  await ensurePlatformContentPublishingTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ id: string }>(
      `WITH due AS (
         SELECT id
         FROM platform_content_publications
         WHERE status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE platform_content_publications p
       SET status = 'publishing', error_summary = NULL, updated_at = NOW()
       FROM due
       WHERE p.id = due.id
       RETURNING p.id`,
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
