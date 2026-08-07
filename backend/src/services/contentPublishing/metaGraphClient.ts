import { GRAPH_BASE } from './constants.js';

export class MetaGraphError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly httpStatus: number;

  constructor(
    message: string,
    opts: {
      code?: number;
      subcode?: number;
      type?: string;
      fbtraceId?: string;
      httpStatus: number;
    }
  ) {
    super(message);
    this.name = 'MetaGraphError';
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.type = opts.type;
    this.fbtraceId = opts.fbtraceId;
    this.httpStatus = opts.httpStatus;
  }
}

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  const normalized = path.startsWith('http')
    ? path
    : `${GRAPH_BASE}/${path.replace(/^\//, '')}`;
  const url = new URL(normalized);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseGraphResponse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    const err = json.error || {};
    throw new MetaGraphError(err.message || `Meta Graph request failed (${res.status})`, {
      code: err.code,
      subcode: err.error_subcode,
      type: err.type,
      fbtraceId: err.fbtrace_id,
      httpStatus: res.status
    });
  }
  return json;
}

export async function graphGet<T>(
  path: string,
  accessToken: string,
  query?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  const url = buildUrl(path, { ...query, access_token: accessToken });
  const res = await fetch(url);
  return parseGraphResponse<T>(res);
}

export async function graphPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = buildUrl(path, { access_token: accessToken });
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  return parseGraphResponse<T>(res);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
