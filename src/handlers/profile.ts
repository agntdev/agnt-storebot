import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getUser, upsertUser } from "../store/users.js";

registerMainMenuItem({ label: "Profile", data: "profile:view", order: 50 });

const composer = new Composer<Ctx>();

async function profileText(userId: number, fallbackName: string): Promise<string> {
  const u = await getUser(userId);
  return (
    `Your profile\n\n` +
    `Name: ${u?.name || fallbackName}\n` +
    `Email: ${u?.email || "not set"}\n` +
    `Shipping: ${u?.shipping_address || "not set"}\n\n` +
    `We only share this with store admins for fulfillment.`
  );
}

function profileKeyboard() {
  return inlineKeyboard([
    [inlineButton("Edit name", "profile:name")],
    [inlineButton("Edit email", "profile:email")],
    [inlineButton("Edit shipping", "profile:addr")],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("profile:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;
  const name =
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Customer";
  await upsertUser({ telegram_id: userId, name });
  await ctx.editMessageText(await profileText(userId, name), {
    reply_markup: profileKeyboard(),
  });
});

composer.callbackQuery("profile:name", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile_name";
  await ctx.editMessageText("Send your name as a message.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "profile:view")]]),
  });
});

composer.callbackQuery("profile:email", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile_email";
  await ctx.editMessageText("Send your email address.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "profile:view")]]),
  });
});

composer.callbackQuery("profile:addr", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile_address";
  await ctx.editMessageText("Send your full shipping address.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "profile:view")]]),
  });
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (
    step !== "profile_name" &&
    step !== "profile_email" &&
    step !== "profile_address"
  ) {
    return next();
  }
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message.text.trim();
  const baseName =
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Customer";

  if (step === "profile_name") {
    if (text.length < 2) {
      await ctx.reply("Name is too short — try again.");
      return;
    }
    await upsertUser({ telegram_id: userId, name: text });
    ctx.session.step = "idle";
    await ctx.reply("Name updated.", {
      reply_markup: profileKeyboard(),
    });
    return;
  }

  if (step === "profile_email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await ctx.reply("That doesn't look like an email — check it and send again.");
      return;
    }
    await upsertUser({ telegram_id: userId, name: baseName, email: text });
    ctx.session.step = "idle";
    await ctx.reply("Email saved. We'll use it for receipts when email is enabled.", {
      reply_markup: profileKeyboard(),
    });
    return;
  }

  // profile_address
  if (text.length < 5) {
    await ctx.reply("Address looks too short — send the full shipping address.");
    return;
  }
  await upsertUser({
    telegram_id: userId,
    name: baseName,
    shipping_address: text,
  });
  ctx.session.step = "idle";
  await ctx.reply("Shipping address saved.", {
    reply_markup: profileKeyboard(),
  });
});

export default composer;
