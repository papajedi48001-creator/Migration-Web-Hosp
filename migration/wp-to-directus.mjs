#!/usr/bin/env node
// ย้ายข่าว/หน้าเว็บ/ไฟล์จาก WordPress เดิม เข้า Directus ผ่าน REST API ทั้งสองฝั่ง
// - ฝั่ง WordPress อ่านอย่างเดียวผ่าน REST API (ไม่ต้องเข้า DB และไม่แก้อะไรบนเว็บเดิม)
//   ใช้รูป index.php?rest_route=... ซึ่งใช้ได้ทุกแบบ permalink (เว็บเดิมของ รพ. ไม่ได้เปิด pretty permalink ให้ /wp-json)
// - รันซ้ำได้: ข้ามรายการที่ wp_id มีอยู่แล้ว และจำไฟล์ที่อัปโหลดแล้วใน migration/out/media-map.json
//
//   WP_URL=https://waritch-hosp.moph.go.th \
//   DIRECTUS_URL=http://127.0.0.1:8055 ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_OTP=123456 \
//   node migration/wp-to-directus.mjs [--limit 20] [--only posts|pages] [--dry-run]
//
// ผลลัพธ์เพิ่มเติม: migration/out/redirects.map (ใส่ใน nginx ให้ลิงก์เดิมไม่เสีย), migration/out/report.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const WP = (process.env.WP_URL ?? '').replace(/\/+$/, '');
const DX = (process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055').replace(/\/+$/, '');
const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? (args[i + 1] ?? true) : undefined;
};
const LIMIT = Number(opt('limit') ?? Infinity);
const ONLY = opt('only');
const DRY = args.includes('--dry-run');
if (!WP) throw new Error('ตั้งค่า WP_URL');

