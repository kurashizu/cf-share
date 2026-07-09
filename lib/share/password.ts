import crypto from "crypto";

const SALT_LENGTH = 16;
const HASH_ALGORITHM = "sha256";

/**
 * Generate a random salt and hash a password.
 * Returns { salt, hash } where hash = SHA-256(password + salt).
 */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const hash = crypto
    .createHash(HASH_ALGORITHM)
    .update(password + salt)
    .digest("hex");
  return { salt, hash };
}

/**
 * Verify a password against a stored salt and hash.
 * Returns true if SHA-256(password + salt) === stored hash.
 */
export function verifyPassword(
  password: string,
  salt: string,
  hash: string,
): boolean {
  const computed = crypto
    .createHash(HASH_ALGORITHM)
    .update(password + salt)
    .digest("hex");
  return computed === hash;
}

/** Check if a password meets minimum requirements (non-empty, reasonable length). */
export function isValidPassword(password: unknown): password is string {
  if (typeof password !== "string") return false;
  return password.length >= 1 && password.length <= 256;
}
