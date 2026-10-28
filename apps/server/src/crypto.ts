import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

/** El servidor está saturado de comprobaciones de contraseña. */
export class BusyError extends Error {}

// Cada scrypt usa ~128 MB: sin tope, una avalancha de logins podría agotar la memoria.
const MAX_CONCURRENT_HASHES = 2;
const MAX_QUEUED_HASHES = 32;
let activeHashes = 0;
const hashQueue: (() => void)[] = [];

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHashes >= MAX_CONCURRENT_HASHES) {
    if (hashQueue.length >= MAX_QUEUED_HASHES) throw new BusyError("Servidor ocupado");
    await new Promise<void>((resolve) => hashQueue.push(resolve));
  }
  activeHashes++;
  try {
    return await fn();
  } finally {
    activeHashes--;
    hashQueue.shift()?.();
  }
}

function scrypt(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return withHashSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scryptCb(
          password.normalize("NFKC"),
          salt,
          KEY_LEN,
          { N: n, r: SCRYPT_R, p: SCRYPT_P, maxmem: 512 * 1024 * 1024 },
          (err, key) => (err ? reject(err) : resolve(key)),
        );
      }),
  );
}

/** Comparación en tiempo constante de dos cadenas (tokens, códigos...). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Formato: scrypt$N$r$p$salt$hash (base64). Los parámetros viajan con el hash. */
export async function hashPassword(password: string, n: number): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, n);
  return `scrypt$${n}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, nStr, , , saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !nStr || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), Number(nStr));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Se usa cuando el usuario no existe, para que el tiempo de respuesta no lo delate. */
export async function burnPasswordCheck(n: number): Promise<void> {
  await scrypt("x", Buffer.alloc(16), n);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ───────────── Secretos en reposo (AES-256-GCM) ─────────────

const ENC_PREFIX = "enc:v1:";

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("La clave maestra debe tener 32 bytes");
  }

  static isEncrypted(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(ENC_PREFIX);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + Buffer.concat([iv, tag, data]).toString("base64");
  }

  decrypt(payload: string): string {
    if (!SecretBox.isEncrypted(payload)) throw new Error("Valor no cifrado");
    const raw = Buffer.from(payload.slice(ENC_PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

/**
 * Clave maestra: `OBLIVION_SECRET_KEY` (32 bytes en base64/hex) o, si no existe, un
 * archivo `master.key` en la carpeta de datos con permisos 0600.
 */
export function loadMasterKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  const fromEnv = env.OBLIVION_SECRET_KEY?.trim();
  if (fromEnv) {
    const key = /^[0-9a-f]{64}$/i.test(fromEnv)
      ? Buffer.from(fromEnv, "hex")
      : Buffer.from(fromEnv, "base64");
    if (key.length !== 32) {
      throw new Error("OBLIVION_SECRET_KEY debe ser de 32 bytes (64 hex o 44 caracteres base64)");
    }
    return key;
  }
  const file = path.join(dataDir, "master.key");
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  fs.mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  return key;
}
