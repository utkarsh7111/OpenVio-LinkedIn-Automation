import { pool } from '../db/pool.js';

export interface NotificationPayload {
  postId?: string | null;
  type: string;
  message: string;
}

export interface NotificationRecord {
  id: string;
  postId: string | null;
  type: string;
  message: string;
  createdAt: string;
}

export interface NotifyAdapter {
  notify(payload: NotificationPayload): Promise<NotificationRecord>;
}

/** OpenVio replaces this database notification log with email or in-app delivery. */
export function createNotifyAdapter(database: any = pool): NotifyAdapter {
  return Object.freeze({
    async notify({ postId = null, type, message }: NotificationPayload): Promise<NotificationRecord> {
      const safeMessage = String(message).slice(0, 2000);
      const { rows } = await database.query(
        'INSERT INTO notifications_log (post_id, type, message) VALUES ($1, $2, $3) RETURNING id, post_id AS "postId", type, message, created_at AS "createdAt"',
        [postId, type, safeMessage],
      );
      return rows[0];
    },
  });
}

export const notifyAdapter = createNotifyAdapter();
