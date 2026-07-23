import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { formatMoney, type FulfillmentStatus } from "../lib/models.js";
import { isValidAdminToken } from "../lib/admin-auth.js";
import { backMain } from "../lib/ui.js";
import {
  adjustStock,
  deleteProduct,
  getProduct,
  listProducts,
  upsertProduct,
} from "../store/products.js";
import {
  getOrder,
  listAllOrders,
  ordersToCsv,
  updateFulfillmentStatus,
} from "../store/orders.js";
import { listAdminChatIds, registerAdminChat } from "../store/users.js";
import { broadcastMessage, notifyRestock, notifyShippingUpdate } from "../services/notify.js";

registerMainMenuItem({ label: "Admin Panel", data: "admin:login", order: 90 });

const composer = new Composer<Ctx>();

const FULFILLMENT: FulfillmentStatus[] = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

function requireAdmin(ctx: Ctx): boolean {
  return Boolean(ctx.session.adminAuthed);
}

function adminMenuKeyboard() {
  return inlineKeyboard([
    [inlineButton("Products", "admin:products")],
    [inlineButton("Orders", "admin:orders")],
    [inlineButton("Broadcast", "admin:broadcast")],
    [inlineButton("Export CSV", "admin:export")],
    [inlineButton("Log out", "admin:logout")],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

const ADMIN_DASH =
  "Admin panel\n\nManage products, update orders, broadcast, or export history.";

composer.callbackQuery("admin:login", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.adminAuthed) {
    await ctx.editMessageText(ADMIN_DASH, { reply_markup: adminMenuKeyboard() });
    return;
  }
  ctx.session.step = "admin_token";
  await ctx.editMessageText(
    "Enter the admin access token as a message.\n\nIf you don't have it, ask the store owner.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "menu:main")]]),
    },
  );
});

composer.callbackQuery("admin:logout", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Logged out." });
  ctx.session.adminAuthed = false;
  ctx.session.step = "idle";
  await ctx.editMessageText("Admin session ended.", { reply_markup: backMain() });
});

composer.callbackQuery("admin:home", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) {
    await ctx.editMessageText("Admin access required.", {
      reply_markup: inlineKeyboard([[inlineButton("Admin login", "admin:login")]]),
    });
    return;
  }
  ctx.session.step = "idle";
  await ctx.editMessageText(ADMIN_DASH, { reply_markup: adminMenuKeyboard() });
});

// ── Products ──────────────────────────────────────────────────────────

composer.callbackQuery("admin:products", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const products = await listProducts();
  const lines =
    products.length === 0
      ? "No products yet — tap Add product to create one."
      : products
          .slice(0, 20)
          .map(
            (p) =>
              `• ${p.title} (${p.sku}) — ${formatMoney(p.price)} · stock ${p.stock}`,
          )
          .join("\n");
  const rows = products.slice(0, 12).map((p) => [
    inlineButton(p.title.slice(0, 28), `admin:pv:${p.sku}`),
  ]);
  rows.unshift([inlineButton("Add product", "admin:pnew")]);
  rows.push([inlineButton("Admin home", "admin:home")]);
  await ctx.editMessageText(`Products\n\n${lines}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("admin:pnew", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  ctx.session.step = "admin_product_title";
  ctx.session.draftSku = undefined;
  ctx.session.draftTitle = undefined;
  ctx.session.draftPrice = undefined;
  ctx.session.draftStock = undefined;
  ctx.session.draftCategory = undefined;
  await ctx.editMessageText("New product — send the product title.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "admin:products")]]),
  });
});

composer.callbackQuery(/^admin:pv:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const sku = ctx.match[1] ?? "";
  const p = await getProduct(sku);
  if (!p) {
    await ctx.editMessageText("Product not found.", {
      reply_markup: inlineKeyboard([[inlineButton("Back", "admin:products")]]),
    });
    return;
  }
  const text =
    `${p.title}\n` +
    `SKU: ${p.sku}\n` +
    `Price: ${formatMoney(p.price)}\n` +
    `Stock: ${p.stock}\n` +
    `Category: ${p.category}` +
    (p.variants.length ? `\nVariants: ${p.variants.join(", ")}` : "");
  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("Edit title", `admin:pe:title:${p.sku}`)],
      [inlineButton("Edit price", `admin:pe:price:${p.sku}`)],
      [inlineButton("Edit stock", `admin:pe:stock:${p.sku}`)],
      [inlineButton("Edit category", `admin:pe:category:${p.sku}`)],
      [inlineButton("Delete", `admin:pd:${p.sku}`)],
      [inlineButton("Back", "admin:products")],
    ]),
  });
});

composer.callbackQuery(/^admin:pe:(title|price|stock|category):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const field = ctx.match[1] as "title" | "price" | "stock" | "category";
  const sku = ctx.match[2] ?? "";
  const p = await getProduct(sku);
  if (!p) {
    await ctx.reply("Product not found.");
    return;
  }
  ctx.session.draftSku = sku;
  ctx.session.editField = field;
  ctx.session.step = "admin_edit_field";
  const prompts: Record<string, string> = {
    title: "Send the new title.",
    price: "Send the new price in dollars (e.g. 19.99).",
    stock: "Send the new stock quantity (whole number).",
    category: "Send the new category name.",
  };
  await ctx.editMessageText(prompts[field] ?? "Send the new value.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", `admin:pv:${sku}`)]]),
  });
});

composer.callbackQuery(/^admin:pd:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const sku = ctx.match[1] ?? "";
  await ctx.editMessageText(`Delete product ${sku}? This can't be undone.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("Delete product", `admin:pdok:${sku}`)],
      [inlineButton("Cancel", `admin:pv:${sku}`)],
    ]),
  });
});

