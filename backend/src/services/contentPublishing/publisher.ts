import { logger } from '../../utils/logger.js';
import { resolveAccountCredentials } from './accounts.js';
import { publishToFacebookPage } from './facebookPublisher.js';
import { publishToInstagram } from './instagramPublisher.js';
import {
  finalizePublicationStatus,
  getPublicationById,
  markPublicationPublishing,
  updateTargetResult
} from './repository.js';
import type { ContentPublicationDetail } from './types.js';

async function publishSingleTarget(
  merchantId: string,
  publication: ContentPublicationDetail,
  targetId: string
): Promise<void> {
  const target = publication.targets.find((t) => t.id === targetId);
  if (!target) return;

  await updateTargetResult(merchantId, target.id, { status: 'publishing' });

  const credentials = await resolveAccountCredentials(
    merchantId,
    target.platform,
    target.account_ref
  );

  if (!credentials) {
    await updateTargetResult(merchantId, target.id, {
      status: 'failed',
      errorMessage: 'الحساب غير مرتبط أو التوكن غير متاح لهذا التاجر'
    });
    return;
  }

  const result =
    target.platform === 'facebook'
      ? await publishToFacebookPage({
          credentials,
          caption: publication.caption,
          media: publication.media
        })
      : await publishToInstagram({
          credentials,
          caption: publication.caption,
          media: publication.media
        });

  if (result.success) {
    await updateTargetResult(merchantId, target.id, {
      status: 'published',
      externalPostId: result.externalPostId,
      permalink: result.permalink,
      containerId: result.containerId,
      metadata: result.metadata
    });
  } else {
    await updateTargetResult(merchantId, target.id, {
      status: 'failed',
      errorMessage: result.errorMessage || 'فشل النشر',
      containerId: result.containerId,
      metadata: result.metadata
    });
  }
}

/**
 * Publish (or retry failed targets of) a merchant-owned publication.
 * Caller must ensure the publication is in an eligible state, or pass alreadyClaimed.
 */
export async function executePublication(params: {
  merchantId: string;
  publicationId: string;
  /** When true, status was already set to publishing (scheduler claim) */
  alreadyClaimed?: boolean;
}): Promise<ContentPublicationDetail> {
  const { merchantId, publicationId, alreadyClaimed } = params;

  let publication: ContentPublicationDetail | null;

  if (alreadyClaimed) {
    publication = await getPublicationById(merchantId, publicationId);
    if (!publication) {
      throw new Error('المنشور غير موجود');
    }
    // Reset pending targets for a clean run after claim
    for (const target of publication.targets) {
      if (target.status !== 'published') {
        await updateTargetResult(merchantId, target.id, {
          status: 'pending',
          errorMessage: null
        });
      }
    }
    publication = await getPublicationById(merchantId, publicationId);
  } else {
    publication = await markPublicationPublishing(merchantId, publicationId);
  }

  if (!publication) {
    throw new Error('تعذّر بدء النشر — تحقق من حالة المنشور');
  }

  logger.info('Content publication started', {
    merchantId,
    publicationId,
    targets: publication.targets.length
  });

  for (const target of publication.targets) {
    if (target.status === 'published') continue;
    try {
      await publishSingleTarget(merchantId, publication, target.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خطأ غير متوقع أثناء النشر';
      logger.error('Content publication target failed', error as Error, {
        merchantId,
        publicationId,
        targetId: target.id,
        platform: target.platform
      });
      await updateTargetResult(merchantId, target.id, {
        status: 'failed',
        errorMessage: message
      });
    }
  }

  const finalized = await finalizePublicationStatus(merchantId, publicationId);
  if (!finalized) {
    throw new Error('تعذّر تحديث حالة المنشور بعد النشر');
  }

  logger.info('Content publication finished', {
    merchantId,
    publicationId,
    status: finalized.status
  });

  return finalized;
}
