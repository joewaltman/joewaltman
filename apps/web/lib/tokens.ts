import { createHash, randomBytes } from "node:crypto";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

// Only the hash is stored, so a database leak does not hand out working links.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
