import { kv } from "../lib/kv.js";
import { now } from "../lib/clock.js";
import { newNotifId } from "../lib/ids.js";
import type { Notification, NotificationType } from "../lib/models.js";

const NOTIF_PREFIX = "notif:";
const RECIPIENT_PREFIX = "notifs:user:";

function notifKey(id: string): string {
  return NOTIF_PREFIX + id;
}

function recipientKey(userId: number): string {
  return RECIPIENT_PREFIX + userId;
}

export async function recordNotification(input: {
  type: NotificationType;
  recipient: number;
  content: string;
}): Promise<Notification> {
  const n: Notification = {
    id: newNotifId(),
    type: input.type,
    recipient: input.recipient,
    content: input.content,
    timestamp: now(),
  };
  await kv.set(notifKey(n.id), n);
  const ids = (await kv.get<string[]>(recipientKey(n.recipient))) ?? [];
  ids.unshift(n.id);
  // Cap index length to keep records bounded
  await kv.set(recipientKey(n.recipient), ids.slice(0, 100));
  return n;
}