// หมวด WordPress -> หมวดใน Directus (เทียบจากชื่อหมวด ปรับได้ตามเว็บจริง)
const CATEGORY_RULES = [
	[/จัดซื้อ|จัดจ้าง|ประกวดราคา|e-?bidding|ราคากลาง/i, 'procurement'],
	[/สมัครงาน|รับสมัคร|จ้างงาน|บุคลากร/i, 'jobs'],
	[/กิจกรรม|activity/i, 'activity'],
	[/ความรู้|สุขภาพ|health/i, 'health'],
];
const UPLOAD_RE = /https?:\/\/[^"'\s)]+\/wp-content\/uploads\/[^"'\s)?#]+/gi;
const ATTACH_EXT = /\.(pdf|docx?|xlsx?)$/i;

// ---------- helpers ----------
const wpApi = (route, params = {}) => `${WP}/index.php?${new URLSearchParams({ rest_route: route, ...params })}`;
let token, refreshToken;
async function dx(method, path, body, isForm = false, retried = false) {
	const res = await fetch(DX + path, {
		method,
		headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: isForm ? body : body ? JSON.stringify(body) : undefined,
	});
	// token อายุ 15 นาที (ACCESS_TOKEN_TTL) แต่การย้ายทั้งเว็บใช้นานกว่านั้น: ต่ออายุด้วย refresh token แล้วลองใหม่
	if (res.status === 401 && refreshToken && !retried) {
		const r = await fetch(`${DX}/auth/refresh`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ refresh_token: refreshToken, mode: 'json' }),
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(`ต่ออายุ token ไม่ได้ -> ${r.status} ${JSON.stringify(j.errors ?? j)}`);
		token = j.data.access_token;
		refreshToken = j.data.refresh_token;
		return dx(method, path, body, isForm, true);
	}
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.errors ?? json)}`);
	return json.data;
}
async function wpAll(type) {
	const items = [];
	for (let page = 1; ; page++) {
		const res = await fetch(wpApi(`/wp/v2/${type}`, { per_page: 100, page, orderby: 'id', order: 'asc' }));
		if (res.status === 400) break; // เกินหน้าสุดท้าย
		if (!res.ok) throw new Error(`WP ${type} page ${page} -> ${res.status}`);
		const batch = await res.json();
		items.push(...batch);
		const total = Number(res.headers.get('x-wp-totalpages') ?? 1);
		process.stdout.write(`\rอ่าน ${type} หน้า ${page}/${total}`);
		if (page >= total || items.length >= LIMIT) break;
	}
	process.stdout.write('\n');
	return items.slice(0, LIMIT);
}
const decode = (html = '') =>
	html
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();
// slug ที่หน้าเว็บใหม่ใช้เอง (ต้องตรงกับ RESERVED ใน site/src/lib/site.js)
const RESERVED = new Set(['news', 'search', 'media', 'pagefind', '_astro', 'preview', 'pages', '404', 'legacy', 'wp-content', 'wp-admin', 'assets', 'admin', 'auth']);
const asciiSlug = (slug) => {
	let s = slug;
	try {
		s = decodeURIComponent(slug);
	} catch {}
	s = s.toLowerCase();
	return /^[a-z0-9-]+$/.test(s) && s.length <= 120 && !RESERVED.has(s) ? s : null; // slug ภาษาไทยใช้ id แทน
};
const original = (url) => url.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1'); // รูปย่อของ WP -> รูปต้นฉบับ

// ---------- media ----------
let mediaMap = {};
const MEDIA_FILE = join(OUT, 'media-map.json');
let folderId = null;
async function importMedia(url, failures) {
	if (mediaMap[url]) return mediaMap[url];
	if (DRY) return (mediaMap[url] = `dry-${Object.keys(mediaMap).length}`);
	const candidates = original(url) !== url ? [original(url), url] : [url];
	for (const u of candidates) {
		if (mediaMap[u]) return (mediaMap[url] = mediaMap[u]);
		const res = await fetch(encodeURI(decodeURI(u)));
		if (!res.ok) continue;
		const blob = await res.blob();
		const name = decodeURIComponent(u.split('/').pop());
		const form = new FormData();
		if (folderId) form.append('folder', folderId);
		form.append('title', name.replace(/\.[^.]+$/, ''));
		form.append('file', blob, name);
		const file = await dx('POST', '/files', form, true);
		mediaMap[u] = mediaMap[url] = file.id;
		await writeFile(MEDIA_FILE, JSON.stringify(mediaMap, null, 1));
		return file.id;
	}
	failures.push(url);
	return null;
}
async function rewriteContent(html, failures) {
	const urls = [...new Set(html.match(UPLOAD_RE) ?? [])];
	const attachments = [];
	for (const url of urls) {
		const id = await importMedia(url, failures);
		if (!id) continue;
		html = html.split(url).join(`/assets/${id}`);
		if (ATTACH_EXT.test(url)) attachments.push(id);
	}
	html = html
		.replace(/\s(srcset|sizes)="[^"]*"/gi, '') // รูปย่อของ WP ไม่ใช้แล้ว
		.replace(/\s(class|style)="wp-[^"]*"/gi, '')
		.replace(/<!--\s*\/?wp:[^>]*-->/g, '') // คอมเมนต์ของ Gutenberg
		.replace(/\[\/?[a-z_]+[^\]]*\]/gi, ''); // shortcode ที่เหลือค้าง
	return { html, attachments: [...new Set(attachments)] };
}

// ---------- main ----------
await mkdir(OUT, { recursive: true });
try {
	mediaMap = JSON.parse(await readFile(MEDIA_FILE, 'utf8'));
} catch {}

if (!DRY) {
	const login = await dx('POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, mode: 'json', ...(process.env.ADMIN_OTP ? { otp: process.env.ADMIN_OTP } : {}) });
	token = login.access_token;
	refreshToken = login.refresh_token;
	const folders = await dx('GET', '/folders?filter[name][_eq]=wp-import&limit=1');
	folderId = folders[0]?.id ?? (await dx('POST', '/folders', { name: 'wp-import' })).id;
}

const report = { news: 0, pages: 0, skipped: 0, mediaFailures: [], redirects: 0 };
const redirects = [];
const existing = async (col) =>
	DRY ? new Map() : new Map((await dx('GET', `/items/${col}?fields=id,slug,wp_id&limit=-1&filter[wp_id][_nnull]=true`)).map((r) => [r.wp_id, r]));
const redirectsByP = [];
function addRedirect(collection, p, saved) {
	// nginx เทียบ $uri แบบ decode แล้ว จึงต้องเก็บ path ที่ decode (ภาษาไทยอ่านออก)
	let oldPath = new URL(p.link).pathname;
	try {
		oldPath = decodeURI(oldPath);
	} catch {}
	const newPath = collection === 'news' ? `/news/${saved.slug ?? saved.id}/` : `/${saved.slug ?? `pages/${saved.id}`}/`;
	if (oldPath !== newPath && oldPath !== '/') redirects.push(`"${oldPath}" ${newPath};`);
	redirectsByP.push(`${p.id} ${newPath};`);
}

const catNames = {};
if (ONLY !== 'pages') for (const c of await wpAll('categories')) catNames[c.id] = decode(c.name);

async function migrate(type, collection, toItem) {
	const have = await existing(collection);
	for (const p of await wpAll(type)) {
		if (have.has(p.id)) {
			report.skipped++;
			addRedirect(collection, p, have.get(p.id));
			continue;
		}
		const { html, attachments } = await rewriteContent(p.content?.rendered ?? '', report.mediaFailures);
		const item = await toItem(p, html, attachments);
		let saved;
		if (DRY) saved = { id: `dry-${p.id}`, slug: item.slug };
		else {
			try {
				saved = await dx('POST', `/items/${collection}`, item);
			} catch (err) {
				// slug ซ้ำกับรายการที่สร้างในหลังบ้านไว้แล้ว: ต่อท้ายด้วย id ของ WordPress
				if (!item.slug || !/RECORD_NOT_UNIQUE/.test(err.message) || !/"slug"/.test(err.message)) throw err;
				console.log(`\nslug "${item.slug}" ซ้ำ ใช้ "${item.slug}-${p.id}" แทน`);
				saved = await dx('POST', `/items/${collection}`, { ...item, slug: `${item.slug}-${p.id}` });
			}
		}
		report[collection]++;
		addRedirect(collection, p, saved);
		process.stdout.write(`\r${collection}: ${report[collection]}  `);
	}
	process.stdout.write('\n');
}

if (ONLY !== 'pages')
	await migrate('posts', 'news', async (p, html, attachments) => {
		const names = (p.categories ?? []).map((id) => catNames[id] ?? '').join(' ');
		const category = CATEGORY_RULES.find(([re]) => re.test(names))?.[1] ?? 'pr';
		let cover = null;
		if (p.featured_media) {
			const m = await fetch(wpApi(`/wp/v2/media/${p.featured_media}`)).then((r) => (r.ok ? r.json() : null));
			if (m?.source_url) cover = await importMedia(m.source_url, report.mediaFailures);
		}
		return {
			status: 'published',
			title: decode(p.title?.rendered) || '(ไม่มีหัวข้อ)',
			slug: asciiSlug(p.slug),
			published_at: p.date_gmt ? `${p.date_gmt}Z` : p.date,
			summary: decode(p.excerpt?.rendered).replace(/\s*\[…\]$|\s*\[&hellip;\]$/, '').slice(0, 500) || null,
			body: html,
			category,
			cover,
			attachments: attachments.map((id) => ({ directus_files_id: id })),
			wp_id: p.id,
			legacy_url: p.link,
		};
	});

if (ONLY !== 'posts')
	await migrate('pages', 'pages', async (p, html) => ({
		status: 'published',
		title: decode(p.title?.rendered) || '(ไม่มีชื่อ)',
		slug: asciiSlug(p.slug),
		body: html,
		wp_id: p.id,
		legacy_url: p.link,
	}));

report.redirects = redirects.length + redirectsByP.length;
const stamp = `# สร้างโดย wp-to-directus.mjs ${new Date().toISOString()}\n`;
await writeFile(join(OUT, 'redirects.map'), `${stamp}${redirects.join('\n')}\n`); // ลิงก์เดิม -> ลิงก์ใหม่
await writeFile(join(OUT, 'redirects-p.map'), `${stamp}${redirectsByP.join('\n')}\n`); // ?p=ID / ?page_id=ID -> ลิงก์ใหม่
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, mediaFailures: report.mediaFailures.length }, null, 2));
if (report.mediaFailures.length) console.log('ไฟล์ที่ดึงไม่ได้ดูใน migration/out/report.json');
