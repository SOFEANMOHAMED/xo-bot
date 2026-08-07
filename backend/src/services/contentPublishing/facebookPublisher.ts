import { graphGet, graphPost } from './metaGraphClient.js';
import { prepareMediaForMeta } from './preparePublishMedia.js';
import type {
  ContentPublicationMediaRow,
  PublishAccountCredentials,
  TargetPublishResult
} from './types.js';

type PhotoUploadResponse = { id: string; post_id?: string };
type FeedPostResponse = { id: string };
type VideoUploadResponse = { id: string };

async function resolvePermalink(
  postId: string,
  accessToken: string
): Promise<string | undefined> {
  try {
    const data = await graphGet<{ permalink_url?: string }>(postId, accessToken, {
      fields: 'permalink_url'
    });
    return data.permalink_url;
  } catch {
    return undefined;
  }
}

export async function publishToFacebookPage(params: {
  credentials: PublishAccountCredentials;
  caption: string | null;
  media: ContentPublicationMediaRow[];
}): Promise<TargetPublishResult> {
  const { credentials, caption } = params;
  const pageId = credentials.accountRef;
  const token = credentials.accessToken;
  const media = await prepareMediaForMeta(params.media);

  try {
    if (!media.length) {
      if (!caption?.trim()) {
        return { success: false, errorMessage: 'منشور فيسبوك يحتاج نصاً أو وسائط' };
      }
      const posted = await graphPost<FeedPostResponse>(`${pageId}/feed`, token, {
        message: caption
      });
      const permalink = await resolvePermalink(posted.id, token);
      return { success: true, externalPostId: posted.id, permalink };
    }

    if (media.length === 1 && media[0].media_type === 'image') {
      const posted = await graphPost<PhotoUploadResponse>(`${pageId}/photos`, token, {
        url: media[0].media_url,
        caption: caption || undefined,
        published: true
      });
      const postId = posted.post_id || posted.id;
      const permalink = await resolvePermalink(postId, token);
      return { success: true, externalPostId: postId, permalink };
    }

    if (media.length === 1 && media[0].media_type === 'video') {
      const posted = await graphPost<VideoUploadResponse>(`${pageId}/videos`, token, {
        file_url: media[0].media_url,
        description: caption || undefined,
        published: true
      });
      const permalink = await resolvePermalink(posted.id, token);
      return { success: true, externalPostId: posted.id, permalink };
    }

    // Multi-image / carousel-style: unpublished photos then feed attach
    const images = media.filter((m) => m.media_type === 'image');
    if (!images.length) {
      return { success: false, errorMessage: 'منشور متعدد الوسائط على فيسبوك يتطلب صوراً' };
    }

    const attached: Array<{ media_fbid: string }> = [];
    for (const image of images) {
      const uploaded = await graphPost<PhotoUploadResponse>(`${pageId}/photos`, token, {
        url: image.media_url,
        published: false,
        temporary: true
      });
      attached.push({ media_fbid: uploaded.id });
    }

    const posted = await graphPost<FeedPostResponse>(`${pageId}/feed`, token, {
      message: caption || undefined,
      attached_media: attached
    });
    const permalink = await resolvePermalink(posted.id, token);
    return {
      success: true,
      externalPostId: posted.id,
      permalink,
      metadata: { attachedCount: attached.length }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فشل النشر على فيسبوك';
    return { success: false, errorMessage: message };
  }
}
