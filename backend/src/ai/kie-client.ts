import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

const KIE_API_BASE = 'https://api.kie.ai';
const KIE_FILE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
export const MAX_REFERENCE_IMAGES = 8;

const KIE_API_KEYS = [
  '542eda869f5c55c1852e7bb6b4030cab',
  'e27641ab87af37c6e394e0f48128ad8c',
];

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_TIME_MS = 10 * 60 * 1000; // 10 minutes

interface KieCreateTaskResponse {
  code: number;
  msg: string;
  data: { taskId: string };
}

interface KieTaskDetailResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    model: string;
    state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
    costTime?: number;
  };
}

export interface KieImageResult {
  imageUrl: string;
  imageDataUrl: string;
}

function normalizeImageDataUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}

function extensionFromDataUrl(dataUrl: string): 'png' | 'jpg' | 'webp' {
  if (dataUrl.startsWith('data:image/png')) return 'png';
  if (dataUrl.startsWith('data:image/webp')) return 'webp';
  return 'jpg';
}

interface KieFileUploadResponse {
  success?: boolean;
  code?: number;
  msg?: string;
  data?: {
    fileUrl?: string;
    downloadUrl?: string;
  };
}

async function uploadReferenceImage(
  apiKey: string,
  dataUrl: string,
  index: number
): Promise<string> {
  const normalized = normalizeImageDataUrl(dataUrl);
  const res = await fetch(KIE_FILE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Data: normalized,
      uploadPath: 'xobot-refs',
      fileName: `ref-${randomUUID()}-${index}.${extensionFromDataUrl(normalized)}`,
    }),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Kie.ai file upload HTTP ${res.status}: ${text}`);
  }

  let json: KieFileUploadResponse;
  try {
    json = JSON.parse(text || '{}') as KieFileUploadResponse;
  } catch {
    throw new Error(`Kie.ai file upload invalid JSON: ${text.slice(0, 200)}`);
  }
  const fileUrl = json.data?.fileUrl || json.data?.downloadUrl;
  if (!fileUrl) {
    throw new Error(`Kie.ai file upload missing URL: ${json.msg || text}`);
  }
  return fileUrl;
}

async function uploadReferenceImages(
  apiKey: string,
  images: string[]
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < images.length; i++) {
    urls.push(await uploadReferenceImage(apiKey, images[i], i));
  }
  return urls;
}

async function createTask(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  resolution: string,
  imageInput: string[] = []
): Promise<KieCreateTaskResponse> {
  const res = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'nano-banana-pro',
      input: {
        prompt,
        aspect_ratio: aspectRatio,
        resolution,
        output_format: 'png',
        ...(imageInput.length > 0 ? { image_input: imageInput } : {}),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kie.ai createTask HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as KieCreateTaskResponse;
  if (json.code !== 200) {
    throw new Error(`Kie.ai createTask error ${json.code}: ${json.msg}`);
  }
  return json;
}

async function pollTask(
  apiKey: string,
  taskId: string
): Promise<KieTaskDetailResponse['data']> {
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_TIME_MS) {
    const res = await fetch(
      `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Kie.ai recordInfo HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as KieTaskDetailResponse;
    if (json.code !== 200) {
      throw new Error(`Kie.ai recordInfo error ${json.code}: ${json.msg}`);
    }

    const { state } = json.data;

    if (state === 'success') return json.data;
    if (state === 'fail') {
      throw new Error(
        `Kie.ai task failed: ${json.data.failMsg || json.data.failCode || 'unknown'}`
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Kie.ai task timed out after 10 minutes');
}

async function downloadImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download generated image: HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapAspectRatio(
  aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
): string {
  return aspect;
}

function mapResolution(size: '1K' | '2K' | '4K'): string {
  return size;
}

/**
 * Generate an image via kie.ai nano-banana-pro.
 * Tries each API key in order; falls back to the next key on auth/quota errors.
 */
export async function generateImageWithKie(
  prompt: string,
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' = '1:1',
  imageSize: '1K' | '2K' | '4K' = '1K',
  referenceImages: string[] = []
): Promise<KieImageResult> {
  const kieAspect = mapAspectRatio(aspectRatio);
  const kieResolution = mapResolution(imageSize);
  const refs = referenceImages.slice(0, MAX_REFERENCE_IMAGES);
  const errors: string[] = [];

  for (let i = 0; i < KIE_API_KEYS.length; i++) {
    const apiKey = KIE_API_KEYS[i];
    const keyLabel = `Key#${i + 1}`;

    try {
      logger.info(`Kie.ai: creating task with ${keyLabel}`, {
        aspectRatio: kieAspect,
        resolution: kieResolution,
        referenceCount: refs.length
      });

      const imageInput = refs.length > 0 ? await uploadReferenceImages(apiKey, refs) : [];
      const createRes = await createTask(apiKey, prompt, kieAspect, kieResolution, imageInput);
      const taskId = createRes.data.taskId;

      logger.info(`Kie.ai: task created, polling`, { taskId, keyLabel });

      const result = await pollTask(apiKey, taskId);

      if (!result.resultJson) {
        throw new Error('resultJson is empty in successful task');
      }

      const parsed = JSON.parse(result.resultJson) as { resultUrls?: string[] };
      const imageUrl = parsed.resultUrls?.[0];
      if (!imageUrl) {
        throw new Error('No resultUrls in task result');
      }

      logger.info(`Kie.ai: downloading image`, { taskId, costTime: result.costTime });
      const imageDataUrl = await downloadImageAsBase64(imageUrl);

      return { imageUrl, imageDataUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${keyLabel}: ${msg}`);
      logger.warn(`Kie.ai ${keyLabel} failed, ${i < KIE_API_KEYS.length - 1 ? 'trying next key' : 'no more keys'}`, {
        error: msg,
      });
    }
  }

  throw new Error(`All Kie.ai API keys failed:\n${errors.join('\n')}`);
}
