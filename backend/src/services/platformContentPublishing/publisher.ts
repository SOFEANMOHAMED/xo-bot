/**
 * Publish an official-page publication to Facebook / Instagram.
 * Reuses merchant Graph publishers; credentials come from the platform page only.
 */

import { logger } from '../../utils/logger.js';
import { publishToFacebookPage } from '../contentPublishing/facebookPublisher.js';
import { publishToInstagram } from '../contentPublishing/instagramPublisher.js';
import type { ContentPublicationMediaRow } from '../contentPublishing/types.js';
import { resolvePlatformAccountCredentials } from './accounts.js';
import {
  finalizePlatformPublicationStatus,
  getPlatformPublicationById,
  markPlatformPublicationPublishing,
  updatePlatformTargetResult,
} from './repository.js';
import type { PlatformPublicationDetail, PlatformPublicationMediaRow } from './types.js';

function toPublisherMedia(media: PlatformPublicationMediaRow[]): ContentPublicationMediaRow[] {
  return media.map((item) => ({
    ...item,
    merchant_id: '',
  }));
}

async function publishSingleTarget(
  publication: PlatformPublicationDetail,
  targetId: string
): Promise<void> {
  const target = publication.targets.find((t) => t.id === targetId);
  if (!target) return;

  await updatePlatformTargetResult(target.id, { status: 'publishing' });

  const credentials = await resolvePlatformAccountCredentials(target.platform, target.account_ref);

  if (!credentials) {
    await updatePlatformTargetResult(target.id, {
      status: 'failed',
      errorMessage: 'الحساب الرسمي غير مرتبط أو التوكن غير متاح',
    });
    return;
  }

  const media = toPublisherMedia(publication.media);
  const result =
    target.platform === 'facebook'
      ? await publishToFacebookPage({
          credentials,
          caption: publication.caption,
          media,
        })
      : await publishToInstagram({
          credentials,
          caption: publication.caption,
          media,
        });

  if (result.success) {
    await updatePlatformTargetResult(target.id, {
      status: 'published',
      externalPostId: result.externalPostId,
      permalink: result.permalink,
      containerId: result.containerId,
      metadata: result.metadata,
    });
  } else {
    await updatePlatformTargetResult(target.id, {
      status: 'failed',
      errorMessage: result.errorMessage || 'فشل النشر',
      containerId: result.containerId,
      metadata: result.metadata,
    });
  }
}

export async function executePlatformPublication(params: {
  publicationId: string;
  alreadyClaimed?: boolean;
}): Promise<PlatformPublicationDetail> {
  const { publicationId, alreadyClaimed } = params;

  let publication: PlatformPublicationDetail | null;

  if (alreadyClaimed) {
    publication = await getPlatformPublicationById(publicationId);
    if (!publication) {
      throw new Error('المنشور غير موجود');
    }
    for (const target of publication.targets) {
      if (target.status !== 'published') {
        await updatePlatformTargetResult(target.id, {
          status: 'pending',
          errorMessage: null,
        });
      }
    }
    publication = await getPlatformPublicationById(publicationId);
  } else {
    publication = await markPlatformPublicationPublishing(publicationId);
  }

  if (!publication) {
    throw new Error('تعذّر بدء النشر — تحقق من حالة المنشور');
  }

  logger.info('Platform content publication started', {
    publicationId,
    pageId: publication.page_id,
    targets: publication.targets.length,
  });

  for (const target of publication.targets) {
    if (target.status === 'published') continue;
    try {
      await publishSingleTarget(publication, target.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خطأ غير متوقع أثناء النشر';
      logger.error('Platform content publication target failed', error as Error, {
        publicationId,
        targetId: target.id,
        platform: target.platform,
      });
      await updatePlatformTargetResult(target.id, {
        status: 'failed',
        errorMessage: message,
      });
    }
  }

  const finalized = await finalizePlatformPublicationStatus(publicationId);
  if (!finalized) {
    throw new Error('تعذّر تحديث حالة المنشور بعد النشر');
  }

  logger.info('Platform content publication finished', {
    publicationId,
    status: finalized.status,
  });

  return finalized;
}