composer.callbackQuery(/^admin:pdok:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Deleted." });
  if (!requireAdmin(ctx)) return;
  const sku = ctx.match[1] ?? "";
  await deleteProduct(sku);
  await ctx.editMessageText(`Product ${sku} deleted.`, {
    reply_markup: inlineKeyboard([[inlineButton("Products", "admin:products")]]),
  });
});

// ── Orders ────────────────────────────────────────────────────────────

composer.callbackQuery("admin:orders", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const orders = await listAllOrders();
  if (orders.length === 0) {
    await ctx.editMessageText("No orders yet.", {
      reply_markup: inlineKeyboard([[inlineButton("Admin home", "admin:home")]]),
    });
    return;
  }
  const lines = orders
    .slice(0, 15)
    .map(
      (o) =>
        `• ${o.order_id} — ${formatMoney(o.total)} · ${o.payment_status}/${o.fulfillment_status}`,
    )
    .join("\n");
  const rows = orders.slice(0, 12).map((o) => [
    inlineButton(o.order_id.slice(0, 28), `admin:ov:${o.order_id}`),
  ]);
  rows.push([inlineButton("Admin home", "admin:home")]);
  await ctx.editMessageText(`Orders\n\n${lines}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^admin:ov:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const orderId = ctx.match[1] ?? "";
  const o = await getOrder(orderId);
  if (!o) {
    await ctx.editMessageText("Order not found.", {
      reply_markup: inlineKeyboard([[inlineButton("Back", "admin:orders")]]),
    });
    return;
  }
  const items = o.items
    .map((i) => `• ${i.title} × ${i.qty}`)
    .join("\n");
  const text =
    `Order ${o.order_id}\n` +
    `Customer: ${o.customer_name}\n` +
    `Total: ${formatMoney(o.total)}\n` +
    `Payment: ${o.payment_status}\n` +
    `Fulfillment: ${o.fulfillment_status}\n` +
    (o.shipping_address ? `Ship to: ${o.shipping_address}\n` : "") +
    `\n${items}`;
  const rows = FULFILLMENT.map((s) => [
    inlineButton(`Set ${s}`, `admin:os:${o.order_id}:${s}`),
  ]);
  rows.push([inlineButton("Back", "admin:orders")]);
  await ctx.editMessageText(text, { reply_markup: inlineKeyboard(rows) });
});

composer.callbackQuery(/^admin:os:([^:]+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Status updated." });
  if (!requireAdmin(ctx)) return;
  const orderId = ctx.match[1] ?? "";
  const status = ctx.match[2] as FulfillmentStatus;
  if (!FULFILLMENT.includes(status)) {
    await ctx.reply("Unknown status.");
    return;
  }
  const updated = await updateFulfillmentStatus(orderId, status);
  if (!updated) {
    await ctx.reply("Order not found.");
    return;
  }
  await notifyShippingUpdate(ctx.api, updated);
  await ctx.reply(
    `Order ${updated.order_id} is now ${status}. Customer notified when possible.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("View order", `admin:ov:${updated.order_id}`)],
        [inlineButton("All orders", "admin:orders")],
      ]),
    },
  );
});

