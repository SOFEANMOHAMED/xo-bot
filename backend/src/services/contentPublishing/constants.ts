export const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Scheduler tick interval (minutes) */
export const CONTENT_SCHEDULER_INTERVAL_MINUTES = 1;

/** Max publications claimed per scheduler cycle */
export const CONTENT_SCHEDULER_BATCH_SIZE = 10;

/** Max media items in a carousel */
export const MAX_CAROUSEL_ITEMS = 10;

/** Min media items for carousel */
export const MIN_CAROUSEL_ITEMS = 2;

/** Instagram caption hard limit */
export const IG_CAPTION_MAX = 2200;

/** Facebook message practical limit */
export const FB_CAPTION_MAX = 63206;

/** Max wait for IG media container to finish processing */
export const IG_CONTAINER_POLL_ATTEMPTS = 20;
export const IG_CONTAINER_POLL_INTERVAL_MS = 2000;

export const EDITABLE_STATUSES = new Set(['draft', 'scheduled', 'failed', 'cancelled']);
export const DELETABLE_STATUSES = new Set(['draft', 'scheduled', 'failed', 'cancelled', 'published', 'partial']);
export const CANCELLABLE_STATUSES = new Set(['scheduled']);
