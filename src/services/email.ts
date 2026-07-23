/**
 * Optional email via Resend HTTP API (Workers-safe fetch).
 * Degrades silently when RESEND_API_KEY / EMAIL_FROM are unset.
 */

export function emailConfigured(): boolean {
  if (typeof process === "undefined") return false;
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (typeof process === "undefined") {
    return { ok: false, reason: "Email isn't set up yet." };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return { ok: false, reason: "Email isn't set up yet." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, reason: "Email provider rejected the message." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach the email service." };
  }
}
