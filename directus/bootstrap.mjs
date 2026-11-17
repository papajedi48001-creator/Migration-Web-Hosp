#!/usr/bin/env node
// ตั้งค่า Directus ให้พร้อมใช้: ภาษาไทย, ตารางเนื้อหา, role/สิทธิ์, บังคับ 2FA, จำกัด IP
// รันซ้ำได้ (ข้ามสิ่งที่มีอยู่แล้ว)
//
//   DIRECTUS_URL=http://127.0.0.1:8055 ADMIN_EMAIL=... ADMIN_PASSWORD=... node directus/bootstrap.mjs
//
// ตัวแปรเสริม
//   LAN_CIDRS     ช่วง IP ที่ให้เข้าหลังบ้านได้ (ค่าเริ่ม: 192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,127.0.0.1)
//   PREVIEW_URL   URL ของ preview server ของ Astro เช่น https://waritch-hosp.moph.go.th:8443/preview
//   ENFORCE_TFA   "false" เพื่อปิดการบังคับ 2FA ชั่วคราวตอนทดสอบ (ค่าเริ่ม: true)

const URL_ = process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055';
const LAN = (process.env.LAN_CIDRS ?? '192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,127.0.0.1').split(',').map((s) => s.trim());
const PREVIEW = process.env.PREVIEW_URL ?? '';
const ENFORCE_TFA = process.env.ENFORCE_TFA !== 'false';

