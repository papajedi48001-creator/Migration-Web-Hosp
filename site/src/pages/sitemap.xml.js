import { getNews, getPages } from '../lib/directus.js';
import { newsHref } from '../lib/news.js';
import { href, pageHref } from '../lib/site.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function GET({ site }) {
	const [news, pages] = await Promise.all([getNews(), getPages()]);
	const urls = [
		{ loc: href('') },
		{ loc: href('news/') },
		...pages.map((p) => ({ loc: pageHref(p), lastmod: p.date_updated ?? p.date_created })),
		...news.map((n) => ({ loc: newsHref(n), lastmod: n.date_updated ?? n.date })),
	];
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(new URL(u.loc, site).href)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
