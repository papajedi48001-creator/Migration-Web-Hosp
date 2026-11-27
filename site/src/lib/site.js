// ข้อมูลที่ทุกหน้าใช้ร่วมกัน: ข้อมูลโรงพยาบาล, เมนู, ลิงก์ภายในเว็บ
import { getPages, getSettings, pageKey } from './directus.js';

const BASE = import.meta.env.BASE_URL; // "/" หรือ "/preview/"

/** ลิงก์ภายในเว็บ (รองรับ base /preview/) */
export const href = (path = '') => BASE + String(path).replace(/^\/+/, '');

// slug ที่ระบบใช้เอง หน้าเว็บที่ตั้ง slug ซ้ำจะใช้ /pages/<id>/ แทน
export const RESERVED = new Set(['news', 'search', 'media', 'pagefind', '_astro', 'preview', 'pages', '404', 'legacy', 'wp-content', 'wp-admin', 'wp-login.php', 'assets', 'admin', 'auth']);
export const safePageKey = (p) => (RESERVED.has(p.slug) ? `pages/${p.id}` : pageKey(p));
export const pageHref = (p) => href(`${safePageKey(p)}/`);

export const MENU_GROUPS = [
	{ value: 'about', label: 'เกี่ยวกับโรงพยาบาล' },
	{ value: 'services', label: 'บริการ' },
	{ value: 'patients', label: 'สำหรับผู้ป่วย' },
	{ value: 'news', label: 'ข่าวสาร' },
	{ value: 'ita', label: 'ITA' },
	{ value: 'contact', label: 'ติดต่อ' },
];

export async function getSite() {
	const [settings, pages] = await Promise.all([getSettings(), getPages()]);
	const name = settings.hospital_name || 'โรงพยาบาลวาริชภูมิ';
	const nav = [{ label: 'หน้าแรก', href: href('') }];
	for (const g of MENU_GROUPS) {
		if (g.value === 'news') {
			nav.push({ label: g.label, href: href('news/') });
			continue;
		}
		const items = pages.filter((p) => p.menu_group === g.value).map((p) => ({ label: p.title, href: pageHref(p) }));
		if (items.length === 1) nav.push({ label: g.label, href: items[0].href });
		else if (items.length > 1) nav.push({ label: g.label, items });
		else if (g.value === 'contact') nav.push({ label: g.label, href: href('#contact') });
	}
	return { settings, pages, name, nav };
}

/** ข้อความหลายบรรทัดจากหลังบ้าน -> ตัด tag ทิ้ง (แสดงด้วย white-space: pre-line) */
export const plain = (s) => (s ?? '').replace(/<[^>]*>/g, '').trim();

/** ลิงก์ที่กรอกในหลังบ้าน: อนุญาตเฉพาะ http(s), tel:, mailto: และลิงก์ภายในเว็บ */
export function safeLink(url) {
	if (!url) return null;
	const u = String(url).trim();
	if (/^(https?:|tel:|mailto:)/i.test(u)) return u;
	if (u.startsWith('/') && !u.startsWith('//')) return href(u);
	return null;
}

export const telHref = (phone) => (phone ? `tel:${String(phone).split(/[,/]/)[0].replace(/[^\d+]/g, '')}` : null);

// ส่วนในหน้าแรกที่เจ้าหน้าที่เรียงลำดับได้ในหลังบ้าน (ช่อง home_sections ของข้อมูลโรงพยาบาล)
// ชื่อภาษาไทยต้องตรงกับ HOME_SECTION_NAMES ใน directus/bootstrap.mjs
export const HOME_SECTIONS = {
	ข่าวสาร: 'news',
	ประกาศจัดซื้อจัดจ้าง: 'procurement',
	บริการสำหรับผู้ป่วย: 'services',
	ติดต่อโรงพยาบาล: 'contact',
};

/**
 * ลำดับส่วนในหน้าแรกจากค่าที่ตั้งในหลังบ้าน
 * - ข้ามชื่อที่ไม่รู้จักและชื่อซ้ำ, ส่วนที่ปิด "แสดง" ถูกซ่อน
 * - ส่วนที่ไม่มีในรายการ (เช่น เผลอลบแถว หรือยังไม่ได้ตั้ง) ต่อท้ายตามลำดับเริ่มต้น
 */
export function homeSections(value) {
	let rows = value;
	if (typeof rows === 'string') {
		try {
			rows = JSON.parse(rows);
		} catch {
			rows = null;
		}
	}
	const order = [];
	const seen = new Set();
	for (const r of Array.isArray(rows) ? rows : []) {
		const key = HOME_SECTIONS[String(r?.section ?? '').trim()];
		if (!key || seen.has(key)) continue;
		seen.add(key);
		if (r.show !== false) order.push(key);
	}
	for (const key of Object.values(HOME_SECTIONS)) if (!seen.has(key)) order.push(key);
	return order;
}
