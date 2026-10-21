import { apiClient } from './client';

export type NotificationKind = 'PROJECT_CREATED' | 'PROJECT_RECEIVED' | 'PROJECT_READY'
  | 'REPORT_PENDING' | 'REPORT_RETURNED' | 'PROPOSAL_RECEIVED';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: AppNotification[];
  unreadCount: number;
  snapshotAt: string;
  nextCursor: string | null;
}

export async function listNotifications(filter: 'all' | 'unread', cursor?: string, signal?: AbortSignal) {
  return (await apiClient.get<NotificationPage>('/notifications', { params: { filter, cursor }, signal })).data;
}

export async function markNotificationRead(id: string) {
  await apiClient.post(`/notifications/${encodeURIComponent(id)}/read`);
}

export async function markAllNotificationsRead(before: string) {
  await apiClient.post('/notifications/read-all', { before });
}