let token;
async function api(method, path, body) {
	const res = await fetch(URL_ + path, {
		method,
		headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.errors ?? json)}`);
	return json.data;
}
const th = (s) => [{ language: 'th-TH', translation: s }];

// ---------- ตารางเนื้อหา ----------
const statusField = {
	field: 'status',
	type: 'string',
	schema: { default_value: 'draft', is_nullable: false },
	meta: {
		width: 'half',
		interface: 'select-dropdown',
		display: 'labels',
		translations: th('สถานะ'),
		options: { choices: [{ text: 'เผยแพร่', value: 'published' }, { text: 'ฉบับร่าง (ยังไม่แสดงบนเว็บ)', value: 'draft' }] },
		display_options: {
			choices: [
				{ text: 'เผยแพร่', value: 'published', foreground: '#FFFFFF', background: '#2E7D32' },
				{ text: 'ฉบับร่าง', value: 'draft', foreground: '#18222F', background: '#D3DAE4' },
			],
		},
	},
};
const titleField = (label = 'หัวข้อ') => ({
	field: 'title',
	type: 'string',
	schema: { is_nullable: false },
	meta: { interface: 'input', required: true, width: 'full', translations: th(label) },
});
const slugField = {
	field: 'slug',
	type: 'string',
	schema: { is_unique: true },
	meta: {
		interface: 'input',
		width: 'half',
		translations: th('ชื่อในลิงก์ (ภาษาอังกฤษ)'),
		note: 'เว้นว่างได้ ระบบจะใช้รหัสข่าวแทน',
		options: { slug: true, trim: true },
	},
};
const bodyField = {
	field: 'body',
	type: 'text',
	meta: {
		interface: 'input-rich-text-html',
		width: 'full',
		translations: th('เนื้อหา'),
		options: {
			toolbar: ['bold', 'italic', 'underline', 'h2', 'h3', 'numlist', 'bullist', 'alignleft', 'aligncenter', 'link', 'image', 'media', 'table', 'removeformat', 'fullscreen'],
			folder: null,
		},
	},
};
const imageField = (field, label, note) => ({
	field,
	type: 'uuid',
	schema: {},
	meta: { interface: 'file-image', special: ['file'], width: 'half', translations: th(label), note, options: { crop: false } },
});
const dateField = (field, label, width = 'half') => ({
	field,
	type: 'timestamp',
	schema: {},
	meta: { interface: 'datetime', width, translations: th(label) },
});
const systemFields = [
	{ field: 'date_created', type: 'timestamp', meta: { special: ['date-created'], hidden: true, readonly: true } },
	{ field: 'date_updated', type: 'timestamp', meta: { special: ['date-updated'], hidden: true, readonly: true } },
	{ field: 'user_created', type: 'uuid', meta: { special: ['user-created'], hidden: true, readonly: true } },
	{ field: 'user_updated', type: 'uuid', meta: { special: ['user-updated'], hidden: true, readonly: true } },
];
const legacyFields = [
	{ field: 'wp_id', type: 'integer', meta: { hidden: true, readonly: true, note: 'id เดิมใน WordPress (ใช้ทำ redirect)' } },
	{ field: 'legacy_url', type: 'string', schema: { max_length: 1000 }, meta: { hidden: true, readonly: true } },
];

const NEWS_CATEGORIES = [
	{ text: 'ข่าวประชาสัมพันธ์', value: 'pr' },
	{ text: 'ข่าวจัดซื้อจัดจ้าง', value: 'procurement' },
	{ text: 'รับสมัครงาน', value: 'jobs' },
	{ text: 'กิจกรรม', value: 'activity' },
	{ text: 'ความรู้สุขภาพ', value: 'health' },
];

const collections = [
	{
		collection: 'news',
		meta: {
			icon: 'newspaper',
			translations: [{ language: 'th-TH', translation: 'ข่าว', singular: 'ข่าว', plural: 'ข่าว' }],
			sort: 1,
			archive_field: 'status',
			archive_value: 'draft',
			unarchive_value: 'published',
			display_template: '{{title}}',
			preview_url: PREVIEW ? `${PREVIEW}/news/{{id}}` : null,
		},
		fields: [
			statusField,
			{
				field: 'category',
				type: 'string',
				schema: { default_value: 'pr' },
				meta: { interface: 'select-dropdown', display: 'labels', width: 'half', translations: th('หมวด'), options: { choices: NEWS_CATEGORIES } },
			},
			titleField(),
			dateField('published_at', 'วันที่ประกาศ'),
			slugField,
			imageField('cover', 'รูปหน้าปก', 'ใช้แสดงในหน้ารวมข่าว'),
			{ field: 'summary', type: 'text', meta: { interface: 'input-multiline', width: 'full', translations: th('สรุปสั้น ๆ'), note: 'ไม่เกิน 2 บรรทัด ใช้แสดงในหน้ารวมข่าวและตอนแชร์ Facebook' } },
			bodyField,
			{ field: 'pinned', type: 'boolean', schema: { default_value: false }, meta: { interface: 'boolean', width: 'half', translations: th('ปักหมุดไว้บนสุด') } },
			...legacyFields,
			...systemFields,
		],
	},
	{
		collection: 'pages',
		meta: {
			icon: 'description',
			translations: [{ language: 'th-TH', translation: 'หน้าเว็บ', singular: 'หน้าเว็บ', plural: 'หน้าเว็บ' }],
			sort: 2,
			sort_field: 'sort',
			display_template: '{{title}}',
			preview_url: PREVIEW ? `${PREVIEW}/pages/{{id}}` : null,
		},
		fields: [
			statusField,
			{ field: 'sort', type: 'integer', meta: { hidden: true } },
			titleField('ชื่อหน้า'),
			{ ...slugField, meta: { ...slugField.meta, note: 'เช่น about, services, contact' } },
			{
				field: 'menu_group',
				type: 'string',
				meta: {
					interface: 'select-dropdown',
					width: 'half',
					translations: th('อยู่ในเมนู'),
					options: {
						allowNone: true,
						choices: [
							{ text: 'เกี่ยวกับโรงพยาบาล', value: 'about' },
							{ text: 'บริการ', value: 'services' },
							{ text: 'สำหรับผู้ป่วย', value: 'patients' },
							{ text: 'ITA / ความโปร่งใส', value: 'ita' },
							{ text: 'ติดต่อ', value: 'contact' },
						],
					},
				},
			},
			bodyField,
			...legacyFields,
			...systemFields,
		],
	},
	{
		collection: 'banners',
		meta: {
			icon: 'view_carousel',
			translations: [{ language: 'th-TH', translation: 'แบนเนอร์หน้าแรก', singular: 'แบนเนอร์', plural: 'แบนเนอร์' }],
			sort: 3,
			sort_field: 'sort',
			display_template: '{{title}}',
		},
		fields: [
			statusField,
			{ field: 'sort', type: 'integer', meta: { hidden: true } },
			titleField('ชื่อแบนเนอร์ (ใช้เป็นคำอธิบายรูปด้วย)'),
			imageField('image', 'รูปแบนเนอร์', 'แนะนำ 1920×640 px'),
			{ field: 'link', type: 'string', meta: { interface: 'input', width: 'half', translations: th('ลิงก์เมื่อกด (ไม่ใส่ก็ได้)') } },
			dateField('show_from', 'เริ่มแสดง'),
			dateField('show_until', 'หยุดแสดง'),
			...systemFields,
		],
	},
	{
		collection: 'site_settings',
		meta: {
			icon: 'settings',
			singleton: true,
			translations: [{ language: 'th-TH', translation: 'ข้อมูลโรงพยาบาล', singular: 'ข้อมูลโรงพยาบาล', plural: 'ข้อมูลโรงพยาบาล' }],
			sort: 4,
		},
		fields: [
			{ field: 'hospital_name', type: 'string', meta: { interface: 'input', width: 'full', translations: th('ชื่อโรงพยาบาล') } },
			{ field: 'phone', type: 'string', meta: { interface: 'input', width: 'half', translations: th('เบอร์โทร') } },
			{ field: 'emergency_phone', type: 'string', meta: { interface: 'input', width: 'half', translations: th('เบอร์ฉุกเฉิน') } },
			{ field: 'address', type: 'text', meta: { interface: 'input-multiline', width: 'full', translations: th('ที่อยู่') } },
			{ field: 'opening_hours', type: 'text', meta: { interface: 'input-multiline', width: 'full', translations: th('เวลาทำการ') } },
			{ field: 'facebook_url', type: 'string', meta: { interface: 'input', width: 'half', translations: th('Facebook') } },
			{ field: 'line_url', type: 'string', meta: { interface: 'input', width: 'half', translations: th('LINE OA') } },
			{ field: 'map_url', type: 'string', meta: { interface: 'input', width: 'full', translations: th('ลิงก์ Google Maps') } },
			{ field: 'director_name', type: 'string', meta: { interface: 'input', width: 'half', translations: th('ชื่อผู้อำนวยการ'), note: 'แสดงข้างแบนเนอร์หน้าแรก' } },
			{ field: 'director_title', type: 'string', schema: { default_value: 'ผู้อำนวยการโรงพยาบาลวาริชภูมิ' }, meta: { interface: 'input', width: 'half', translations: th('ตำแหน่ง') } },
			imageField('director_photo', 'รูปผู้อำนวยการ', 'แนวตั้ง แนะนำ 600×800 px'),
			{ field: 'announcement', type: 'text', meta: { interface: 'input-multiline', width: 'full', translations: th('ข้อความแจ้งเตือนด่วน (แถบบนสุดของเว็บ)'), note: 'เว้นว่างเมื่อไม่ต้องการแสดง' } },
		],
	},
];

const CONTENT = collections.map((c) => c.collection);

// ไฟล์แนบของข่าว (หลายไฟล์ เช่น PDF ประกาศจัดซื้อ)
async function ensureNewsAttachments(existingFields) {
	const existsJunction = (await api('GET', '/collections')).some((c) => c.collection === 'news_files');
	if (!existsJunction) {
		await api('POST', '/collections', {
			collection: 'news_files',
			meta: { hidden: true, icon: 'import_export' },
			schema: {},
			fields: [
				{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: { hidden: true } },
				{ field: 'news_id', type: 'integer', meta: { hidden: true } },
				{ field: 'directus_files_id', type: 'uuid', meta: { hidden: true } },
				{ field: 'sort', type: 'integer', meta: { hidden: true } },
			],
		});
	}
	if (!existingFields.has('news.attachments')) {
		await api('POST', '/fields/news', {
			field: 'attachments',
			type: 'alias',
			meta: { interface: 'files', special: ['files'], width: 'full', translations: th('ไฟล์แนบ (PDF, Word, Excel)') },
		});
		await api('POST', '/relations', {
			collection: 'news_files',
			field: 'news_id',
			related_collection: 'news',
			meta: { one_field: 'attachments', junction_field: 'directus_files_id', sort_field: 'sort' },
			schema: { on_delete: 'CASCADE' },
		});
		await api('POST', '/relations', {
			collection: 'news_files',
			field: 'directus_files_id',
			related_collection: 'directus_files',
			meta: { one_field: null, junction_field: 'news_id' },
			schema: { on_delete: 'CASCADE' },
		});
		console.log('+ news.attachments');
	}
}

async function ensureCollections() {
	const have = new Set((await api('GET', '/collections')).map((c) => c.collection));
	for (const c of collections) {
		if (have.has(c.collection)) {
			// ตารางมีอยู่แล้ว: เพิ่มเฉพาะช่องใหม่ที่ยังไม่มี
			const existing = new Set((await api('GET', `/fields/${c.collection}`)).map((f) => f.field));
			for (const f of c.fields.filter((f) => !existing.has(f.field))) {
				await api('POST', `/fields/${c.collection}`, f);
				console.log(`+ ${c.collection}.${f.field}`);
			}
			continue;
		}
		const pk = c.meta.singleton
			? { field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: { hidden: true } }
			: { field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: { hidden: true, readonly: true } };
		await api('POST', '/collections', { collection: c.collection, meta: c.meta, schema: {}, fields: [pk, ...c.fields] });
		console.log(`+ ${c.collection}`);
	}
	const fields = new Set((await api('GET', '/fields')).map((f) => `${f.collection}.${f.field}`));
	await ensureNewsAttachments(fields);
	// ความสัมพันธ์รูปภาพ -> directus_files
	for (const [col, field] of [['news', 'cover'], ['banners', 'image'], ['site_settings', 'director_photo']]) {
		const rels = await api('GET', `/relations/${col}`);
		if (!rels.some((r) => r.field === field)) {
			await api('POST', '/relations', { collection: col, field, related_collection: 'directus_files', schema: { on_delete: 'SET NULL' } });
		}
	}
}

// ---------- role / policy ----------
const APP_RECOMMENDED = [
	{ collection: 'directus_files', action: 'create', permissions: {}, fields: ['*'] },
	{ collection: 'directus_files', action: 'read', permissions: {}, fields: ['*'] },
	{ collection: 'directus_files', action: 'update', permissions: { uploaded_by: { _eq: '$CURRENT_USER' } }, fields: ['title', 'description', 'tags', 'location', 'folder', 'focal_point_x', 'focal_point_y', 'filename_download'] },
	{ collection: 'directus_files', action: 'delete', permissions: { uploaded_by: { _eq: '$CURRENT_USER' } }, fields: ['*'] },
	{ collection: 'directus_folders', action: 'create', permissions: {}, fields: ['*'] },
	{ collection: 'directus_folders', action: 'read', permissions: {}, fields: ['*'] },
	{ collection: 'directus_folders', action: 'update', permissions: {}, fields: ['*'] },
	{ collection: 'directus_users', action: 'read', permissions: {}, fields: ['*'] },
	{ collection: 'directus_users', action: 'update', permissions: { id: { _eq: '$CURRENT_USER' } }, fields: ['first_name', 'last_name', 'email', 'password', 'location', 'title', 'description', 'avatar', 'language', 'appearance', 'theme_light', 'theme_dark', 'theme_light_overrides', 'theme_dark_overrides', 'tfa_secret'] },
	{ collection: 'directus_roles', action: 'read', permissions: {}, fields: ['*'] },
];

async function findOrCreate(path, name, body) {
	const list = await api('GET', `${path}?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
	if (list.length) return list[0];
	console.log(`+ ${path} ${name}`);
	return api('POST', path, { name, ...body });
}

