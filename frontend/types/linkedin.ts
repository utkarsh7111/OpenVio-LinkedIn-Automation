export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export type LinkedInProfileType = 'personal' | 'organization';

export type PostTone = 
  | 'professional' 
  | 'thought_leadership' 
  | 'storytelling' 
  | 'educational' 
  | 'promotional';

export interface MediaAttachment {
  id: string;
  url: string;
  type: 'image' | 'video' | 'document';
  name: string;
  size: number; // in bytes
  previewUrl: string;
  file?: File;
  altText?: string;
  title?: string;
  linkedinUrn?: string;
}

export interface LinkedInAccount {
  id: string;
  name: string;
  headline?: string;
  avatarUrl: string;
  profileType: LinkedInProfileType;
  urn: string;
  organizationName?: string;
  isConnected: boolean;
  connectedAt?: string;
  email?: string;
  status?: string;
  mode?: 'LIVE' | 'DEMO' | string;
  expiresAt?: string | null;
  daysUntilExpiry?: number | null;
  expiringSoon?: boolean;
  scopes?: string[];
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  clientName?: string;
  linkedInAccountId?: string;
}

export interface PostMetrics {
  likes: number;
  comments: number;
  reposts: number;
  impressions?: number;
}

export interface LinkedInPost {
  id: string;
  projectId: string;
  content: string;
  media: MediaAttachment[];
  status: PostStatus;
  scheduledTime?: string | null; // ISO 8601 string
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  errorReason?: string | null;
  metrics?: PostMetrics;
}

export interface CreateOrUpdatePostDto {
  id?: string;
  projectId: string;
  content: string;
  mediaIds?: string[];
  media?: MediaAttachment[];
  scheduledTime?: string | null;
  status: PostStatus;
}

export interface AIGenerateRequest {
  topic: string;
  tone?: PostTone | string;
  length?: 'short' | 'medium' | 'long' | string;
  description?: string;
  targetAudience?: string;
  objective?: string;
  keywords?: string[] | string;
  keyPoints?: string;
  callToAction?: string;
  includeHashtags?: boolean;
}

export interface AIGenerateResponse {
  content: string;
  suggestedHashtags: string[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  error?: string | { code?: string; message?: string };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
