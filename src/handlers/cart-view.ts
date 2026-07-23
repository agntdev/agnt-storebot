import { Composer } from "grammy";
import type { CartLine, Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { cartTotal, formatMoney } from "../lib/models.js";
import { backMain } from "../lib/ui.js";
import { getProduct, reserveStock, restoreStock } from "../store/products.js";
import {
  createOrder,
  getOrder,
  saveOrder,
  updatePaymentStatus,
} from "../store/orders.js";
import { getUser, upsertUser } from "../store/users.js";
import { notifyOrderConfirmed } from "../services/notify.js";
import {
  createPaymentIntent,
  paymentMode,
  telegramPaymentToken,
} from "../services/payments.js";
import { sendEmail } from "../services/email.js";

registerMainMenuItem({ label: "View Cart", data: "cart:view", order: 20 });

const composer = new Composer<Ctx>();

function ensureCart(ctx: Ctx): CartLine[] {
  if (!ctx.session.cart) ctx.session.cart = [];
  return ctx.session.cart;
}

function cartText(items: CartLine[]): string {
  if (items.length === 0) {
    return "Your cart is empty — tap Browse Products to add something.";
  }
  const lines = items.map(
    (i) =>
      `• ${i.title}${i.variant ? ` (${i.variant})` : ""} × ${i.qty} — ${formatMoney(i.price * i.qty)}`,
  );
  return (
    `Your cart\n\n` +
    lines.join("\n") +
    `\n\nTotal: ${formatMoney(cartTotal(items))}`
  );
}

function cartKeyboard(items: CartLine[]) {
  const rows = [];
  if (items.length > 0) {
    for (const i of items.slice(0, 8)) {
      const label = `Remove ${i.title}`.slice(0, 28);
      const data = i.variant
        ? `cart:rm:${i.sku}:${encodeURIComponent(i.variant).slice(0, 16)}`
        : `cart:rm:${i.sku}`;
      rows.push([inlineButton(label, data)]);
    }
    rows.push([inlineButton("Checkout", "cart:checkout")]);
    rows.push([inlineButton("Clear cart", "cart:clear")]);
  }
  rows.push([inlineButton("Browse Products", "catalog:categories")]);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

composer.callbackQuery("cart:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const items = ensureCart(ctx);
  await ctx.editMessageText(cartText(items), {
    reply_markup: cartKeyboard(items),
  });
});

composer.callbackQuery(/^cart:add:([^:]+)(?::(.+))?$/, async (ctx) => {
  const sku = ctx.match[1] ?? "";
  let variant: string | undefined;
  if (ctx.match[2]) {
    try {
      variant = decodeURIComponent(ctx.match[2]);
    } catch {
      variant = ctx.match[2];
    }
  }
  const product = await getProduct(sku);
  if (!product) {
    await ctx.answerCallbackQuery({ text: "Product unavailable." });
    return;
  }
  if (product.stock <= 0) {
    await ctx.answerCallbackQuery({ text: "Out of stock." });
    return;
  }
  const items = ensureCart(ctx);
  const existing = items.find(
    (i) => i.sku === sku && (i.variant ?? "") === (variant ?? ""),
  );
  const nextQty = (existing?.qty ?? 0) + 1;
  if (nextQty > product.stock) {
    await ctx.answerCallbackQuery({ text: "Not enough stock." });
    return;
  }
  if (existing) existing.qty = nextQty;
  else {
    items.push({
      sku: product.sku,
      title: product.title,
      price: product.price,
      qty: 1,
      variant,
    });
  }
  await ctx.answerCallbackQuery({ text: "Added to cart." });
  await ctx.reply(
    `Added ${product.title}${variant ? ` (${variant})` : ""} to your cart.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("View cart", "cart:view")],
        [inlineButton("Keep browsing", "catalog:categories")],
      ]),
    },
  );
});

composer.callbackQuery(/^cart:rm:([^:]+)(?::(.+))?$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const sku = ctx.match[1] ?? "";
  let variant: string | undefined;
  if (ctx.match[2]) {
    try {
      variant = decodeURIComponent(ctx.match[2]);
    } catch {
      variant = ctx.match[2];
    }
  }
  const items = ensureCart(ctx);
  ctx.session.cart = items.filter(
    (i) => !(i.sku === sku && (i.variant ?? "") === (variant ?? "")),
  );
  const next = ensureCart(ctx);
  await ctx.editMessageText(cartText(next), {
    reply_markup: cartKeyboard(next),
  });
});

composer.callbackQuery("cart:clear", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Cart cleared." });
  ctx.session.cart = [];
  await ctx.editMessageText(cartText([]), {
    reply_markup: cartKeyboard([]),
  });
});

composer.callbackQuery("cart:checkout", async (ctx) => {
  await ctx.answerCallbackQuery();
  const items = ensureCart(ctx);
  if (items.length === 0) {
    await ctx.editMessageText(
      "Your cart is empty — tap Browse Products to add something.",
      { reply_markup: cartKeyboard([]) },
    );
    return;
  }

  // Re-validate stock before creating order
  for (const line of items) {
    const p = await getProduct(line.sku);
    if (!p || p.stock < line.qty) {
      await ctx.editMessageText(
        p
          ? `"${p.title}" only has ${p.stock} left — update your cart and try again.`
          : "An item in your cart is no longer available. Update your cart and try again.",
        { reply_markup: cartKeyboard(items) },
      );
      return;
    }
  }

  const userId = ctx.from?.id;
  if (!userId) return;
  const profile = await getUser(userId);
  if (!profile?.shipping_address) {
    ctx.session.step = "checkout_address";
    await ctx.editMessageText(
      "Where should we ship this?\n\nSend your full shipping address as a single message.",
      {
        reply_markup: inlineKeyboard([[inlineButton("Cancel", "cart:view")]]),
      },
    );
    return;
  }

  await beginCheckout(ctx, profile.shipping_address);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "checkout_address") return next();
  const address = ctx.message.text.trim();
  if (address.length < 5) {
    await ctx.reply("That address looks too short — send the full shipping address.");
    return;
  }
  const userId = ctx.from?.id;
  if (!userId) return;
  await upsertUser({
    telegram_id: userId,
    name:
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
      "Customer",
    shipping_address: address,
  });
  ctx.session.step = "idle";
  await beginCheckout(ctx, address);
});

async function beginCheckout(ctx: Ctx, shippingAddress: string): Promise<void> {
  const items = ensureCart(ctx);
  if (items.length === 0) {
    await ctx.reply("Your cart is empty — tap Browse Products to add something.", {
      reply_markup: backMain(),
    });
    return;
  }

  const reserve = await reserveStock(items.map((i) => ({ sku: i.sku, qty: i.qty })));
  if (!reserve.ok) {
    await ctx.reply(reserve.reason, {
      reply_markup: inlineKeyboard([
        [inlineButton("View cart", "cart:view")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const userId = ctx.from!.id;
  const chatId = ctx.chat!.id;
  const profile = await getUser(userId);
  const name =
    profile?.name ||
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") ||
    "Customer";

  const order = await createOrder({
    user_id: userId,
    chat_id: chatId,
    customer_name: name,
    items: items.map((i) => ({
      sku: i.sku,
      title: i.title,
      price: i.price,
      qty: i.qty,
      variant: i.variant,
    })),
    total: cartTotal(items),
    shipping_address: shippingAddress,
    email: profile?.email,
    payment_status: "pending",
    fulfillment_status: "pending",
  });

  ctx.session.pendingOrderId = order.order_id;
  ctx.session.cart = [];

  const mode = paymentMode();
  if (mode === "telegram") {
    const token = telegramPaymentToken()!;
    try {
      await ctx.replyWithInvoice(
        `Order ${order.order_id}`,
        `Store order ${order.order_id}`,
        order.order_id,
        "USD",
        order.items.map((i) => ({
          label: `${i.title}${i.variant ? ` (${i.variant})` : ""} × ${i.qty}`,
          amount: i.price * i.qty,
        })),
        { provider_token: token },
      );
      await ctx.reply(
        `Invoice sent for order ${order.order_id}. Complete payment in Telegram, or cancel below.`,
        {
          reply_markup: inlineKeyboard([
            [inlineButton("Cancel order", `pay:fail:${order.order_id}`)],
            [inlineButton("My orders", "orders:list")],
          ]),
        },
      );
      return;
    } catch {
      // fall through to manual
    }
  }

  if (mode === "stripe") {
    const intent = await createPaymentIntent({
      amountCents: order.total,
      orderId: order.order_id,
      description: `Order ${order.order_id}`,
    });
    if (intent.ok) {
      order.stripe_payment_intent_id = intent.id;
      await updatePaymentStatus(order.order_id, "pending", {
        stripe_payment_intent_id: intent.id,
      });
      await ctx.reply(
        `Order ${order.order_id} created — total ${formatMoney(order.total)}.\n\n` +
          `Complete payment with your card provider, then tap Confirm payment.`,
        {
          reply_markup: inlineKeyboard([
            [inlineButton("Confirm payment", `pay:ok:${order.order_id}`)],
            [inlineButton("Payment failed", `pay:fail:${order.order_id}`)],
            [inlineButton("My orders", "orders:list")],
          ]),
        },
      );
      return;
    }
  }

  // Manual confirmation path (no gateway configured — still a real order flow)
  await ctx.reply(
    `Order ${order.order_id} is ready — total ${formatMoney(order.total)}.\n\n` +
      `Online payments aren't configured yet. Confirm payment to complete the order, or cancel to release stock.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Confirm payment", `pay:ok:${order.order_id}`)],
        [inlineButton("Cancel order", `pay:fail:${order.order_id}`)],
        [inlineButton("My orders", "orders:list")],
      ]),
    },
  );
}

