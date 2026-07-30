/**
 * The one algorithm this API signs and accepts.
 *
 * `jwt.verify(token, secret)` with no options lets the *token* nominate its own
 * algorithm, and the library then picks a verification strategy to match. That
 * is the shape of the classic JWT confusion attacks: `alg: none`, or an RS256
 * verifier handed a public key that an HS256 token can be signed with. Current
 * jsonwebtoken versions defend against both on their own - a string secret is
 * only matched against the HMAC family, and `none` is refused unless asked for.
 *
 * Which makes this defence in depth rather than a fix for a live hole, and
 * worth stating plainly. The reason to pin it anyway is that the protection
 * above is inferred from the *type of the secret we happen to pass*, not from
 * anything we declared. It is one refactor away from being wrong: the day
 * someone moves these secrets to a KeyObject or introduces an asymmetric key
 * for service-to-service tokens, the inference changes silently and nothing
 * fails a test. An explicit allowlist keeps that decision ours.
 *
 * Signing pins the same constant so the two sides cannot drift apart.
 */
export const JWT_ALGORITHM = "HS256";

/** Spread into every `jwt.verify` call. */
export const JWT_VERIFY_OPTIONS = { algorithms: [JWT_ALGORITHM] };
