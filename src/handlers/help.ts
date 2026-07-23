import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

const HELP =
  "This is a store bot — shop without leaving Telegram.\n\n" +
  "• Browse Products — categories and items\n" +
  "• View Cart — review and checkout\n" +
  "• My Orders — track payment and shipping\n" +
  "• Alerts — restock notifications (opt-in)\n" +
  "• Profile — name, email, shipping address\n" +
  "• Admin Panel — product and order management (token required)\n\n" +
  "Tap /start anytime to open the menu.";

const backToMenu = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;
