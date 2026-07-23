import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { formatMoney } from "../lib/models.js";
import { backMain } from "../lib/ui.js";
import { getOrder, listUserOrders } from "../store/orders.js";

registerMainMenuItem({ label: "My Orders", data: "orders:list", order: 30 });

const composer = new Composer<Ctx>();

function statusLabel(payment: string, fulfillment: string): string {
  if (payment === "failed") return "cancelled";
  if (payment === "pending") return "awaiting payment";
  return fulfillment;
}

composer.callbackQuery("orders:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;
  const orders = await listUserOrders(userId);
  if (orders.length === 0) {
    await ctx.editMessageText(
      "No orders yet — browse products and checkout when you're ready.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Browse Products", "catalog:categories")],
          [inlineButton("Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const lines = orders.slice(0, 15).map((o) => {
    const st = statusLabel(o.payment_status, o.fulfillment_status);
    return `• ${o.order_id} — ${formatMoney(o.total)} · ${st}`;
  });
  const rows = orders.slice(0, 10).map((o) => [
    inlineButton(`Order ${o.order_id}`.slice(0, 28), `orders:v:${o.order_id}`),
  ]);
  rows.push([inlineButton("Back to menu", "menu:main")]);

  await ctx.editMessageText(`Your orders\n\n${lines.join("\n")}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^orders:v:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = ctx.match[1] ?? "";
  const order = await getOrder(orderId);
  if (!order || order.user_id !== ctx.from?.id) {
    await ctx.editMessageText("Couldn't find that order.", {
      reply_markup: backMain(),
    });
    return;
  }
  const items = order.items
    .map(
      (i) =>
        `• ${i.title}${i.variant ? ` (${i.variant})` : ""} × ${i.qty} — ${formatMoney(i.price * i.qty)}`,
    )
    .join("\n");
  const text =
    `Order ${order.order_id}\n\n` +
    items +
    `\n\nTotal: ${formatMoney(order.total)}\n` +
    `Payment: ${order.payment_status}\n` +
    `Fulfillment: ${order.fulfillment_status}` +
    (order.shipping_address ? `\nShip to: ${order.shipping_address}` : "");

  const rows = [];
  if (order.payment_status === "pending") {
    rows.push([inlineButton("Confirm payment", `pay:ok:${order.order_id}`)]);
    rows.push([inlineButton("Cancel order", `pay:fail:${order.order_id}`)]);
  }
  rows.push([inlineButton("All orders", "orders:list")]);
  rows.push([inlineButton("Back to menu", "menu:main")]);

  await ctx.editMessageText(text, { reply_markup: inlineKeyboard(rows) });
});

export default composer;
