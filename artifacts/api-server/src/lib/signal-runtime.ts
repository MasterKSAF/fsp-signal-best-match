/**
 * Runtime switches that must be explicit.  In particular, a non-production
 * NODE_ENV is not permission to expose synthetic identities or verification
 * codes.
 */
export function isDemoModeEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.DEMO_MODE === "true";
}

export function isDemoVerificationCodeExposureEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isDemoModeEnabled(environment) &&
    environment.EXPOSE_DEMO_VERIFICATION_CODE === "true"
  );
}

export function isSecureCookieRequired(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.SESSION_COOKIE_SECURE === "true") return true;
  let publicUrl: URL | null = null;
  try {
    if (environment.PUBLIC_URL) {
      publicUrl = new URL(environment.PUBLIC_URL);
    }
  } catch {
    publicUrl = null;
  }
  const localHttp =
    publicUrl?.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname);
  if (environment.SESSION_COOKIE_SECURE === "false") {
    // Do not let a production configuration silently disable Secure cookies
    // on a network-reachable HTTP origin.  The offline loopback demo is the
    // one intentional exception.
    return environment.NODE_ENV === "production" && !localHttp;
  }
  if (publicUrl) {
    if (publicUrl.protocol === "https:") return true;
    if (localHttp) return false;
    return environment.NODE_ENV === "production";
  }
  return environment.NODE_ENV === "production";
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredBrowserOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const origins = new Set<string>();
  for (const rawValue of [
    environment.PUBLIC_URL,
    ...(environment.CORS_ORIGIN ?? "").split(","),
  ]) {
    if (!rawValue) continue;
    const origin = normalizeOrigin(rawValue.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Cross-origin browser requests are opt-in in real deployments.  A local
 * synthetic demo may use Vite on another loopback port without weakening a
 * deployed application.
 */
export function isTrustedBrowserOrigin(
  origin: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const url = new URL(normalized);
  // A production deployment must not authorize a credentialed browser origin
  // over clear-text HTTP unless it is its explicitly local offline endpoint.
  if (
    environment.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    !isLoopbackOrigin(normalized)
  ) {
    return false;
  }
  return (
    configuredBrowserOrigins(environment).has(normalized) ||
    (isDemoModeEnabled(environment) && isLoopbackOrigin(normalized))
  );
}
