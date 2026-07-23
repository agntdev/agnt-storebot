/**
 * Admin token check. Prefer ADMIN_TOKEN from the environment when set;
 * otherwise a built-in default so the bot works without owner-supplied env
 * (specs must not depend on env values).
 */
const DEFAULT_ADMIN_TOKEN = "store-admin";

export function expectedAdminToken(): string {
  if (typeof process !== "undefined" && process.env.ADMIN_TOKEN?.trim()) {
    return process.env.ADMIN_TOKEN.trim();
  }
  return DEFAULT_ADMIN_TOKEN;
}

export function isValidAdminToken(input: string): boolean {
  return input.trim() === expectedAdminToken();
}
