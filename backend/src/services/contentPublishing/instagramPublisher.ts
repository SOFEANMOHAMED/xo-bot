import {
  IG_CONTAINER_POLL_ATTEMPTS,
  IG_CONTAINER_POLL_INTERVAL_MS
} from './constants.js';
import { graphGet, graphPost, sleep } from './metaGraphClient.js';
import { prepareMediaForMeta } from './preparePublishMedia.js';
import type {
  ContentPublicationMediaRow,
  PublishAccountCredentials,
  TargetPublishResult
} from './types.js';

type ContainerCreateResponse = { id: string };
type ContainerStatusResponse = {
  status_code?: string;
  status?: string;
};
type MediaPublishResponse = { id: string };
type MediaLookupResponse = { id?: string; permalink?: string };

async function waitForContainerReady(
  containerId: string,
  accessToken: string
): Promise<void> {
  for (let attempt = 0; attempt < IG_CONTAINER_POLL_ATTEMPTS; attempt += 1) {
    const status = await graphGet<ContainerStatusResponse>(containerId, accessToken, {
      fields: 'status_code,status'
    });
    const code = (status.status_code || status.status || '').toUpperCase();
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`حاوية إنستغرام فشلت بالمعالجة (${code})`);
    }
    await sleep(IG_CONTAINER_POLL_INTERVAL_MS);
  }
  throw new Error('انتهت مهلة معالجة وسائط إنستغرام');
}

async function createImageContainer(params: {
  igUserId: string;
  accessToken: string;
  imageUrl: string;
  caption?: string | null;
  isCarouselItem?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    image_url: params.imageUrl,
    media_type: 'IMAGE'
  };
  if (params.isCarouselItem) {
    body.is_carousel_item = true;
  } else if (params.caption) {
    body.caption = params.caption;
  }
  const created = await graphPost<ContainerCreateResponse>(
    `${params.igUserId}/media`,
    params.accessToken,
    body
  );
  return created.id;
}

async function createVideoContainer(params: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption?: string | null;
  isCarouselItem?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    video_url: params.videoUrl,
    media_type: 'REELS'
  };
  if (params.isCarouselItem) {
    body.is_carousel_item = true;
    body.media_type = 'VIDEO';
  } else if (params.caption) {
    body.caption = params.caption;
  }
  const created = await graphPost<ContainerCreateResponse>(
    `${params.igUserId}/media`,
    params.accessToken,
    body
  );
  return created.id;
}

async function publishContainer(params: {
  igUserId: string;
  accessToken: string;
  creationId: string;
}): Promise<string> {
  await waitForContainerReady(params.creationId, params.accessToken);
  const published = await graphPost<MediaPublishResponse>(
    `${params.igUserId}/media_publish`,
    params.accessToken,
    { creation_id: params.creationId }
  );
  return published.id;
}

async function resolvePermalink(
  mediaId: string,
  accessToken: string
): Promise<string | undefined> {
  try {
    const data = await graphGet<MediaLookupResponse>(mediaId, accessToken, {
      fields: 'id,permalink'
    });
    return data.permalink;
  } catch {
    return undefined;
  }
}

export async function publishToInstagram(params: {
  credentials: PublishAccountCredentials;
  caption: string | null;
  media: ContentPublicationMediaRow[];
}): Promise<TargetPublishResult> {
  const { credentials, caption } = params;
  const igUserId = credentials.accountRef;
  const token = credentials.accessToken;
  const media = await prepareMediaForMeta(params.media);

  try {
    if (!media.length) {
      return {
        success: false,
        errorMessage: 'إنستغرام لا يدعم المنشورات النصية فقط — أضف صورة أو فيديو'
      };
    }

    let containerId: string;

    if (media.length === 1) {
      const item = media[0];
      containerId =
        item.media_type === 'video'
          ? await createVideoContainer({
              igUserId,
              accessToken: token,
              videoUrl: item.media_url,
              caption
            })
          : await createImageContainer({
              igUserId,
              accessToken: token,
              imageUrl: item.media_url,
              caption
            });
    } else {
      const children: string[] = [];
      for (const item of media) {
        if (item.media_type === 'video') {
          children.push(
            await createVideoContainer({
              igUserId,
              accessToken: token,
              videoUrl: item.media_url,
              isCarouselItem: true
            })
          );
        } else {
          children.push(
            await createImageContainer({
              igUserId,
              accessToken: token,
              imageUrl: item.media_url,
              isCarouselItem: true
            })
          );
        }
      }

      const parent = await graphPost<ContainerCreateResponse>(`${igUserId}/media`, token, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: caption || undefined
      });
      containerId = parent.id;
    }

    const mediaId = await publishContainer({
      igUserId,
      accessToken: token,
      creationId: containerId
    });
    const permalink = await resolvePermalink(mediaId, token);

    return {
      success: true,
      externalPostId: mediaId,
      permalink,
      containerId,
      metadata: { mediaCount: media.length }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فشل النشر على إنستغرام';
    return { success: false, errorMessage: message };
  }
}
