import type { Api, Bot } from "grammy";
import type { Order, Product } from "../lib/models.js";
import { formatMoney } from "../lib/models.js";
import { recordNotification } from "../store/notifications.js";
import { listAdminChatIds } from "../store/users.js";
import { listProductSubscribers } from "../store/subscriptions.js";

/** Send a DM; tolerate 403 (blocked / never started) without throwing. */
export async function safeSend(
  api: Api,
  chatId: number,
  text: string,
): Promise<boolean> {
  try {
    await api.sendMessage(chatId, text);
    return true;
  } catch {
    return false;
  }
}

export function orderConfirmationText(order: Order): string {
  const lines = order.items.map(
    (i) => `• ${i.title}${i.variant ? ` (${i.variant})` : ""} × ${i.qty} — ${formatMoney(i.price * i.qty)}`,
  );
  return (
    `Order confirmed — ${order.order_id}\n\n` +
    lines.join("\n") +
    `\n\nTotal: ${formatMoney(order.total)}\n` +
    `Payment: ${order.payment_status}\n` +
    `Status: ${order.fulfillment_status}\n\n` +
    `We'll notify you when it ships.`
  );
}

export function adminNewOrderText(order: Order): string {
  return (
    `New order ${order.order_id}\n` +
    `Customer: ${order.customer_name}\n` +
    `Total: ${formatMoney(order.total)}\n` +
    `Items: ${order.items.map((i) => `${i.title}×${i.qty}`).join(", ")}\n` +
    `Payment: ${order.payment_status}`
  );
}

export function shippingUpdateText(order: Order): string {
  const labels: Record<string, string> = {
    pending: "received",
    confirmed: "confirmed",
    shipped: "shipped",
    delivered: "delivered",
    cancelled: "cancelled",
  };
  const label = labels[order.fulfillment_status] ?? order.fulfillment_status;
  return (
    `Order ${order.order_id} update\n\n` +
    `Your order is now ${label}.\n` +
    `Payment: ${order.payment_status}`
  );
}

export async function notifyOrderConfirmed(
  api: Api,
  order: Order,
): Promise<void> {
  const text = orderConfirmationText(order);
  await recordNotification({
    type: "order_confirmation",
    recipient: order.user_id,
    content: text,
  });
  await safeSend(api, order.chat_id, text);

  const adminText = adminNewOrderText(order);
  const admins = await listAdminChatIds();
  for (const adminId of admins) {
    if (adminId === order.chat_id) continue;
    await recordNotification({
      type: "admin_new_order",
      recipient: adminId,
      content: adminText,
    });
    await safeSend(api, adminId, adminText);
  }
}

export async function notifyShippingUpdate(
  api: Api,
  order: Order,
): Promise<void> {
  const text = shippingUpdateText(order);
  await recordNotification({
    type: "shipping_update",
    recipient: order.user_id,
    content: text,
  });
  await safeSend(api, order.chat_id, text);
}

export async function notifyRestock(
  api: Api,
  product: Product,
): Promise<void> {
  const subscribers = await listProductSubscribers(product.sku);
  const text =
    `${product.title} is back in stock (${product.stock} available).\n` +
    `Price: ${formatMoney(product.price)}\n` +
    `Tap Browse Products to order.`;
  for (const userId of subscribers) {
    await recordNotification({
      type: "restock",
      recipient: userId,
      content: text,
    });
    await safeSend(api, userId, text);
  }
}

export async function broadcastMessage(
  api: Api,
  recipientIds: number[],
  content: string,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const id of recipientIds) {
    await recordNotification({
      type: "broadcast",
      recipient: id,
      content,
    });
    const ok = await safeSend(api, id, content);
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Helper for bots that only have Bot instance. */
export function apiOf(bot: Bot): Api {
  return bot.api;
}
