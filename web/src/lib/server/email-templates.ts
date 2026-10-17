import type { EmailMessage } from "./email";

/** Plain, accessible transactional emails: one clear action, the link also as text. */
function layout(title: string, intro: string, buttonLabel: string, link: string, outro: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15130f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border-radius:16px;padding:32px">
<tr><td style="font-family:Georgia,serif;font-size:22px;letter-spacing:4px">SURETTE <span style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;color:#6b655a">REAL ESTATE</span></td></tr>
<tr><td style="padding-top:24px;font-size:20px;font-weight:600">${esc(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#4f493f">${esc(intro)}</td></tr>
<tr><td style="padding-top:24px"><a href="${esc(link)}" style="display:inline-block;background:#86602a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${esc(buttonLabel)}</a></td></tr>
<tr><td style="padding-top:20px;font-size:13px;line-height:1.6;color:#6b655a">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></td></tr>
<tr><td style="padding-top:20px;font-size:13px;line-height:1.6;color:#6b655a">${esc(outro)}</td></tr>
</table><p style="font-size:12px;color:#6b655a">Surette Real Estate · 113 Silver Street, Waterville, ME 04901</p></td></tr></table></body></html>`;
}

export function verifyEmailMessage(to: string, name: string, link: string): EmailMessage {
  const first = name.split(" ")[0] || "there";
  return {
    to,
    subject: "Confirm your email for Surette Real Estate",
    text: `Hi ${first},\n\nConfirm your email to save homes, searches and plans in your Surette account:\n${link}\n\nThis link works for 24 hours. If you didn't create an account, you can ignore this email.\n\nSurette Real Estate`,
    html: layout("Confirm your email", `Hi ${first}, confirm your email to save homes, searches and plans in your Surette account.`, "Confirm email", link, "This link works for 24 hours. If you didn't create an account, you can ignore this email."),
  };
}

export function passwordResetMessage(to: string, name: string, link: string): EmailMessage {
  const first = name.split(" ")[0] || "there";
  return {
    to,
    subject: "Reset your Surette password",
    text: `Hi ${first},\n\nUse this link to choose a new password:\n${link}\n\nIt works once, for 1 hour. If you didn't ask for this, ignore this email — your password stays the same.\n\nSurette Real Estate`,
    html: layout("Reset your password", `Hi ${first}, use the button below to choose a new password.`, "Choose a new password", link, "This link works once, for 1 hour. If you didn't ask for this, ignore this email — your password stays the same."),
  };
}