// ── Broadcast ─────────────────────────────────────────────────────────

composer.callbackQuery("admin:broadcast", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  ctx.session.step = "admin_broadcast";
  await ctx.editMessageText(
    "Send the broadcast message. It goes to customers who have ordered (and admins).",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "admin:home")]]),
    },
  );
});

// ── Export ────────────────────────────────────────────────────────────

composer.callbackQuery("admin:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!requireAdmin(ctx)) return;
  const orders = await listAllOrders();
  if (orders.length === 0) {
    await ctx.editMessageText("Nothing to export — no orders yet.", {
      reply_markup: inlineKeyboard([[inlineButton("Admin home", "admin:home")]]),
    });
    return;
  }
  const csv = ordersToCsv(orders);
  const bytes = new TextEncoder().encode(csv);
  try {
    await ctx.replyWithDocument(new InputFile(bytes, "orders.csv"), {
      caption: `${orders.length} order(s) exported.`,
    });
  } catch {
    // Fallback: send as text if document fails (e.g. harness)
    await ctx.reply(
      `Export ready (${orders.length} orders):\n\n${csv.slice(0, 3500)}`,
    );
  }

  // Optional email to admin if they have email on profile — skip silently
  const adminIds = await listAdminChatIds();
  for (const id of adminIds.slice(0, 1)) {
    // best-effort; no user email lookup required
    void id;
  }

  await ctx.reply("CSV export generated.", {
    reply_markup: inlineKeyboard([[inlineButton("Admin home", "admin:home")]]),
  });
});

