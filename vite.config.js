import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Serve netlify/functions/* at /api/* during `npm run dev`, so the app works
// locally without the Netlify CLI. (Rate limits and Blobs caching only apply on Netlify.)
function netlifyFunctionsInDev() {
  const routes = { '/api/geocode': 'geocode.mjs', '/api/getNarrative': 'getNarrative.mjs' };
  return {
    name: 'netlify-functions-in-dev',
    configureServer(server) {
      for (const [route, file] of Object.entries(routes)) {
        server.middlewares.use(route, async (req, res) => {
          try {
            const url = pathToFileURL(path.resolve('netlify/functions', file)).href;
            const { default: handler } = await import(`${url}?t=${Date.now()}`);
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const request = new Request(`http://localhost${route}`, {
              method: req.method,
              headers: req.headers,
              body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
            });
            const response = await handler(request);
            res.statusCode = response.status;
            response.headers.forEach((v, k) => res.setHeader(k, v));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (err) {
            server.config.logger.error(`${route}: ${err.stack}`);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'dev_server_error' }));
          }
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Expose .env values (MAPBOX_TOKEN, OPENROUTER_API_KEY) to the dev functions only
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [react(), netlifyFunctionsInDev()] };
});
