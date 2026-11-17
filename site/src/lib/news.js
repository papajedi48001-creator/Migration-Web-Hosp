// ตัวช่วยสำหรับรายการข่าว
import { CATEGORIES, newsKey, thaiDate } from './directus.js';
import { mediaUrl } from './media.js';
import { href } from './site.js';

export const PER_PAGE = 12;
export const newsHref = (n) => href(`news/${newsKey(n)}/`);
export const catHref = (cat, page = 1) => href(`news/${cat ? `category/${cat}/` : ''}${page > 1 ? `page/${page}/` : ''}`);

/** ข้อมูลที่การ์ดข่าวใช้: ลิงก์ หมวด วันที่ รูป */
export async function card(n, preset = 'thumb') {
	return {
		id: n.id,
		title: n.title,
		summary: n.summary,
		href: newsHref(n),
		cat: CATEGORIES[n.category] ?? '',
		date: thaiDate(n.date),
		iso: n.date ? new Date(n.date).toISOString() : undefined,
		pinned: !!n.pinned,
		draft: n.status !== 'published',
		img: n.cover ? await mediaUrl(n.cover, preset) : null,
		fileType: n.files?.[0] ? (n.files[0].filename_download?.split('.').pop() ?? '').toUpperCase() : null,
	};
}

/** ปักหมุดก่อน แล้วเรียงตามวันที่ (getNews เรียงวันที่มาแล้ว) */
export const pinnedFirst = (list) => [...list.filter((n) => n.pinned), ...list.filter((n) => !n.pinned)];