async function ensurePermissions(policyId, perms) {
	const have = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&limit=-1&fields=collection,action`);
	const key = (p) => `${p.collection}:${p.action}`;
	const existing = new Set(have.map(key));
	const todo = perms.filter((p) => !existing.has(key(p))).map((p) => ({ policy: policyId, fields: ['*'], permissions: null, validation: null, presets: null, ...p }));
	if (todo.length) await api('POST', '/permissions', todo);
}

async function ensureRoles() {
	// 1) Administrator: บังคับ 2FA + เฉพาะ LAN
	const admin = (await api('GET', '/policies?filter[admin_access][_eq]=true&limit=1'))[0];
	await api('PATCH', `/policies/${admin.id}`, { enforce_tfa: ENFORCE_TFA, ip_access: LAN });

	// 2) เจ้าหน้าที่ประชาสัมพันธ์: แก้ไขเนื้อหาได้ทุกอย่าง แต่ไม่เห็นเมนูตั้งค่าระบบ
	const editorPolicy = await findOrCreate('/policies', 'แก้ไขเนื้อหาเว็บไซต์', {
		icon: 'edit_note',
		description: 'เพิ่ม/แก้ไข/ลบ ข่าว หน้าเว็บ แบนเนอร์ และข้อมูลโรงพยาบาล',
		app_access: true,
		admin_access: false,
	});
	await api('PATCH', `/policies/${editorPolicy.id}`, { enforce_tfa: ENFORCE_TFA, ip_access: LAN });
	const crud = (collection) => ['create', 'read', 'update', 'delete'].map((action) => ({ collection, action }));
	await ensurePermissions(editorPolicy.id, [
		...CONTENT.filter((c) => c !== 'site_settings').flatMap(crud),
		...crud('news_files'),
		{ collection: 'site_settings', action: 'read' },
		{ collection: 'site_settings', action: 'update' },
		// ด้านล่างคัดลอกจาก appRecommendedPermissions ของ Directus แบบตรงตัว (รุ่นฟรีอนุญาตเฉพาะชุดนี้ที่มีเงื่อนไข)
		...APP_RECOMMENDED,
	]);
	const editorRole = await findOrCreate('/roles', 'ประชาสัมพันธ์', { icon: 'campaign', description: 'เจ้าหน้าที่ดูแลเนื้อหาเว็บไซต์' });
	await linkPolicy(editorRole.id, editorPolicy.id);

	// 3) บัญชีระบบสำหรับ build หน้าเว็บและ preview: อ่านได้อย่างเดียว ไม่มีสิทธิ์เข้าหน้า admin (ไม่นับเป็น seat)
	//    Directus 12 รุ่นฟรีกรองสิทธิ์รายแถวไม่ได้ ตัว build จึงต้องกรอง status=published เอง (ดู docs/plan.md)
	const readerPolicy = await findOrCreate('/policies', 'อ่านเนื้อหา (สำหรับ build เว็บและ preview)', {
		icon: 'smart_toy',
		description: 'ใช้กับ token ของตัว build หน้าเว็บ Astro และ preview server เท่านั้น',
		app_access: false,
		admin_access: false,
	});
	await ensurePermissions(readerPolicy.id, [
		...CONTENT.map((collection) => ({ collection, action: 'read' })),
		{ collection: 'news_files', action: 'read' },
		{ collection: 'directus_files', action: 'read' },
	]);
	const readerRole = await findOrCreate('/roles', 'ระบบ build เว็บ', { icon: 'smart_toy', description: 'บัญชีระบบ ห้ามใช้ล็อกอิน' });
	await linkPolicy(readerRole.id, readerPolicy.id);

	return { readerRole };
}

async function linkPolicy(roleId, policyId) {
	const access = await api('GET', `/access?filter[role][_eq]=${roleId}&filter[policy][_eq]=${policyId}&limit=1`);
	if (!access.length) await api('POST', '/access', { role: roleId, policy: policyId });
}

async function ensureServiceUser(email, firstName, roleId) {
	const found = await api('GET', `/users?filter[email][_eq]=${encodeURIComponent(email)}&limit=1`);
	if (found.length) return null;
	const tokenValue = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
	await api('POST', '/users', { email, first_name: firstName, role: roleId, token: tokenValue, status: 'active' });
	console.log(`+ user ${email}`);
	return tokenValue;
}

// ---------- ค่าระบบ ----------
async function ensureSettings() {
	await api('PATCH', '/settings', {
		project_name: 'เว็บไซต์โรงพยาบาล',
		project_descriptor: 'ระบบหลังบ้าน',
		project_color: '#0E7C66',
		default_language: 'th-TH',
		public_registration: false,
		auth_login_attempts: 5,
		// อย่างน้อย 12 ตัว มีตัวเล็ก ตัวใหญ่ ตัวเลข
		auth_password_policy: '/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{12,}$/',
		mcp_enabled: false,
		// เมนูซ้ายมือ: เหลือแค่เนื้อหาและไฟล์ (ผู้ดูแลยังเห็นผู้ใช้/ตั้งค่า)
		module_bar: [
			{ type: 'module', id: 'content', enabled: true },
			{ type: 'module', id: 'files', enabled: true },
			{ type: 'module', id: 'users', enabled: true },
			{ type: 'module', id: 'visual', enabled: false },
			{ type: 'module', id: 'insights', enabled: false },
			{ type: 'module', id: 'deployments', enabled: false },
			{ type: 'module', id: 'settings', enabled: true, locked: true },
		],
		storage_asset_transform: 'presets',
		storage_asset_presets: [
			{ key: 'thumb', fit: 'cover', width: 600, height: 400, quality: 80, format: 'webp', withoutEnlargement: true },
			{ key: 'banner', fit: 'cover', width: 1920, height: 640, quality: 80, format: 'webp', withoutEnlargement: true },
			{ key: 'content', fit: 'inside', width: 1200, height: 1200, quality: 82, format: 'webp', withoutEnlargement: true },
		],
	});
}

// ---------- main ----------
const login = await api('POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, ...(process.env.ADMIN_OTP ? { otp: process.env.ADMIN_OTP } : {}) });
token = login.access_token;

await ensureSettings();
await ensureCollections();
const { readerRole } = await ensureRoles();
const readerToken = await ensureServiceUser('site-reader@waritch-hosp.moph.go.th', 'ระบบ build เว็บ', readerRole.id);
if (readerToken) console.log(`\nDIRECTUS_READ_TOKEN=${readerToken}\n↑ เก็บค่านี้ไว้ใน .env ของตัว build เว็บ (แสดงครั้งเดียว)`);
console.log('\nเสร็จ');
