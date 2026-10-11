export function createHealthHandler({ getConnectionString, queryDatabase }) {
  return async function healthHandler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ ok: false });
    }

    const connectionString = getConnectionString();
    if (!connectionString) {
      return response.status(503).json({ ok: false, status: 'not_configured' });
    }

    try {
      await queryDatabase(connectionString);
      return response.status(200).json({ ok: true, status: 'connected' });
    } catch {
      // Intentionally do not return or log driver errors: they can contain host details.
      return response.status(503).json({ ok: false, status: 'unavailable' });
    }
  };
}
