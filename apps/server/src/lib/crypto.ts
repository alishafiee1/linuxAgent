import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PREFIX = "v1";

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(key: Buffer, box: string): string {
  const [prefix, iv, tag, data] = box.split(".");
  if (prefix !== PREFIX || !iv || !tag || data === undefined) throw new Error("bad ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// scrypt from Node itself: the server CPU has no AVX/SSE4, so prebuilt native hashers crash on it.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SCRYPT_KEYLEN = 32;

function scryptAsync(password: string, salt: Buffer, params: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, params, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Output: `scrypt.<N>.<r>.<p>.<salt>.<key>` (base64url salt and key). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join(".");
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split(".");
  if (scheme !== "scrypt" || !N || !r || !p || !salt || !key) return false;
  const params = { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem };
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), params);
  const expected = Buffer.from(key, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
