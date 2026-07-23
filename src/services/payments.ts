/**
 * Payment integrations: Stripe PaymentIntents (fetch) + Telegram invoice path.
 * Credentials are optional — when missing, checkout uses manual confirmation.
 */

export function stripeSecretKey(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const k = process.env.STRIPE_SECRET_KEY?.trim();
  return k || undefined;
}

export function telegramPaymentToken(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const k = process.env.TELEGRAM_PAYMENT_TOKEN?.trim();
  return k || undefined;
}

export function paymentMode(): "stripe" | "telegram" | "manual" {
  if (stripeSecretKey()) return "stripe";
  if (telegramPaymentToken()) return "telegram";
  return "manual";
}

export interface StripeIntentResult {
  ok: true;
  id: string;
  client_secret: string | null;
  status: string;
}

export interface StripeIntentError {
  ok: false;
  message: string;
}

/** Create a Stripe PaymentIntent (Stripe-like REST API). */
export async function createPaymentIntent(opts: {
  amountCents: number;
  currency?: string;
  orderId: string;
  description?: string;
}): Promise<StripeIntentResult | StripeIntentError> {
  const key = stripeSecretKey();
  if (!key) return { ok: false, message: "Stripe isn't configured yet." };

  const body = new URLSearchParams();
  body.set("amount", String(opts.amountCents));
  body.set("currency", (opts.currency ?? "usd").toLowerCase());
  body.set("metadata[order_id]", opts.orderId);
  if (opts.description) body.set("description", opts.description);
  body.set("automatic_payment_methods[enabled]", "true");

  try {
    const res = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const data = (await res.json()) as {
      id?: string;
      client_secret?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!res.ok || !data.id) {
      return {
        ok: false,
        message: data.error?.message ?? "Payment provider declined the request.",
      };
    }
    return {
      ok: true,
      id: data.id,
      client_secret: data.client_secret ?? null,
      status: data.status ?? "requires_payment_method",
    };
  } catch {
    return { ok: false, message: "Couldn't reach the payment provider. Try again shortly." };
  }
}

/** Retrieve PaymentIntent status from Stripe. */
export async function getPaymentIntentStatus(
  intentId: string,
): Promise<"succeeded" | "processing" | "failed" | "unknown"> {
  const key = stripeSecretKey();
  if (!key) return "unknown";
  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return "failed";
    const data = (await res.json()) as { status?: string };
    if (data.status === "succeeded") return "succeeded";
    if (data.status === "processing" || data.status === "requires_action") return "processing";
    if (data.status === "canceled") return "failed";
    return "unknown";
  } catch {
    return "unknown";
  }
}
