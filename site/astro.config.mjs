// @ts-check
import { defineConfig } from 'astro/config';
import media from './src/integrations/media.mjs';

// SITE_PREVIEW=1: build ฉบับรวมร่าง สำหรับ :8443/preview/ (เห็นเฉพาะใน LAN)
const preview = process.env.SITE_PREVIEW === '1';

export default defineConfig({
	site: process.env.SITE_URL ?? 'https://waritch-hosp.moph.go.th',
	base: preview ? '/preview' : '/',
	outDir: process.env.SITE_OUT ?? './dist',
	trailingSlash: 'always',
	build: { format: 'directory', inlineStylesheets: 'never' },
	integrations: [media()],
	devToolbar: { enabled: false },
	// ไม่ฝัง script/รูปเล็กไว้ในหน้า เพื่อให้ใช้ CSP script-src 'self' ได้
	vite: { build: { assetsInlineLimit: 0 } },
});
