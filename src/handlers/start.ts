import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard } from "../toolkit/index.js";
import { upsertUser } from "../store/users.js";

const composer = new Composer<Ctx>();

export const WELCOME =
  "Welcome to the store.\n\n" +
  "Browse the catalog, manage your cart, track orders, or opt in to product alerts.";

composer.command("start", async (ctx) => {
  ctx.session.step = "idle";
  const from = ctx.from;
  if (from) {
    await upsertUser({
      telegram_id: from.id,
      name: [from.first_name, from.last_name].filter(Boolean).join(" ") || "Customer",
    });
  }
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard(2) });
});

composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard(2) });
});

export default composer;
