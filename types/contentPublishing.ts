export type ContentPlatform = 'facebook' | 'instagram';

export type PublicationStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type MediaKind = 'none' | 'image' | 'video' | 'carousel';

export interface ContentPublishAccount {
  platform: ContentPlatform;
  accountRef: string;
  accountLabel: string | null;
  pageId?: string | null;
}

export interface ContentPublicationMedia {
  id?: string;
  sortOrder: number;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
}

export interface ContentPublicationTarget {
  id?: string;
  platform: ContentPlatform;
  accountRef: string;
  accountLabel: string | null;
  status: 'pending' | 'publishing' | 'published' | 'failed' | 'skipped';
  externalPostId?: string | null;
  permalink?: string | null;
  errorMessage?: string | null;
  publishedAt?: string | null;
}

export interface ContentPublication {
  id: string;
  caption: string | null;
  mediaKind: MediaKind;
  status: PublicationStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  media: ContentPublicationMedia[];
  targets: ContentPublicationTarget[];
}

export interface CreateContentPublicationPayload {
  caption?: string | null;
  media?: Array<{
    mediaUrl: string;
    mediaType: 'image' | 'video';
    thumbnailUrl?: string | null;
    altText?: string | null;
    sortOrder?: number;
  }>;
  targets: Array<{
    platform: ContentPlatform;
    accountRef: string;
    accountLabel?: string | null;
  }>;
  scheduledAt?: string | null;
  publishNow?: boolean;
}
