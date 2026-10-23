import crypto from "node:crypto";

export function signRawBody(rawBody: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function signaturesMatch(provided: string, expectedHex: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expectedHex, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) {
    return false;
  }
  const expected = signRawBody(rawBody, secret);
  return signaturesMatch(signatureHeader, expected);
}
