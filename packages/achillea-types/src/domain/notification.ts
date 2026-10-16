import type { NotificationCategory, NotificationType } from "../enums/notification";

export interface NotificationModel {
  id: number;
  title: string;
  message: string;
  type: NotificationType;
  category: NotificationCategory;
  payload: Record<string, unknown> | null;
}
