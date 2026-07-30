import { z } from "zod";

/**
 * A URL we are willing to store and later hand to a browser.
 *
 * `z.string().url()` is not that. It delegates to the WHATWG parser, whose only
 * question is "is this a well-formed URL" - and `javascript:alert(1)`,
 * `data:text/html,<script>...`, and `vbscript:msgbox` are all well-formed URLs.
 * Verified against the zod 4 in this project's lockfile, not assumed: all three
 * parse clean today.
 *
 * Every field using this schema is free text from a customer or a business
 * owner that ends up rendered by the frontend - avatars, service images, review
 * photos, certificate verification links. The moment any of them is placed in
 * an `href` rather than a `src`, a stored `javascript:` URL is stored XSS
 * against whoever clicks it, and the payload has been sitting in the database
 * since long before that component was written.
 *
 * Which is the argument for fixing it here rather than at each render site.
 * Today only the public website link is rendered as an anchor, and it happens
 * to be safe because that component re-prefixes anything without an http(s)
 * scheme. That is one component's implementation detail defending the whole
 * class - it holds until someone adds a "view credential" link to the
 * certificate card and reasonably assumes a validated URL is a safe URL.
 * The scheme allowlist makes that assumption true.
 *
 * An allowlist, not a `javascript:` blocklist: the set of schemes a browser
 * will execute is not fixed or fully enumerable, but the set this product has
 * any use for is exactly two.
 */
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export const httpUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (value) => {
      try {
        return SAFE_PROTOCOLS.has(new URL(value).protocol);
      } catch {
        // Unreachable in practice - `.url()` already parsed it - but a schema
        // that throws instead of rejecting is a 500 where a 400 belongs.
        return false;
      }
    },
    { message: "URL must start with http:// or https://" }
  );
