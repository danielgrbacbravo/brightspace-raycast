import { createHmac } from "node:crypto";

const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

interface TotpOptions {
  periodSeconds?: number;
  digits?: number;
  timestamp?: number;
}

export function generateTotp(
  rawSecret: string,
  options: TotpOptions = {},
): string {
  const secret = decodeBase32(extractSecret(rawSecret));
  const periodSeconds = options.periodSeconds ?? DEFAULT_PERIOD_SECONDS;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const counter = Math.floor(
    (options.timestamp ?? Date.now()) / 1000 / periodSeconds,
  );
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function normalizeTotpSecret(rawSecret: string): string {
  return extractSecret(rawSecret);
}

function extractSecret(rawSecret: string): string {
  const trimmed = rawSecret.trim();
  if (!trimmed) {
    throw new Error("2FA setup key is empty.");
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const secret = parsed.searchParams.get("secret");
    if (!secret) {
      throw new Error("2FA setup URI does not contain a secret.");
    }
    return sanitizeBase32(secret);
  }

  return sanitizeBase32(trimmed);
}

function sanitizeBase32(secret: string): string {
  const sanitized = secret
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/=+$/g, "");

  if (!sanitized || /[^A-Z2-7]/.test(sanitized)) {
    throw new Error("2FA setup key must be a base32 secret.");
  }

  return sanitized;
}

function decodeBase32(secret: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of secret) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("2FA setup key must be a base32 secret.");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  if (bytes.length === 0) {
    throw new Error("2FA setup key is too short.");
  }

  return Buffer.from(bytes);
}
