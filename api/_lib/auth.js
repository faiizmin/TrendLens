export class AuthConfigurationError extends Error {}

export function createClerkAuthenticator({
  secretKey = process.env.CLERK_SECRET_KEY,
  publishableKey = process.env.CLERK_PUBLISHABLE_KEY,
  authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES || '').split(',').map((value) => value.trim()).filter(Boolean),
  createClient,
} = {}) {
  return async function authenticate(req) {
    if (!secretKey || !publishableKey || authorizedParties.length === 0) {
      throw new AuthConfigurationError('Authentication is not configured.');
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const requestHeaders = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) requestHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    }
    const request = new Request(`${protocol}://${host}${req.url || '/'}`, {
      method: req.method || 'GET',
      headers: requestHeaders,
    });
    const makeClient = createClient || (await import('@clerk/backend')).createClerkClient;
    const client = makeClient({ secretKey, publishableKey });
    const state = await client.authenticateRequest(request, { authorizedParties });
    if (!state.isAuthenticated) return null;
    const auth = state.toAuth();
    return auth.userId ? { clerkUserId: auth.userId } : null;
  };
}

export function createProtectedHandler({ authenticate, handle, method }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (method && req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    let identity;
    try {
      identity = await authenticate(req);
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        return res.status(503).json({ error: 'auth_not_configured' });
      }
      return res.status(401).json({ error: 'invalid_session' });
    }
    if (!identity) return res.status(401).json({ error: 'unauthenticated' });
    try {
      return await handle(identity, req, res);
    } catch {
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}
