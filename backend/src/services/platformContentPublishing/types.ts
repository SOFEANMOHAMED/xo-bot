import type {
  ContentPlatform,
  MediaKind,
  MediaType,
  PublicationStatus,
  TargetStatus
} from '../contentPublishing/types.js';

export type {
  ContentPlatform,
  MediaKind,
  MediaType,
  PublicationStatus,
  TargetStatus
};

export interface PlatformPublicationMediaRow {
  id: string;
  publication_id: string;
  sort_order: number;
  media_type: MediaType;
  media_url: string;
  thumbnail_url: string | null;
  alt_text: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface PlatformPublicationTargetRow {
  id: string;
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

export interface PlatformPublicationRow {
  id: string;
  page_id: string;
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

export interface PlatformPublicationDetail extends PlatformPublicationRow {
  media: PlatformPublicationMediaRow[];
  targets: PlatformPublicationTargetRow[];
}
