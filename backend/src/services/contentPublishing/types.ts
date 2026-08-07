export type ContentPlatform = 'facebook' | 'instagram';

export type PublicationStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type TargetStatus = 'pending' | 'publishing' | 'published' | 'failed' | 'skipped';

export type MediaKind = 'none' | 'image' | 'video' | 'carousel';

export type MediaType = 'image' | 'video';

export interface PublicationMediaInput {
  mediaUrl: string;
  mediaType: MediaType;
  thumbnailUrl?: string | null;
  altText?: string | null;
  sortOrder?: number;
}

export interface PublicationTargetInput {
  platform: ContentPlatform;
  accountRef: string;
  accountLabel?: string | null;
}

export interface CreatePublicationInput {
  caption?: string | null;
  media?: PublicationMediaInput[];
  targets: PublicationTargetInput[];
  scheduledAt?: string | Date | null;
  /** When true and no scheduledAt → publish immediately after create */
  publishNow?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdatePublicationInput {
  caption?: string | null;
  media?: PublicationMediaInput[];
  targets?: PublicationTargetInput[];
  scheduledAt?: string | Date | null;
  metadata?: Record<string, unknown>;
}

export interface ContentPublicationMediaRow {
  id: string;
  merchant_id: string;
  publication_id: string;
  sort_order: number;
  media_type: MediaType;
  media_url: string;
  thumbnail_url: string | null;
  alt_text: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface ContentPublicationTargetRow {
  id: string;
  merchant_id: string;
  publication_id: string;
  platform: ContentPlatform;
  account_ref: string;
  account_label: string | null;
  status: TargetStatus;
  external_post_id: string | null;
  permalink: string | null;
  container_id: string | null;
  error_message: string | null;
  published_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ContentPublicationRow {
  id: string;
  merchant_id: string;
  caption: string | null;
  media_kind: MediaKind;
  status: PublicationStatus;
  scheduled_at: Date | null;
  published_at: Date | null;
  created_by: string | null;
  error_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ContentPublicationDetail extends ContentPublicationRow {
  media: ContentPublicationMediaRow[];
  targets: ContentPublicationTargetRow[];
}

export interface PublishAccountCredentials {
  platform: ContentPlatform;
  accountRef: string;
  accountLabel: string | null;
  accessToken: string;
  /** Instagram needs page-linked token; page_id used for diagnostics */
  pageId?: string | null;
}

export interface TargetPublishResult {
  success: boolean;
  externalPostId?: string;
  permalink?: string;
  containerId?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface ListPublicationsFilter {
  status?: PublicationStatus | PublicationStatus[];
  platform?: ContentPlatform;
  limit?: number;
  offset?: number;
  from?: Date | string;
  to?: Date | string;
}

export interface PublishableAccount {
  platform: ContentPlatform;
  accountRef: string;
  accountLabel: string | null;
  pageId?: string | null;
}
