import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(ROOT, 'public/assets/models');
const MANIFEST_PATH = path.resolve(ROOT, 'public/assets/manifest.json');
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const CATEGORIES = new Set(['cars', 'enemies', 'weapons', 'pickups', 'environment']);

interface SaveAssetBody {
  category: string;
  assetId: string;
  fileName?: string;
  base64Glb?: string;
  config: Record<string, unknown>;
}

function sendJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/** Local dev middleware: writes uploaded .glb files to /public/assets/models and patches manifest.json. */
function localAssetSaver(): Plugin {
  return {
    name: 'local-asset-saver',
    configureServer(server) {
      server.middlewares.use('/api/save-asset', (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { status: 'error', message: 'Method Not Allowed' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            aborted = true;
            sendJson(res, 413, { status: 'error', message: 'Payload too large' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SaveAssetBody;
            const { category, assetId, fileName, base64Glb, config } = body;
            if (!CATEGORIES.has(category)) throw new Error(`Unknown category "${category}"`);
            if (!/^[a-z0-9_]+$/i.test(assetId)) throw new Error('Invalid assetId');
            if (typeof config !== 'object' || config === null) throw new Error('Missing config');

            const finalConfig: Record<string, unknown> = { ...config };
            if (base64Glb && fileName) {
              const safeName = path.basename(fileName).replace(/[^a-z0-9_.-]/gi, '_');
              if (!safeName.toLowerCase().endsWith('.glb')) throw new Error('Only .glb files are accepted');
              const targetPath = path.resolve(MODELS_DIR, safeName);
              if (!targetPath.startsWith(MODELS_DIR)) throw new Error('Invalid file path');
              fs.mkdirSync(MODELS_DIR, { recursive: true });
              fs.writeFileSync(targetPath, Buffer.from(base64Glb, 'base64'));
              finalConfig.url = `/assets/models/${safeName}`;
            }

            const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as Record<string, Record<string, unknown>>;
            manifest[category] = manifest[category] ?? {};
            manifest[category][assetId] = finalConfig;
            fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
            sendJson(res, 200, { status: 'saved', assetId, config: finalConfig });
          } catch (err) {
            sendJson(res, 400, { status: 'error', message: err instanceof Error ? err.message : String(err) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the project under /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [localAssetSaver(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    watch: { ignored: ['**/public/assets/**'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