// ── Text input for admin flows ────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (
    step !== "admin_token" &&
    step !== "admin_product_title" &&
    step !== "admin_product_sku" &&
    step !== "admin_product_price" &&
    step !== "admin_product_stock" &&
    step !== "admin_product_category" &&
    step !== "admin_edit_field" &&
    step !== "admin_broadcast"
  ) {
    return next();
  }

  const text = ctx.message.text.trim();

  if (step === "admin_token") {
    if (!isValidAdminToken(text)) {
      await ctx.reply("That token doesn't match. Try again, or tap Cancel from Admin Panel.");
      return;
    }
    ctx.session.adminAuthed = true;
    ctx.session.step = "idle";
    if (ctx.chat) await registerAdminChat(ctx.chat.id);
    await ctx.reply(ADMIN_DASH, { reply_markup: adminMenuKeyboard() });
    return;
  }

  if (!requireAdmin(ctx)) {
    ctx.session.step = "idle";
    await ctx.reply("Admin session expired. Open Admin Panel to sign in again.", {
      reply_markup: backMain(),
    });
    return;
  }

  if (step === "admin_broadcast") {
    ctx.session.step = "idle";
    // Collect recipient chat ids from all orders (unique customers who opted in by ordering)
    const orders = await listAllOrders();
    const recipients = new Set<number>();
    for (const o of orders) recipients.add(o.chat_id);
    for (const id of await listAdminChatIds()) recipients.add(id);
    if (recipients.size === 0) {
      await ctx.reply("No recipients yet — wait until customers place orders.", {
        reply_markup: adminMenuKeyboard(),
      });
      return;
    }
    const result = await broadcastMessage(ctx.api, [...recipients], text);
    await ctx.reply(
      `Broadcast sent to ${result.sent} chat(s)` +
        (result.failed ? ` (${result.failed} unreachable).` : "."),
      { reply_markup: adminMenuKeyboard() },
    );
    return;
  }

  if (step === "admin_edit_field") {
    const sku = ctx.session.draftSku;
    const field = ctx.session.editField;
    if (!sku || !field) {
      ctx.session.step = "idle";
      await ctx.reply("Edit cancelled.", { reply_markup: adminMenuKeyboard() });
      return;
    }
    const p = await getProduct(sku);
    if (!p) {
      ctx.session.step = "idle";
      await ctx.reply("Product not found.");
      return;
    }

    if (field === "title") {
      if (text.length < 1) {
        await ctx.reply("Title can't be empty.");
        return;
      }
      await upsertProduct({ ...p, title: text });
    } else if (field === "price") {
      const cents = parsePriceToCents(text);
      if (cents === null) {
        await ctx.reply("Use a price like 19.99");
        return;
      }
      await upsertProduct({ ...p, price: cents });
    } else if (field === "stock") {
      const n = Number.parseInt(text, 10);
      if (!Number.isFinite(n) || n < 0) {
        await ctx.reply("Send a whole number ≥ 0.");
        return;
      }
      const wasZero = p.stock <= 0;
      const result = await adjustStock(sku, n);
      if (result && wasZero && n > 0) {
        await notifyRestock(ctx.api, result.product);
      }
    } else if (field === "category") {
      if (text.length < 1) {
        await ctx.reply("Category can't be empty.");
        return;
      }
      await upsertProduct({ ...p, category: text });
    }

    ctx.session.step = "idle";
    ctx.session.draftSku = undefined;
    ctx.session.editField = undefined;
    await ctx.reply("Product updated.", {
      reply_markup: inlineKeyboard([
        [inlineButton("View product", `admin:pv:${sku}`)],
        [inlineButton("Products", "admin:products")],
      ]),
    });
    return;
  }

  // New product wizard
  if (step === "admin_product_title") {
    if (text.length < 1) {
      await ctx.reply("Title can't be empty.");
      return;
    }
    ctx.session.draftTitle = text;
    ctx.session.step = "admin_product_sku";
    await ctx.reply("Send a short SKU (letters/numbers, e.g. MUG-01).");
    return;
  }

  if (step === "admin_product_sku") {
    const sku = text.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
    if (sku.length < 1) {
      await ctx.reply("SKU must include letters or numbers.");
      return;
    }
    if (await getProduct(sku)) {
      await ctx.reply("That SKU already exists — pick another.");
      return;
    }
    ctx.session.draftSku = sku;
    ctx.session.step = "admin_product_price";
    await ctx.reply("Send the price in dollars (e.g. 12.50).");
    return;
  }

  if (step === "admin_product_price") {
    const cents = parsePriceToCents(text);
    if (cents === null) {
      await ctx.reply("Use a price like 19.99");
      return;
    }
    ctx.session.draftPrice = cents;
    ctx.session.step = "admin_product_stock";
    await ctx.reply("Send starting stock (whole number).");
    return;
  }

  if (step === "admin_product_stock") {
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n) || n < 0) {
      await ctx.reply("Send a whole number ≥ 0.");
      return;
    }
    ctx.session.draftStock = n;
    ctx.session.step = "admin_product_category";
    await ctx.reply("Send the category name (e.g. Home).");
    return;
  }

  if (step === "admin_product_category") {
    if (text.length < 1) {
      await ctx.reply("Category can't be empty.");
      return;
    }
    const product = await upsertProduct({
      sku: ctx.session.draftSku!,
      title: ctx.session.draftTitle!,
      price: ctx.session.draftPrice!,
      stock: ctx.session.draftStock!,
      category: text,
      variants: [],
    });
    ctx.session.step = "idle";
    ctx.session.draftSku = undefined;
    ctx.session.draftTitle = undefined;
    ctx.session.draftPrice = undefined;
    ctx.session.draftStock = undefined;
    await ctx.reply(
      `Added ${product.title} (${product.sku}) — ${formatMoney(product.price)}, stock ${product.stock}.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Products", "admin:products")],
          [inlineButton("Admin home", "admin:home")],
        ]),
      },
    );
  }
});

function parsePriceToCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export default composer;