composer.callbackQuery(/^pay:ok:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = ctx.match[1] ?? "";
  const order = await getOrder(orderId);
  if (!order) {
    await ctx.reply("Couldn't find that order.", { reply_markup: backMain() });
    return;
  }
  if (order.user_id !== ctx.from?.id && !ctx.session.adminAuthed) {
    await ctx.reply("You can't update this order.", { reply_markup: backMain() });
    return;
  }
  if (order.payment_status === "paid") {
    await ctx.reply(`Order ${order.order_id} is already paid.`, {
      reply_markup: backMain(),
    });
    return;
  }
  if (order.payment_status === "failed") {
    await ctx.reply(
      `Order ${order.order_id} was cancelled. Add items to your cart and checkout again.`,
      { reply_markup: backMain() },
    );
    return;
  }

  const updated = await updatePaymentStatus(orderId, "paid");
  if (!updated) return;
  updated.fulfillment_status = "confirmed";
  await saveOrder(updated);

  ctx.session.pendingOrderId = undefined;
  await notifyOrderConfirmed(ctx.api, updated);

  if (updated.email) {
    await sendEmail({
      to: updated.email,
      subject: `Receipt for order ${updated.order_id}`,
      text: `Thanks for your order ${updated.order_id}. Total: ${formatMoney(updated.total)}.`,
    });
  }

  await ctx.reply(
    `Payment confirmed for order ${updated.order_id}.\nTotal: ${formatMoney(updated.total)}.\n\nYou'll get updates as it ships.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("My orders", "orders:list")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery(/^pay:fail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = ctx.match[1] ?? "";
  const order = await getOrder(orderId);
  if (!order) {
    await ctx.reply("Couldn't find that order.", { reply_markup: backMain() });
    return;
  }
  if (order.user_id !== ctx.from?.id && !ctx.session.adminAuthed) {
    await ctx.reply("You can't update this order.", { reply_markup: backMain() });
    return;
  }
  if (order.payment_status === "paid") {
    await ctx.reply("This order is already paid — contact the store if you need help.", {
      reply_markup: backMain(),
    });
    return;
  }
  if (order.payment_status === "failed") {
    await ctx.reply(`Order ${order.order_id} is already cancelled.`, {
      reply_markup: backMain(),
    });
    return;
  }

  await restoreStock(order.items.map((i) => ({ sku: i.sku, qty: i.qty })));
  order.payment_status = "failed";
  order.fulfillment_status = "cancelled";
  await saveOrder(order);
  ctx.session.pendingOrderId = undefined;

  await ctx.reply(
    `Payment didn't go through for order ${order.order_id}. Stock is released — you can checkout again when ready.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("View cart", "cart:view")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

// Telegram Payments: answer pre-checkout and handle successful_payment
composer.on("pre_checkout_query", async (ctx) => {
  const orderId = ctx.preCheckoutQuery.invoice_payload;
  const order = await getOrder(orderId);
  if (!order || order.payment_status !== "pending") {
    await ctx.answerPreCheckoutQuery(false, {
      error_message: "This order is no longer available for payment.",
    });
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
});

composer.on("message:successful_payment", async (ctx) => {
  const sp = ctx.message.successful_payment;
  const orderId = sp.invoice_payload;
  const order = await getOrder(orderId);
  if (!order) return;
  if (order.payment_status === "paid") return;

  const updated = await updatePaymentStatus(orderId, "paid");
  if (!updated) return;
  updated.fulfillment_status = "confirmed";
  await saveOrder(updated);
  ctx.session.pendingOrderId = undefined;
  await notifyOrderConfirmed(ctx.api, updated);
  await ctx.reply(
    `Payment received for order ${updated.order_id}. Total: ${formatMoney(updated.total)}.`,
    { reply_markup: backMain() },
  );
});

export default composer;
