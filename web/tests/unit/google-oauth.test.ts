import { createHash } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { newAuthRequest, verifyIdToken, type GoogleConfig } from "@/lib/server/google-oauth";

/** Google ID-token checks, using a locally generated key pair in place of Google's. */
const config: GoogleConfig = {
  clientId: "test-client.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "http://localhost:3100/api/auth/google/callback",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
};
let keys: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256", use: "sig" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

const token = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT({ email: "pat@example.com", email_verified: true, name: "Pat Buyer", nonce: "n-123", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? config.clientId)
    .setSubject("google-sub-1")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(privateKey);

describe("Google sign-in request", () => {
  it("uses PKCE (S256), a state and a nonce", () => {
    const req = newAuthRequest(config);
    const url = new URL(req.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(req.verifier).digest("base64url"));
    expect(url.searchParams.get("state")).toBe(req.state);
    expect(url.searchParams.get("nonce")).toBe(req.nonce);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });
});

describe("Google ID token verification", () => {
  it("accepts a valid token and returns the identity", async () => {
    await expect(verifyIdToken(await token({}), config, "n-123", keys)).resolves.toEqual({ sub: "google-sub-1", email: "pat@example.com", name: "Pat Buyer" });
  });
  it("rejects another app's token (audience)", async () => {
    await expect(verifyIdToken(await token({}, { aud: "someone-else" }), config, "n-123", keys)).rejects.toMatchObject({ code: "GOOGLE_FAILED" });
  });
  it("rejects a token not issued by Google", async () => {
    await expect(verifyIdToken(await token({}, { iss: "https://evil.example" }), config, "n-123", keys)).rejects.toMatchObject({ code: "GOOGLE_FAILED" });
  });
  it("rejects a replayed token (nonce mismatch)", async () => {
    await expect(verifyIdToken(await token({}), config, "different-nonce", keys)).rejects.toMatchObject({ code: "GOOGLE_FAILED" });
  });
  it("rejects an expired token", async () => {
    await expect(verifyIdToken(await token({}, { exp: "-10m" }), config, "n-123", keys)).rejects.toMatchObject({ code: "GOOGLE_FAILED" });
  });
  it("rejects an unverified Google email", async () => {
    await expect(verifyIdToken(await token({ email_verified: false }), config, "n-123", keys)).rejects.toMatchObject({ code: "GOOGLE_EMAIL_UNVERIFIED" });
  });
  it("rejects a token signed with a different key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: "pat@example.com", email_verified: true, nonce: "n-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://accounts.google.com").setAudience(config.clientId).setSubject("x").setExpirationTime("5m").sign(other.privateKey);
    await expect(verifyIdToken(forged, config, "n-123", keys)).rejects.toMatchObject({ code: "GOOGLE_FAILED" });
  });
});
