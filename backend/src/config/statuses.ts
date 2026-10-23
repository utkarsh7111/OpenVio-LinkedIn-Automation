export const POST_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
} as const);

export type PostStatusType = (typeof POST_STATUS)[keyof typeof POST_STATUS];
export type PostStatus = PostStatusType;

const transitions = new Map<string, Set<string>>([
  ['DRAFT', new Set(['SCHEDULED', 'PUBLISHING'])],
  ['SCHEDULED', new Set(['DRAFT', 'SCHEDULED', 'PUBLISHING'])],
  ['FAILED', new Set(['DRAFT', 'SCHEDULED', 'PUBLISHING'])],
  ['PUBLISHING', new Set(['PUBLISHED', 'FAILED', 'SCHEDULED'])],
  ['PUBLISHED', new Set()],
]);

/** True only for status changes specified for the post lifecycle. */
export function canTransition(from: string, to: string): boolean {
  return transitions.get(from)?.has(to) ?? false;
}
