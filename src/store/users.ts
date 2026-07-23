import { kv } from "../lib/kv.js";
import { now } from "../lib/clock.js";
import type { StoreUser } from "../lib/models.js";

const USER_PREFIX = "user:";
const ADMINS_KEY = "admins:chat_ids";

function userKey(telegramId: number): string {
  return USER_PREFIX + telegramId;
}

export async function getUser(telegramId: number): Promise<StoreUser | undefined> {
  return kv.get<StoreUser>(userKey(telegramId));
}

export async function upsertUser(
  partial: Partial<StoreUser> & { telegram_id: number; name: string },
): Promise<StoreUser> {
  const existing = await getUser(partial.telegram_id);
  const user: StoreUser = {
    telegram_id: partial.telegram_id,
    name: partial.name || existing?.name || "Customer",
    email: partial.email ?? existing?.email,
    shipping_address: partial.shipping_address ?? existing?.shipping_address,
    updated_at: now(),
  };
  await kv.set(userKey(user.telegram_id), user);
  return user;
}

export async function listAdminChatIds(): Promise<number[]> {
  return (await kv.get<number[]>(ADMINS_KEY)) ?? [];
}

/** Remember an admin chat so new-order alerts can reach them. */
export async function registerAdminChat(chatId: number): Promise<void> {
  const ids = await listAdminChatIds();
  if (!ids.includes(chatId)) {
    ids.push(chatId);
    await kv.set(ADMINS_KEY, ids);
  }
}
