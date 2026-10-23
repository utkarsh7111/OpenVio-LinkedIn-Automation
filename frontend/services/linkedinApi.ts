import {
  Project,
  LinkedInAccount,
  LinkedInPost,
  CreateOrUpdatePostDto,
  AIGenerateRequest,
  AIGenerateResponse,
  ApiResponse,
  MediaAttachment,
} from '@/types/linkedin';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000011';
const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID || DEMO_USER_ID;

type BackendPost = {
  id: string;
  projectId: string;
  content: string;
  media?: Array<{
    url: string;
    altText?: string;
    type?: 'image' | 'video' | 'document';
    title?: string;
    name?: string;
    sizeBytes?: number;
    linkedinUrn?: string;
    linkedinImageUrn?: string;
  }>;
  status: string;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
  errorCode?: string | null;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (process.env.NODE_ENV !== 'production' && DEV_USER_ID) headers.set('x-dev-user-id', DEV_USER_ID);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !body?.success) {
    let message = 'Request failed';
    const rawError = body?.error;
    if (rawError && typeof rawError === 'object') {
      const err = rawError as { code?: string; message?: string; fields?: string[] | Record<string, string> };
      if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.fields) && err.fields.length > 0) {
        const details = err.fields.map((f) => {
          if (f === 'content') return 'Post commentary text cannot be empty';
          if (f.startsWith('media')) return 'Media attachment is invalid';
          if (f === 'scheduledAt') return 'Scheduled date & time must be at least 5 minutes in the future';
          if (f === 'projectId') return 'Valid Project ID is required';
          return `${f} is invalid`;
        }).join(', ');
        message = details;
      } else {
        message = err.message || `Request failed (${response.status})`;
      }
    } else if (typeof rawError === 'string') {
      message = rawError;
    } else {
      message = `Request failed (${response.status})`;
    }
    const errObj = new Error(message);
    if (rawError && typeof rawError === 'object') {
      Object.assign(errObj, rawError);
    }
    throw errObj;
  }
  return body.data;
}

function mapStatus(status: string): LinkedInPost['status'] {
  switch (status.toUpperCase()) {
    case 'PUBLISHED': return 'published';
    case 'SCHEDULED': return 'scheduled';
    case 'PUBLISHING': return 'publishing';
    case 'FAILED': return 'failed';
    default: return 'draft';
  }
}

function mapPost(post: BackendPost): LinkedInPost {
  const media: MediaAttachment[] = (post.media ?? []).map((item, index) => {
    let resolvedUrl = item.url || '';
    if (resolvedUrl.startsWith('/') && !resolvedUrl.startsWith('//')) {
      resolvedUrl = `${API_BASE_URL}${resolvedUrl}`;
    }
    let detectedType: 'image' | 'video' | 'document' = item.type || 'image';
    if (!item.type) {
      if (/\.(mp4|mov|webm|avi)$/i.test(resolvedUrl)) detectedType = 'video';
      else if (/\.(pdf|doc|docx|ppt|pptx)$/i.test(resolvedUrl)) detectedType = 'document';
    }
    return {
      id: `saved-${post.id}-${index}`,
      url: resolvedUrl,
      previewUrl: resolvedUrl,
      type: detectedType,
      name: item.name || (item.url || '').split('/').pop() || 'LinkedIn attachment',
      size: item.sizeBytes ?? 0,
      altText: item.altText,
      title: item.title,
      linkedinUrn: item.linkedinUrn || item.linkedinImageUrn,
    };
  });
  return {
    id: post.id,
    projectId: post.projectId,
    content: post.content,
    media,
    status: mapStatus(post.status),
    scheduledTime: post.scheduledAt ?? null,
    publishedAt: post.publishedAt ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    errorReason: post.errorMessage ?? post.errorCode ?? null,
  };
}

