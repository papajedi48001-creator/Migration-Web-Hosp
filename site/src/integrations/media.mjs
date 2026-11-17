// นำเฉพาะไฟล์จาก Directus ที่หน้าเว็บใช้จริง (.cache/used.txt) ไปไว้ที่ dist/media
// ใช้ hardlink ถ้าได้ (ไม่กินพื้นที่ซ้ำในแต่ละ release) ไม่ได้ก็คัดลอก
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_DIR, USED_FILE } from '../lib/paths.js';

export default function media() {
	return {
		name: 'hospweb-media',
		hooks: {
			'astro:build:start': () => {
				mkdirSync(dirname(USED_FILE), { recursive: true });
				rmSync(USED_FILE, { force: true });
			},
			'astro:build:done': ({ dir, logger }) => {
				const out = join(fileURLToPath(dir), 'media');
				mkdirSync(out, { recursive: true });
				const names = existsSync(USED_FILE) ? [...new Set(readFileSync(USED_FILE, 'utf8').split('\n').filter(Boolean))] : [];
				let linked = 0;
				for (const name of names) {
					const src = join(CACHE_DIR, name);
					const dest = join(out, name);
					// จดเวลาใช้ล่าสุดไว้ที่ atime (ไฟล์ที่ไม่ได้ใช้นานจะถูกลบจาก cache โดย build-site.sh)
					// mtime ต้องคงเดิม เพื่อให้ rsync --link-dest รู้ว่าเป็นไฟล์เดิมแล้วใช้ hardlink
					utimesSync(src, new Date(), statSync(src).mtime);
					try {
						linkSync(src, dest);
						linked++;
					} catch {
						copyFileSync(src, dest);
					}
				}
				logger.info(`ไฟล์จาก Directus ${names.length} ไฟล์ (hardlink ${linked})`);
			},
		},
	};
}
