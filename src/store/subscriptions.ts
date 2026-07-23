import { kv } from "../lib/kv.js";
import { now } from "../lib/clock.js";
import type { SubNotificationType, Subscription } from "../lib/models.js";

const SUB_PREFIX = "sub:";
const USER_PREFIX = "subs:user:";
const PRODUCT_PREFIX = "subs:product:";

function subKey(userId: number, sku: string): string {
  return `${SUB_PREFIX}${userId}:${sku}`;
}

function userKey(userId: number): string {
  return USER_PREFIX + userId;
}

function productKey(sku: string): string {
  return PRODUCT_PREFIX + sku;
}

export async function getSubscription(
  userId: number,
  sku: string,
): Promise<Subscription | undefined> {
  return kv.get<Subscription>(subKey(userId, sku));
}

export async function subscribe(
  userId: number,
  sku: string,
  notification_type: SubNotificationType = "restock",
): Promise<Subscription> {
  const existing = await getSubscription(userId, sku);
  if (existing) return existing;

  const sub: Subscription = {
    user_id: userId,
    product_sku: sku,
    notification_type,
    created_at: now(),
  };
  await kv.set(subKey(userId, sku), sub);

  const userSubs = (await kv.get<string[]>(userKey(userId))) ?? [];
  if (!userSubs.includes(sku)) {
    userSubs.push(sku);
    await kv.set(userKey(userId), userSubs);
  }

  const productSubs = (await kv.get<number[]>(productKey(sku))) ?? [];
  if (!productSubs.includes(userId)) {
    productSubs.push(userId);
    await kv.set(productKey(sku), productSubs);
  }

  return sub;
}

export async function unsubscribe(userId: number, sku: string): Promise<boolean> {
  const existing = await getSubscription(userId, sku);
  if (!existing) return false;
  await kv.delete(subKey(userId, sku));

  const userSubs = (await kv.get<string[]>(userKey(userId))) ?? [];
  await kv.set(
    userKey(userId),
    userSubs.filter((s) => s !== sku),
  );

  const productSubs = (await kv.get<number[]>(productKey(sku))) ?? [];
  await kv.set(
    productKey(sku),
    productSubs.filter((id) => id !== userId),
  );

  return true;
}

export async function listUserSubscriptions(userId: number): Promise<Subscription[]> {
  const skus = (await kv.get<string[]>(userKey(userId))) ?? [];
  const out: Subscription[] = [];
  for (const sku of skus) {
    const s = await getSubscription(userId, sku);
    if (s) out.push(s);
  }
  return out;
}

export async function listProductSubscribers(sku: string): Promise<number[]> {
  return (await kv.get<number[]>(productKey(sku))) ?? [];
}