async function uploadMedia(projectId: string, media: MediaAttachment[]): Promise<Array<{
  url: string;
  altText?: string;
  title?: string;
  type?: 'image' | 'video' | 'document';
  name?: string;
  sizeBytes?: number;
}>> {
  if (media.length > 20) throw new Error('Maximum of 20 media items allowed per LinkedIn post.');
  if (media.length > 1 && media.some((item) => item.type !== 'image')) {
    throw new Error('Multiple attachments are only supported for images.');
  }
  const result: Array<{ url: string; altText?: string; title?: string; type?: 'image' | 'video' | 'document'; name?: string; sizeBytes?: number }> = [];
  for (const item of media) {
    if (item.file) {
      try {
        const form = new FormData();
        form.append('projectId', projectId);
        if (item.altText) form.append('altText', item.altText.slice(0, 300));
        else if (item.type === 'image') form.append('altText', item.name.slice(0, 300));
        if (item.title) form.append('title', item.title.slice(0, 400));
        form.append('type', item.type);
        form.append('file', item.file, item.file.name);
        const uploaded = await request<{ url: string; altText?: string; title?: string; type?: string; sizeBytes?: number }>('/api/linkedin/media', { method: 'POST', body: form });
        result.push({
          url: uploaded.url,
          altText: uploaded.altText || item.altText,
          title: uploaded.title || item.title,
          type: item.type,
          name: item.name,
          sizeBytes: uploaded.sizeBytes || item.size,
        });
      } catch (err) {
        throw new Error(`Upload failed for "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (item.url.startsWith('http://') || item.url.startsWith('https://') || item.url.startsWith('/uploads/')) {
      result.push({
        url: item.url,
        altText: item.altText,
        title: item.title,
        type: item.type,
        name: item.name,
        sizeBytes: item.size,
      });
    } else {
      throw new Error(`Please reselect "${item.name}" before saving; the temporary preview URL cannot be stored.`);
    }
  }
  return result;
}

export const linkedinApi = {
  async getProjects(): Promise<Project[]> {
    return request<Project[]>('/api/projects');
  },

  async getAccountStatus(projectId: string): Promise<LinkedInAccount | null> {
    const account = await request<{
      status: string; displayName?: string | null; pictureUrl?: string | null; expiresAt?: string | null;
      daysUntilExpiry?: number | null; expiringSoon?: boolean; scopes?: string[]; mode?: string;
    }>(`/api/linkedin/connection?projectId=${encodeURIComponent(projectId)}`);
    if (account.status === 'NOT_CONNECTED' || account.status === 'REVOKED') return null;
    const isMock = account.mode === 'DEMO';
    let headline = isMock ? 'LinkedIn Development Mock Connection' : 'LinkedIn Personal Profile';
    if (account.status === 'EXPIRED') {
      headline = 'Connection expired — Reconnection required';
    } else if (account.expiringSoon && account.daysUntilExpiry !== null && account.daysUntilExpiry !== undefined) {
      headline = `Connection expiring in ${account.daysUntilExpiry} ${account.daysUntilExpiry === 1 ? 'day' : 'days'}`;
    }
    return {
      id: `${projectId}-linkedin`,
      name: account.displayName || (isMock ? 'OpenVio Mock Member' : 'Connected Member'),
      headline,
      avatarUrl: account.pictureUrl || '',
      profileType: 'personal',
      urn: '',
      isConnected: account.status === 'ACTIVE' || account.status === 'EXPIRED',
      connectedAt: undefined,
      email: account.status === 'EXPIRED' ? 'Reconnect required' : undefined,
      status: account.status,
      mode: account.mode,
      expiresAt: account.expiresAt ?? null,
      daysUntilExpiry: account.daysUntilExpiry ?? null,
      expiringSoon: account.expiringSoon,
      scopes: account.scopes,
    };
  },

  async getOAuthUrl(projectId: string): Promise<string> {
    const result = await request<{ authorizationUrl: string }>(`/api/linkedin/connect?projectId=${encodeURIComponent(projectId)}`);
    return result.authorizationUrl;
  },

  async disconnectAccount(projectId: string): Promise<void> {
    await request(`/api/linkedin/connection?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  },

  async getPosts(projectId: string): Promise<LinkedInPost[]> {
    const result = await request<{ items: BackendPost[] }>(`/api/linkedin/posts?projectId=${encodeURIComponent(projectId)}&page=1&limit=50`);
    return result.items.map(mapPost);
  },

  async createPost(payload: CreateOrUpdatePostDto): Promise<LinkedInPost> {
    const media = await uploadMedia(payload.projectId, payload.media ?? []);
    const data = await request<BackendPost>('/api/linkedin/posts', {
      method: 'POST',
      body: JSON.stringify({
        projectId: payload.projectId,
        content: payload.content,
        media,
        scheduledAt: payload.status === 'scheduled' && payload.scheduledTime ? new Date(payload.scheduledTime).toISOString() : undefined,
        aiGenerated: false,
      }),
    });
    return mapPost(data);
  },

  async updatePost(id: string, payload: Partial<CreateOrUpdatePostDto>): Promise<LinkedInPost> {
    if (!payload.projectId) throw new Error('Project ID is required to update a post.');
    const body: Record<string, unknown> = {};
    if (payload.content !== undefined) body.content = payload.content;
    // A PUBLISHED LinkedIn post only allows updating its commentary; never send media or scheduledAt.
    if (payload.status !== 'published') {
      if (payload.media !== undefined) body.media = await uploadMedia(payload.projectId, payload.media);
      if (payload.status === 'scheduled' && payload.scheduledTime) body.scheduledAt = new Date(payload.scheduledTime).toISOString();
    }
    const data = await request<BackendPost>(`/api/linkedin/posts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
    return mapPost(data);
  },

  async publishPost(id: string): Promise<LinkedInPost> {
    return mapPost(await request<BackendPost>(`/api/linkedin/posts/${encodeURIComponent(id)}/publish`, { method: 'POST', body: '{}' }));
  },

  async schedulePost(id: string, scheduledTime: string): Promise<LinkedInPost> {
    return mapPost(await request<BackendPost>(`/api/linkedin/posts/${encodeURIComponent(id)}/schedule`, {
      method: 'POST', body: JSON.stringify({ scheduledAt: new Date(scheduledTime).toISOString() }),
    }));
  },

  async unschedulePost(id: string): Promise<LinkedInPost> {
    return mapPost(await request<BackendPost>(`/api/linkedin/posts/${encodeURIComponent(id)}/unschedule`, { method: 'POST', body: '{}' }));
  },

  async deletePost(id: string): Promise<void> {
    await request(`/api/linkedin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async generateWithAI(payload: AIGenerateRequest, projectId?: string): Promise<AIGenerateResponse> {
    if (!projectId) throw new Error('Select a project before generating content.');
    const tone = payload.tone === 'thought_leadership' ? 'thought-leadership'
      : payload.tone === 'promotional' ? 'announcement'
      : payload.tone === 'storytelling' ? 'friendly'
      : payload.tone === 'educational' ? 'friendly'
      : (payload.tone || 'professional');
    const data = await request<{ text?: string; content?: string; mock?: boolean }>('/api/linkedin/ai/generate', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        topic: payload.topic,
        tone,
        length: payload.length || 'medium',
        description: payload.description,
        targetAudience: payload.targetAudience,
        objective: payload.objective,
        keywords: payload.keywords,
        callToAction: payload.callToAction,
        keyPoints: payload.keyPoints,
        includeHashtags: payload.includeHashtags,
      }),
    });
    const content = data.content ?? data.text;
    if (!content) throw new Error('AI service returned an empty response.');
    return { content, suggestedHashtags: [] };
  },
};
