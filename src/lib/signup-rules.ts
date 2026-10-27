// Disposable / temporary email providers that may not be used to sign up.
export const DISPOSABLE_DOMAINS = [
  "mailinator.com", "tempmail.com", "temp-mail.org", "temp-mail.io", "10minutemail.com", "10minutemail.net",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la", "yopmail.com",
  "yopmail.net", "trashmail.com", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mohmal.com", "emailondeck.com", "mintemail.com", "mytemp.email", "tempmailo.com", "tempail.com",
  "tempr.email", "discard.email", "spamgourmet.com", "mailnesia.com", "burnermail.io", "moakt.com", "emailfake.com",
  "fakemail.net", "inboxkitten.com", "mail.tm", "mail.gw", "tmpmail.org", "tmpmail.net", "minuteinbox.com",
  "33mail.com", "spambox.us", "trbvm.com", "linshiyouxiang.net", "byom.de", "cock.li", "mailpoof.com", "dropmail.me",
  "1secmail.com", "1secmail.org", "1secmail.net", "emltmp.com", "tempmail.plus", "harakirimail.com", "luxusmail.org",
];

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return DISPOSABLE_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/** Returns a list of unmet password requirements (empty = strong enough). */
export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 10) p.push("at least 10 characters");
  if (!/[a-z]/.test(pw)) p.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) p.push("an uppercase letter");
  if (!/\d/.test(pw)) p.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) p.push("a symbol");
  return p;
}
