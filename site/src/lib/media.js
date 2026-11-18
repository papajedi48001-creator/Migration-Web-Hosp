// คัดลอกรูปและไฟล์แนบจาก Directus มาเป็นไฟล์ static ใน /media/ ของเว็บ
// เพื่อไม่ต้องเปิด /assets ของ Directus ให้คนนอก
// - ดาวน์โหลดเก็บใน CACHE_DIR (build ครั้งต่อไปใช้ซ้ำ ไม่โหลดใหม่)
// - ชื่อไฟล์มีรหัสเวอร์ชัน (จากเวลาแก้ไขไฟล์) ถ้าเปลี่ยนรูปใน Directus ชื่อจะเปลี่ยนตาม จึงตั้ง cache ยาวได้
// - จดชื่อไฟล์ที่หน้าเว็บใช้จริงลง .cache/used.txt ให้ integration คัดลอกเฉพาะไฟล์เหล่านั้นไป dist/media
//   ไฟล์ที่ถูกลบออกจากหลังบ้านจึงหายจากเว็บด้วย
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { api, fetchRaw } from './directus.js';
import { CACHE_DIR, USED_FILE } from './paths.js';
const BASE = import.meta.env.BASE_URL; // "/" หรือ "/preview/"
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const inflight = new Map();

// ข้อมูลไฟล์ทั้งหมดดึงครั้งเดียว (เว็บที่มีหลายพันไฟล์ ถ้าถามทีละไฟล์จะเป็นหลายพันคำขอ)
let allFiles;
async function fileMeta(id) {
	allFiles ??= api('/files?limit=-1&fields=id,type,filename_download,title,width,height,uploaded_on,modified_on').then(
		(rows) => new Map(rows.map((f) => [f.id, f])),
	);
	return (await allFiles).get(id) ?? null; // ไม่มี = ไฟล์ถูกลบไปแล้ว
}

const extOf = (name = '') => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'bin').toLowerCase();

/**
 * คืน URL ของไฟล์บนเว็บ static
 * preset: thumb | banner | content (ตั้งไว้ใน bootstrap) ใช้กับรูปเท่านั้น ได้ไฟล์ webp ที่ย่อแล้ว
 */
export async function mediaUrl(id, preset) {
	if (!id) return null;
	const key = `${id}:${preset ?? ''}`;
	if (!inflight.has(key)) inflight.set(key, download(id, preset));
	const name = await inflight.get(key);
	if (!name) return null;
	appendFileSync(USED_FILE, name + '\n');
	return `${BASE}media/${name}`;
}

async function download(id, preset) {
	const meta = await fileMeta(id);
	if (!meta) return null;
	const isRaster = meta.type?.startsWith('image/') && meta.type !== 'image/svg+xml' && meta.type !== 'image/gif';
	const ver = createHash('sha256').update(`${meta.uploaded_on}|${meta.modified_on}`).digest('hex').slice(0, 8);
	const original = `${id}-${ver}.${extOf(meta.filename_download)}`;
	if (preset && isRaster) {
		const name = `${id}-${ver}-${preset}.webp`;
		if (await save(name, `/assets/${id}?key=${preset}`)) return name;
		// ย่อรูปไม่ได้ (เช่น รูปใหญ่เกิน ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION หรือไฟล์เสียจากเว็บเดิม): ใช้ไฟล์ต้นฉบับแทน
		console.warn(`[media] ย่อรูป ${id} (${meta.filename_download}) ไม่ได้ ใช้ไฟล์ต้นฉบับแทน`);
	}
	if (await save(original, `/assets/${id}`)) return original;
	console.warn(`[media] ดึงไฟล์ ${id} (${meta.filename_download}) ไม่ได้ ข้ามไฟล์นี้`);
	return null;
}

// ดาวน์โหลดเก็บใน cache คืน false เมื่อ Directus ปฏิเสธไฟล์นี้ (4xx) ส่วนปัญหาอื่น (Directus ล่ม) ยังให้ build ล้ม
const rejected = new Set();
async function save(name, path) {
	mkdirSync(CACHE_DIR, { recursive: true });
	const dest = join(CACHE_DIR, name);
	if (existsSync(dest)) return true;
	if (rejected.has(path)) return false;
	try {
		const res = await fetchRaw(path);
		writeFileSync(dest + '.part', Buffer.from(await res.arrayBuffer()));
		renameSync(dest + '.part', dest); // build ที่ล้มกลางทางจะไม่ทิ้งไฟล์ครึ่ง ๆ ไว้
		return true;
	} catch (err) {
		if (!/-> (400|404|415|422)$/.test(err.message)) throw err; // 401/403 = token มีปัญหา ต้องล้ม
		rejected.add(path);
		return false;
	}
}

export async function fileInfo(file) {
	return { url: await mediaUrl(file.id), title: file.title || file.filename_download, filename: file.filename_download, ext: extOf(file.filename_download).toUpperCase(), size: file.filesize };
}

/** เนื้อหาจาก editor: เปลี่ยนลิงก์ /assets/<id> เป็นไฟล์ static แล้วกรอง HTML ที่ไม่ปลอดภัยออก */
export async function renderBody(html) {
	if (!html) return '';
	const re = new RegExp(`(?:https?://[^"'\\s]*?)?/assets/(${UUID})(?:\\?[^"'\\s]*)?`, 'gi');
	const ids = [...new Set([...html.matchAll(re)].map((m) => m[1]))];
	const map = {};
	for (const id of ids) {
		const meta = await fileMeta(id);
		map[id] = await mediaUrl(id, meta?.type?.startsWith('image/') ? 'content' : undefined);
	}
	html = html.replace(re, (_, id) => map[id] ?? '#');
	return sanitizeHtml(html, {
		allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'figure', 'figcaption', 'iframe', 'h2', 'h3', 'h4']),
		allowedAttributes: {
			a: ['href', 'target', 'rel', 'title'],
			img: ['src', 'alt', 'width', 'height', 'loading', 'title'],
			iframe: ['src', 'width', 'height', 'allowfullscreen', 'title'],
			td: ['colspan', 'rowspan'],
			th: ['colspan', 'rowspan', 'scope'],
			'*': ['style'],
		},
		allowedStyles: { '*': { 'text-align': [/^(left|right|center|justify)$/] } },
		allowedSchemes: ['https', 'mailto', 'tel'],
		allowedSchemesByTag: { img: [] }, // รูปต้องเป็นไฟล์ในเว็บเท่านั้น (ลิงก์ภายนอกถูกตัด)
		allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'www.google.com', 'www.facebook.com'],
		transformTags: {
			a: (tag, attribs) => ({ tagName: 'a', attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs }),
			img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy' } }),
		},
	});
}
