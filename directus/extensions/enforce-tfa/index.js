// Directus ใส่ claim "enforce_tfa" ใน token ของผู้ใช้ที่ policy บังคับ 2FA แต่ยังไม่ได้ตั้ง
// แต่ฝั่ง server ไม่ได้บล็อกอะไร (หน้า app แค่พาไปหน้าตั้ง 2FA) จึงยังเรียก API ด้วยรหัสผ่านอย่างเดียวได้
// hook นี้ปิดช่องนั้น: ระหว่างยังไม่ตั้ง 2FA ให้ทำได้แค่ อ่านข้อมูลระบบที่หน้า app ต้องใช้ + ตั้ง 2FA + logout
//
// token ถูก Directus ตรวจลายเซ็นแล้วใน middleware authenticate ก่อนถึงตรงนี้ (middlewares.after)
// ที่นี่จึงแค่อ่าน payload

const ALLOW = [
	// ตั้ง 2FA และจัดการ session
	{ method: 'POST', re: /^\/users\/me\/tfa\/(generate|enable)$/ },
	{ method: 'POST', re: /^\/auth\/(logout|refresh)$/ },
	{ method: 'PATCH', re: /^\/users\/me\/track\/page$/ },
	// ข้อมูลระบบที่หน้า app โหลดตอนเริ่ม (ไม่มีเนื้อหาเว็บ)
	{ method: 'GET', re: /^\/(auth|license|notifications|server\/.*|users\/me|roles\/me|policies\/me\/globals|permissions\/me|settings|extensions.*|translations.*|collections.*|fields.*|relations.*|presets.*)$/ },
	{ method: 'SEARCH', re: /^\/(translations|presets)$/ },
];

// ข้อมูลที่หน้า app โหลดสำหรับ admin แต่ไม่จำเป็นต่อการตั้ง 2FA: ตอบเป็นรายการว่าง (ไม่ให้เห็น flow ฯลฯ ก่อนตั้ง 2FA)
const EMPTY = /^\/(dashboards|panels|flows)$/;

function readToken(req) {
	const h = req.headers.authorization;
	if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
	const cookie = req.headers.cookie ?? '';
	const m = cookie.match(/(?:^|;\s*)directus_session_token=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

function payloadOf(token) {
	const parts = token.split('.');
	if (parts.length !== 3) return null; // static token ไม่ใช่ JWT
	try {
		return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
	} catch {
		return null;
	}
}

export default ({ init }, { logger, database }) => {
	init('middlewares.after', ({ app }) => {
		app.use(async (req, res, next) => {
			if (!req.accountability?.user) return next();
			const token = readToken(req);
			const payload = token ? payloadOf(token) : null;
			if (!payload?.enforce_tfa) return next();
			const path = req.path.replace(/\/+$/, '') || '/';
			if (ALLOW.some((a) => a.method === req.method && a.re.test(path))) return next();
			// token ยังมี claim เดิมจนกว่าจะ refresh: ถ้าเพิ่งตั้ง 2FA เสร็จ ให้ผ่าน
			try {
				const u = await database('directus_users').select('tfa_secret').where({ id: req.accountability.user }).first();
				if (u?.tfa_secret) return next();
			} catch (err) {
				return next(err);
			}
			if (req.method === 'GET' && EMPTY.test(path)) return res.json({ data: [] });
			logger.warn({ user: req.accountability.user, ip: req.accountability.ip, method: req.method, path }, 'enforce-tfa: blocked request before 2FA setup');
			res.status(403).json({
				errors: [{ message: 'ต้องตั้งค่า 2FA ก่อนใช้งาน (Two-factor authentication required)', extensions: { code: 'TFA_SETUP_REQUIRED' } }],
			});
		});
	});
};
