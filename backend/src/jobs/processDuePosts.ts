import { env, type EnvConfig } from '../config/env.js';
import { postData, type PostData } from '../db/post.data.js';
import { postService, type PostService } from '../services/post.service.js';
import { notifyAdapter, type NotifyAdapter } from '../adapters/notify.js';

const safeMissedMessage = 'This scheduled post missed its publishing window.';

export interface ProcessDuePostsOptions {
  data?: PostData | any;
  posts?: PostService | any;
  notify?: NotifyAdapter | any;
  config?: EnvConfig;
  clock?: () => Date;
  logger?: { info: (...args: any[]) => void };
}

export interface ProcessDuePostsResult {
  claimed: number;
  published: number;
  recovered: number;
}

/** Claim and process scheduled work; OpenVio replaces this runner with its job platform. */
export function createProcessDuePosts({
  data = postData,
  posts = postService,
  notify = notifyAdapter,
  config = env,
  clock = () => new Date(),
  logger = console,
}: ProcessDuePostsOptions = {}): () => Promise<ProcessDuePostsResult> {
  return async function processDuePosts(): Promise<ProcessDuePostsResult> {
    const now = clock();
    const rows = await data.claimDuePosts({ now, limit: config.schedulerBatchSize });
    let published = 0;
    for (const row of rows) {
      const started = clock().getTime();
      let outcome = 'FAILED';
      try {
        const overdueBy = now.getTime() - new Date(row.scheduledAt).getTime();
        if (overdueBy > config.missedWindowHours * 3_600_000) {
          await data.setFailed({ id: row.id, projectId: row.projectId, code: 'MISSED_WINDOW', message: safeMissedMessage, actorUserId: null });
          await notify.notify({ postId: row.id, type: 'POST_FAILED', message: safeMissedMessage });
          outcome = 'MISSED_WINDOW';
        } else {
          const result = await posts.publishClaimed(row.id, row.projectId, row);
          outcome = result?.outcome ?? 'PUBLISHED';
          if (outcome === 'PUBLISHED') published += 1;
        }
      } catch (error: any) {
        outcome = error?.code === 'RECONNECT_REQUIRED' ? 'RECONNECT_REQUIRED' : 'FAILED';
        try {
          await data.setFailed({
            id: row.id,
            projectId: row.projectId,
            code: outcome === 'RECONNECT_REQUIRED' ? outcome : 'LINKEDIN_UNAVAILABLE',
            message: outcome === 'RECONNECT_REQUIRED' ? 'Your LinkedIn connection expired. Reconnect LinkedIn.' : 'LinkedIn is not responding. Try again in a few minutes.',
            actorUserId: null,
          });
          await notify.notify({
            postId: row.id,
            type: 'POST_FAILED',
            message: outcome === 'RECONNECT_REQUIRED' ? 'Your LinkedIn connection expired. Reconnect LinkedIn.' : 'LinkedIn is not responding. Try again in a few minutes.',
          });
        } catch {
          /* Keep processing the rest of the claimed batch. */
        }
      } finally {
        logger.info(JSON.stringify({ postId: row.id, projectId: row.projectId, outcome, durationMs: Math.max(0, clock().getTime() - started) }));
      }
    }

    const recovered = await data.recoverStuckPublishing({
      cutoff: new Date(now.getTime() - config.stuckPublishingMinutes * 60_000),
      now,
      retryLimit: 3,
      limit: config.schedulerBatchSize,
    });
    for (const row of recovered) {
      if (row.outcome === 'FAILED') {
        await notify.notify({ postId: row.id, type: 'POST_FAILED', message: 'LinkedIn is not responding. Try again in a few minutes.' });
      }
      logger.info(JSON.stringify({ postId: row.id, projectId: row.projectId, outcome: row.outcome, durationMs: 0 }));
    }
    return { claimed: rows.length, published, recovered: recovered.length };
  };
}

export const processDuePosts = createProcessDuePosts();
