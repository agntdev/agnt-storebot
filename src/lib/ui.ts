import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import type { InlineKeyboardMarkup } from "../toolkit/index.js";

export const backMain = (): InlineKeyboardMarkup =>
  inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

export const backRow = (data: string, label = "Back"): ReturnType<typeof inlineButton>[] => [
  inlineButton(label, data),
];
