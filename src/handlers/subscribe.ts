import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getProduct, listProducts } from "../store/products.js";
import {
  listUserSubscriptions,
  subscribe,
  unsubscribe,
} from "../store/subscriptions.js";

registerMainMenuItem({ label: "Alerts", data: "sub:menu", order: 40 });

const composer = new Composer<Ctx>();

composer.callbackQuery("sub:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;
  const subs = await listUserSubscriptions(userId);
  if (subs.length === 0) {
    await ctx.editMessageText(
      "No product alerts yet.\n\n" +
        "Open a product that's out of stock and tap Alert me when restocked — or pick a product below.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Pick a product", "sub:pick")],
          [inlineButton("Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const lines: string[] = [];
  const rows = [];
  for (const s of subs) {
    const p = await getProduct(s.product_sku);
    const title = p?.title ?? s.product_sku;
    lines.push(`• ${title} (${s.notification_type})`);
    rows.push([
      inlineButton(`Remove ${title}`.slice(0, 28), `sub:off:${s.product_sku}`),
    ]);
  }
  rows.push([inlineButton("Add alert", "sub:pick")]);
  rows.push([inlineButton("Back to menu", "menu:main")]);

  await ctx.editMessageText(
    `Your alerts\n\n${lines.join("\n")}\n\nWe'll message you when subscribed items restock.`,
    { reply_markup: inlineKeyboard(rows) },
  );
});

composer.callbackQuery("sub:pick", async (ctx) => {
  await ctx.answerCallbackQuery();
  const products = await listProducts();
  if (products.length === 0) {
    await ctx.editMessageText(
      "No products to follow yet — check back when the catalog is ready.",
      {
        reply_markup: inlineKeyboard([[inlineButton("Back", "sub:menu")]]),
      },
    );
    return;
  }
  const rows = products.slice(0, 20).map((p) => [
    inlineButton(p.title.slice(0, 28), `sub:add:${p.sku}`),
  ]);
  rows.push([inlineButton("Back", "sub:menu")]);
  await ctx.editMessageText("Pick a product for restock alerts:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^sub:add:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Subscribed." });
  const sku = ctx.match[1] ?? "";
  const userId = ctx.from?.id;
  if (!userId) return;
  const product = await getProduct(sku);
  if (!product) {
    await ctx.reply("That product isn't available anymore.");
    return;
  }
  await subscribe(userId, sku, "restock");
  await ctx.reply(
    `You'll get a message when ${product.title} restocks or goes on sale.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("My alerts", "sub:menu")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
