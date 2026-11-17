import { PREVIEW } from '../lib/directus.js';

export function GET({ site }) {
	const body = PREVIEW ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nDisallow: /search/\nSitemap: ${new URL('sitemap.xml', site).href}\n`;
	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
