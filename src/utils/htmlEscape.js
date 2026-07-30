/**
 * Escape a value for interpolation into an HTML email body.
 *
 * Our outbound emails are built with template literals, which means every
 * `${...}` is an HTML injection point unless the value is escaped. That matters
 * more here than the word "email" suggests, because the values in question are
 * not ours: a business name, a professional's name, a job title. All three are
 * free text typed by a business owner, and the invite email carries them to any
 * address that owner nominates.
 *
 * So the attack is not "script tags in an inbox" - mail clients strip scripts
 * anyway - it is that an owner can close our markup and write their own, and
 * the result is delivered over our authenticated sending domain with our
 * reputation behind it. A convincing "your payment failed, click here" is
 * indistinguishable from a real Revoras email at that point, because as far as
 * SPF/DKIM are concerned it *is* one.
 *
 * Escaping is done at the interpolation site rather than by sanitizing on the
 * way into the database: the stored value is legitimately whatever the owner
 * typed, and it renders harmlessly everywhere else (React escapes by default).
 * HTML is the wrong context, not the data.
 *
 * Quotes are escaped along with the tag characters because some of these values
 * land inside attributes, where `>` alone is not the only way out.
 */
const HTML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
};

/**
 * Flatten a value for use in an email *subject*.
 *
 * Subjects are a single header line. A newline in one is either dropped, or -
 * depending on how the transport assembles the message - read as the start of
 * another header, which is the classic header-injection route to adding a
 * recipient. Resend takes JSON and encodes for us, so this is not currently a
 * live hole, but the subject is built from the same owner-controlled business
 * name as the body above, and "our current provider happens to handle it" is a
 * property of the provider, not of our code.
 */
export const escapeHeader = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
