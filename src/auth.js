/**
 * Auth Middleware — Admin authentication and API config endpoint.
 * Extracted from server.js for modularity.
 */

/**
 * Basic Auth middleware for admin endpoints.
 * Reads credentials from ADMIN_USER and ADMIN_PASSWORD env vars.
 */
function basicAuth(req, res, next) {
    const adminUser = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASSWORD;

    if (!adminUser || !adminPass) {
        console.error('ADMIN_USER / ADMIN_PASSWORD env vars not set. Admin access disabled.');
        return res.status(503).send('Admin access not configured.');
    }

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === adminUser && password === adminPass) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Authentication required.');
}

/**
 * Register the /api/config endpoint on an Express app.
 * Returns ONLY the public anon key — never the service role key.
 * @param {import('express').Application} app
 */
function registerConfigEndpoint(app) {
    app.get('/api/config', (req, res) => {
        const anonKey = process.env.SUPABASE_ANON_KEY;
        if (!anonKey) {
            console.warn('/api/config: SUPABASE_ANON_KEY not set, falling back to SUPABASE_KEY');
        }
        res.json({
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: anonKey || process.env.SUPABASE_KEY
        });
    });
}

module.exports = {
    basicAuth,
    registerConfigEndpoint,
};
