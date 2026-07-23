import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { formatMoney } from "../lib/models.js";
import { backMain } from "../lib/ui.js";
import {
  getProduct,
  listByCategory,
  listCategories,
  listProducts,
} from "../store/products.js";
import { getSubscription, subscribe, unsubscribe } from "../store/subscriptions.js";

registerMainMenuItem({ label: "Browse Products", data: "catalog:categories", order: 10 });

const composer = new Composer<Ctx>();

function categoriesKeyboard(categories: string[]) {
  const rows = categories.map((c) => [
    inlineButton(c, `catalog:cat:${encodeURIComponent(c).slice(0, 40)}`),
  ]);
  rows.push([inlineButton("All products", "catalog:all")]);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

function productsKeyboard(
  products: { sku: string; title: string }[],
  backData: string,
) {
  const rows = products.map((p) => [
    inlineButton(p.title.slice(0, 28), `catalog:p:${p.sku}`),
  ]);
  rows.push([inlineButton("Back", backData)]);
  return inlineKeyboard(rows);
}

composer.callbackQuery("catalog:categories", async (ctx) => {
  await ctx.answerCallbackQuery();
  const categories = await listCategories();
  const products = await listProducts();
  if (products.length === 0) {
    await ctx.editMessageText(
      "No products yet — check back soon, or ask the store owner to add some.",
      { reply_markup: backMain() },
    );
    return;
  }
  if (categories.length === 0) {
    await ctx.editMessageText("Pick a product:", {
      reply_markup: productsKeyboard(products, "menu:main"),
    });
    return;
  }
  await ctx.editMessageText("Choose a category:", {
    reply_markup: categoriesKeyboard(categories),
  });
});

composer.callbackQuery("catalog:all", async (ctx) => {
  await ctx.answerCallbackQuery();
  const products = await listProducts();
  if (products.length === 0) {
    await ctx.editMessageText(
      "No products yet — check back soon, or ask the store owner to add some.",
      { reply_markup: backMain() },
    );
    return;
  }
  await ctx.editMessageText("All products:", {
    reply_markup: productsKeyboard(products, "catalog:categories"),
  });
});

composer.callbackQuery(/^catalog:cat:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const raw = ctx.match[1] ?? "";
  let category: string;
  try {
    category = decodeURIComponent(raw);
  } catch {
    category = raw;
  }
  const products = await listByCategory(category);
  if (products.length === 0) {
    await ctx.editMessageText(`No items in ${category} right now.`, {
      reply_markup: inlineKeyboard([[inlineButton("Back", "catalog:categories")]]),
    });
    return;
  }
  await ctx.editMessageText(`${category}:`, {
    reply_markup: productsKeyboard(products, "catalog:categories"),
  });
});

composer.callbackQuery(/^catalog:p:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const sku = ctx.match[1] ?? "";
  const product = await getProduct(sku);
  if (!product) {
    await ctx.editMessageText("That product isn't available anymore.", {
      reply_markup: inlineKeyboard([[inlineButton("Back", "catalog:categories")]]),
    });
    return;
  }
  const stockLine =
    product.stock <= 0
      ? "Out of stock"
      : product.stock <= 5
        ? `Only ${product.stock} left`
        : `${product.stock} in stock`;
  const variantLine =
    product.variants.length > 0
      ? `\nOptions: ${product.variants.join(", ")}`
      : "";
  const text =
    `${product.title}\n` +
    `${formatMoney(product.price)} · ${stockLine}\n` +
    `Category: ${product.category}` +
    variantLine +
    (product.description ? `\n\n${product.description}` : "");

  const rows = [];
  if (product.stock > 0) {
    if (product.variants.length > 0) {
      for (const v of product.variants.slice(0, 6)) {
        rows.push([
          inlineButton(`Add ${v}`.slice(0, 28), `cart:add:${product.sku}:${encodeURIComponent(v).slice(0, 20)}`),
        ]);
      }
    } else {
      rows.push([inlineButton("Add to cart", `cart:add:${product.sku}`)]);
    }
  } else {
    const userId = ctx.from?.id;
    const sub = userId ? await getSubscription(userId, product.sku) : undefined;
    if (sub) {
      rows.push([inlineButton("Unsubscribe alert", `sub:off:${product.sku}`)]);
    } else {
      rows.push([inlineButton("Alert me when restocked", `sub:on:${product.sku}`)]);
    }
  }
  rows.push([inlineButton("View cart", "cart:view")]);
  rows.push([inlineButton("Back", "catalog:categories")]);

  await ctx.editMessageText(text, { reply_markup: inlineKeyboard(rows) });
});

// Subscription toggles from product detail
composer.callbackQuery(/^sub:on:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "You're subscribed." });
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
    `You'll get a message when ${product.title} is back in stock.`,
    { reply_markup: backMain() },
  );
});

composer.callbackQuery(/^sub:off:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Unsubscribed." });
  const sku = ctx.match[1] ?? "";
  const userId = ctx.from?.id;
  if (!userId) return;
  await unsubscribe(userId, sku);
  await ctx.reply("Alert removed. You won't get restock messages for that item.", {
    reply_markup: backMain(),
  });
});

export default composer;
