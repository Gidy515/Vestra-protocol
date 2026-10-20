import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function vercelConfig(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname.endsWith('.onrender.com'))
    throw new Error('Provide the Render HTTPS service origin, without a path or credentials');
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: 'vite',
    installCommand: 'npm ci && npm --prefix app ci',
    buildCommand: 'npm run app:build',
    outputDirectory: 'app/dist',
    rewrites: [{source:'/api/:path*', destination: `${url.origin}/api/:path*`}],
    headers: [{source:'/api/:path*', headers:[{key:'Cache-Control', value:'no-store'}]}],
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const config = vercelConfig(process.argv[2]);
  fs.writeFileSync('vercel.json', JSON.stringify(config, null, 2) + '\n');
  console.log('Configured Vercel frontend and API rewrite. No keys or private RPC URLs are included.');
}
