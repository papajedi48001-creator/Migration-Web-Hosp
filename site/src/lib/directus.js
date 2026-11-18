// ดึงข้อมูลจาก Directus ตอน build เท่านั้น (หน้าเว็บที่ได้เป็นไฟล์ static ไม่ติดต่อ Directus อีก)
// token เป็นของบัญชี "ระบบ build เว็บ" อ่านได้อย่างเดียว
// Directus รุ่นฟรีกรองสิทธิ์รายแถวไม่ได้ จึงกรอง status=published ที่นี่ (ยกเว้นตอน build preview)

const BASE = (process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_READ_TOKEN ?? '';
export const PREVIEW = process.env.SITE_PREVIEW === '1';

const cache = new Map();
const headers = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// จำกัดจำนวนคำขอพร้อมกัน และลองใหม่เมื่อ Directus ตอบ 429 (RATE_LIMITER ใน compose.yaml) หรือ 503 (แปลงรูปไม่ทัน)
// เว็บที่มีข่าวหลายพันข่าว build ครั้งแรกต้องดึงรูปหลายพันรูป ถ้าไม่รอจะล้มทั้ง build
const MAX_INFLIGHT = 6;
let inflight = 0;
const waiting = [];
async function slot(fn) {
	if (inflight >= MAX_INFLIGHT) await new Promise((r) => waiting.push(r));
	inflight++;
	try {
		return await fn();
	} finally {
		inflight--;
		waiting.shift()?.();
	}
}
async function request(path) {
	for (let attempt = 1; ; attempt++) {
		let res;
		try {
			res = await slot(() => fetch(BASE + path, { headers, signal: AbortSignal.timeout(120_000) }));
		} catch (err) {
			if (attempt >= 5) throw new Error(`Directus ${path} -> ${err.cause?.code ?? err.name}`);
			await sleep(1000 * attempt);
			continue;
		}
		if ((res.status === 429 || res.status === 503) && attempt < 10) {
			await res.body?.cancel();
			const after = Number(res.headers.get('retry-after'));
			await sleep(after > 0 ? after * 1000 : Math.min(500 * 2 ** attempt, 30_000));
			continue;
		}
		return res;
	}
}

export async function api(path) {
	if (!cache.has(path)) {
		cache.set(
			path,
			(async () => {
				const res = await request(path);
				if (!res.ok) throw new Error(`Directus ${path} -> ${res.status} ${await res.text()}`);
				return (await res.json()).data;
			})(),
		);
	}
	return cache.get(path);
}

export async function fetchRaw(path) {
	const res = await request(path);
	if (!res.ok) throw new Error(`Directus ${path} -> ${res.status}`);
	return res;
}

const onlyPublished = (rows) => (PREVIEW ? rows : rows.filter((r) => r.status === 'published'));

export const CATEGORIES = {
	pr: 'ข่าวประชาสัมพันธ์',
	procurement: 'ข่าวจัดซื้อจัดจ้าง',
	jobs: 'รับสมัครงาน',
	activity: 'กิจกรรม',
	health: 'ความรู้สุขภาพ',
};

export async function getSettings() {
	return (await api('/items/site_settings')) ?? {};
}

export async function getNews() {
	const rows = await api(
		'/items/news?limit=-1&sort=-published_at,-id&fields=*,attachments.directus_files_id.id,attachments.directus_files_id.title,attachments.directus_files_id.filename_download,attachments.directus_files_id.type,attachments.directus_files_id.filesize',
	);
	const news = onlyPublished(rows).map((n) => ({
		...n,
		date: n.published_at ?? n.date_created,
		files: (n.attachments ?? []).map((a) => a.directus_files_id).filter(Boolean),
	}));
	// ข่าวในอนาคต (ตั้งวันที่ประกาศล่วงหน้า) ยังไม่แสดง ยกเว้น preview
	const now = Date.now();
	return news.filter((n) => PREVIEW || !n.date || new Date(n.date).getTime() <= now);
}

export async function getPages() {
	return onlyPublished(await api('/items/pages?limit=-1&sort=sort,id'));
}

export async function getBanners() {
	const now = Date.now();
	return onlyPublished(await api('/items/banners?limit=-1&sort=sort,id')).filter(
		(b) => (!b.show_from || new Date(b.show_from).getTime() <= now) && (!b.show_until || new Date(b.show_until).getTime() >= now),
	);
}

// ลิงก์ของข่าว/หน้าเว็บ ต้องตรงกับที่ migration/wp-to-directus.mjs ใช้สร้าง redirect
// preview ใช้ id เสมอ เพราะ preview URL ในหลังบ้านอ้างด้วย id
export const newsKey = (n) => String(PREVIEW ? n.id : (n.slug ?? n.id));
export const pageKey = (p) => (PREVIEW || !p.slug ? `pages/${p.id}` : p.slug);

const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
export const thaiDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
