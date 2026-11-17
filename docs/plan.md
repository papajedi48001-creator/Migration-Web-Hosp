# แผนพัฒนาเว็บไซต์โรงพยาบาลใหม่ (Directus + PostgreSQL + Astro)

สถานะ: ร่าง v1 · 17 พ.ย. 2026
ขอบเขต: เว็บหลัก `waritch-hosp.moph.go.th` (WordPress ที่ `/var/www/html`) เท่านั้น
แอปอื่นบนเครื่องเดียวกัน (`/waritch/*`, `/iclaim/`, `/dispensingx/`, `/ita67/`, `/hs4/` ฯลฯ) **ไม่ย้าย และต้องทำงานต่อได้เหมือนเดิม**

ความต้องการหลัก: 2FA · backup/restore ง่าย · security สูง · หลังบ้านใช้ง่ายสำหรับเจ้าหน้าที่ที่ไม่ใช่สาย IT
ไม่ทำ: workflow อนุมัติ (ร่าง → รออนุมัติ → เผยแพร่) ใช้แค่ "ฉบับร่าง / เผยแพร่"

---

## 1. ภาพรวม

```
                        อินเทอร์เน็ต
                             │ 443
                ┌────────────▼──────────────────────────────┐
                │ nginx บน host (Rocky 9)                   │
                │  /            → ไฟล์ static (Astro)        │  ← ไม่มี PHP / ไม่มี DB ให้โจมตี
                │  /waritch/ /iclaim/ ...  → php-fpm เดิม    │  ← ไม่แตะ
                │  :8443 (LAN เท่านั้น) → 127.0.0.1:8055     │
                └──────┬───────────────────────┬────────────┘
                       │                       │ proxy (LAN)
            /srv/hospweb/site/current          ▼
                       ▲             ┌──────────────────── docker compose "hospweb" ┐
                       │ build       │ directus:12.6.1  (หลังบ้าน + API)             │
             scripts/build-site.sh ──┤   read-only rootfs, cap_drop ALL             │
             (cron ทุก 5 นาที)        │ postgres:17.12   (network internal ออกนอกไม่ได้)│
                                     └──────────────────────────────────────────────┘
```

หลักคิด
- **หน้าเว็บที่คนนอกเห็นเป็นไฟล์ HTML ล้วน** สร้างจาก Astro แล้ว nginx เสิร์ฟตรง ๆ ต่อให้ CMS ล่ม เว็บก็ยังเปิดได้ และไม่มีโค้ดฝั่ง server ให้โจมตีแบบ WordPress/PHP
- **หลังบ้าน (Directus) ไม่เปิดสู่อินเทอร์เน็ตเลย** เข้าได้จากเครือข่ายโรงพยาบาลเท่านั้น (พอร์ต 8443) และทุกคนต้องใช้ 2FA
- รูปและไฟล์แนบถูกคัดลอกเข้าไปในไฟล์ static ตอน build จึงไม่ต้องเปิด `/assets` ของ Directus ให้คนนอก

## 2. ทำไม Directus และข้อจำกัดของรุ่นฟรี

ผลจากการทดลองรัน Directus 12.6.1 จริงใน Docker (17 พ.ย. 2026)

| เรื่อง | ผล |
| --- | --- |
| 2FA (TOTP) | มีในตัว บังคับราย policy ได้ ทดสอบแล้ว login ไม่มี OTP ถูกปฏิเสธ |
| จำกัด IP | มี `ip_access` ราย policy รองรับ CIDR ทดสอบแล้ว IP นอกช่วงถูกปฏิเสธแม้รหัสถูก |
| หน้า admin ภาษาไทย | มี `th-TH` ในตัว ตั้งเป็นค่าเริ่มต้นของทั้งระบบแล้ว |
| editor | WYSIWYG แบบ Word ลากวางรูปได้ |
| license | MSCL-1.0 ใช้ฟรีได้ทุกองค์กร ยกเว้นเอาไปขายแข่งกับ Directus |

**ข้อจำกัดของรุ่นฟรี (Core) ที่เลือกใช้** — ตกลงใช้แล้วเมื่อ 17 พ.ย. 2026

| ข้อจำกัด | ผลต่อเรา | วิธีรับมือ |
| --- | --- | --- |
| ผู้ใช้ที่เข้าหลังบ้านได้ **3 คน** | แอดมิน 1 + เจ้าหน้าที่ 2 | บัญชีระบบที่ไม่มีสิทธิ์เข้าหน้า admin (ตัว build เว็บ) ไม่นับ ถ้าต้องเพิ่มคนค่อยซื้อ license ไม่ต้องย้ายระบบ |
| ตาราง 25, flow 5 | ใช้ ~5 ตาราง ไม่ใช้ flow | – |
| ดูประวัติแก้ไขย้อนหลัง 30 วัน | ดูในหน้า admin ได้ 30 วัน | log การเข้าใช้ยังอยู่ใน nginx และ backup รายวันเก็บ 14 วัน + รายสัปดาห์ 8 สัปดาห์ |
| ตั้งสิทธิ์แบบมีเงื่อนไขรายแถวไม่ได้ (เช่น "อ่านได้เฉพาะที่เผยแพร่") | บัญชีระบบสำหรับ build อ่านได้ทุกสถานะ | ตัว build กรอง `status = published` เอง token อยู่บน server เท่านั้น |
| ส่ง telemetry กลับ Directus บังคับ | ส่งข้อมูลการใช้งานระดับระบบ ไม่มีเนื้อหาหรือข้อมูลผู้ใช้ | ยอมรับได้ ไม่มีข้อมูลผู้ป่วยในระบบนี้ |

ช่องโหว่ที่เจอและปิดแล้ว: Directus บังคับ 2FA แค่ที่หน้าเว็บ admin แต่ API ยังใช้รหัสผ่านอย่างเดียวได้จนกว่าผู้ใช้จะตั้ง 2FA เสร็จ จึงเพิ่ม extension `directus/extensions/enforce-tfa` ที่ปฏิเสธทุกคำขอ (ยกเว้นหน้าตั้ง 2FA) ของผู้ใช้ที่ยังไม่ตั้ง 2FA ทดสอบแล้วอ่าน/เขียนข่าวไม่ได้จนกว่าจะตั้ง 2FA

## 3. โครงสร้าง repo

```
compose.yaml                     Directus + PostgreSQL
.env.example                     ค่าตั้งต้น (คัดลอกเป็น .env)
directus/bootstrap.mjs           สร้างตาราง เมนูภาษาไทย role/สิทธิ์ 2FA จำกัด IP
directus/extensions/enforce-tfa  ปิดช่องใช้ API ก่อนตั้ง 2FA
migration/wp-to-directus.mjs     ย้ายข่าว/หน้า/รูป/ไฟล์แนบ จาก WordPress + สร้าง redirect
scripts/gen-secrets.sh           สุ่มรหัสลับใส่ .env
scripts/backup.sh                สำรอง DB + ไฟล์ + .env
scripts/restore.sh               กู้คืน (ใช้ย้ายเครื่องได้ด้วย)
nginx/                           config ฝั่ง host: เว็บสาธารณะ, หลังบ้าน :8443, redirect
site/                            (เฟส 2) หน้าเว็บ Astro
```

## 4. ติดตั้งบนเครื่องพัฒนา (Docker เครื่องเดิม)

พอร์ตที่ใช้ไม่ชนกับ waritch-backoffice (3000/3100, mariadb, redis, minio, seaweedfs)

| บริการ | พอร์ต | เปิดให้ใคร |
| --- | --- | --- |
| Directus | `127.0.0.1:8055` | เฉพาะ nginx บนเครื่อง |
| PostgreSQL | ไม่เปิด | เฉพาะ container directus (network internal) |
| หลังบ้านผ่าน nginx | `8443` | LAN เท่านั้น |
| preview (เฟส 2) | `127.0.0.1:4321` | ผ่าน `:8443/preview/` |

```bash
sudo mkdir -p /srv/hospweb && sudo chown $USER /srv/hospweb
git clone https://github.com/papajedi48001-creator/Migration-Web-Hosp /srv/hospweb
cd /srv/hospweb
./scripts/gen-secrets.sh            # สร้าง .env + รหัสลับ + รหัส admin คนแรก (แสดงครั้งเดียว)
nano .env                           # ตั้ง PUBLIC_URL, BACKUP_DIR
docker compose up -d
docker compose ps                   # รอ directus เป็น healthy

# ตั้งค่าหลังบ้าน (ครั้งแรกยังไม่ต้องใส่ OTP)
set -a; . ./.env; set +a
node directus/bootstrap.mjs         # เก็บ DIRECTUS_READ_TOKEN ที่แสดงไว้ (แสดงครั้งเดียว)
```

จากนั้น
1. เข้า `https://waritch-hosp.moph.go.th:8443` ด้วย admin คนแรก ระบบจะบังคับตั้ง 2FA ทันที (สแกน QR ด้วย Google Authenticator / Microsoft Authenticator)
2. ลบ `ADMIN_EMAIL` และ `ADMIN_PASSWORD` ออกจาก `.env` แล้ว `docker compose up -d`
3. สร้างบัญชีเจ้าหน้าที่ใน "ผู้ใช้" เลือก role **ประชาสัมพันธ์** ให้เจ้าหน้าที่นั่งตั้ง 2FA ต่อหน้าเราตอน login ครั้งแรก
4. รัน bootstrap ครั้งต่อไปต้องใส่ OTP ของ admin: `ADMIN_OTP=123456 node directus/bootstrap.mjs`

ระหว่างพัฒนาที่ยังไม่ได้ตั้ง nginx ใช้ `ssh -L 8055:127.0.0.1:8055 admin_waritch@192.168.1.251` แล้วเปิด `http://localhost:8055` ด้วย Chrome/Edge ได้ (IP ที่ Directus เห็นจะเป็น gateway ของ Docker ซึ่งอยู่ในช่วง LAN ที่อนุญาต)

## 5. หลังบ้าน (สิ่งที่เจ้าหน้าที่เห็น)

เมนูซ้ายเหลือแค่ **เนื้อหา** และ **ไฟล์** (แอดมินเห็น ผู้ใช้/ตั้งค่า เพิ่ม) ทุกช่องมีชื่อภาษาไทย ช่องที่อาจสับสนมีคำอธิบายกำกับ

| ตาราง | ใช้ทำอะไร | ช่องหลัก |
| --- | --- | --- |
| ข่าว | ข่าวประชาสัมพันธ์, จัดซื้อจัดจ้าง, รับสมัครงาน, กิจกรรม, ความรู้สุขภาพ | หัวข้อ, หมวด, วันที่ประกาศ, รูปหน้าปก, สรุปสั้น, เนื้อหา, ไฟล์แนบหลายไฟล์, ปักหมุด, สถานะ |
| หน้าเว็บ | เกี่ยวกับเรา, บริการ, ติดต่อ ฯลฯ | ชื่อหน้า, อยู่ในเมนูไหน, เนื้อหา, ลำดับ (ลากเรียงได้) |
| แบนเนอร์หน้าแรก | สไลด์หน้าแรก | รูป, ลิงก์, วันเริ่ม/หยุดแสดง, ลำดับ |
| ข้อมูลโรงพยาบาล | หน้าเดียว | เบอร์โทร, ฉุกเฉิน, ที่อยู่, เวลาทำการ, Facebook, LINE, แผนที่, ข้อความแจ้งเตือนด่วน |

สิทธิ์
- **ผู้ดูแลระบบ**: ทุกอย่าง · บังคับ 2FA · เฉพาะ IP ในโรงพยาบาล
- **ประชาสัมพันธ์**: เพิ่ม/แก้/ลบ ข่าว หน้าเว็บ แบนเนอร์ แก้ข้อมูลโรงพยาบาล อัปโหลดไฟล์ ลบได้เฉพาะไฟล์ที่ตัวเองอัปโหลด · ไม่เห็นตั้งค่าระบบ · บังคับ 2FA · เฉพาะ IP ในโรงพยาบาล
- **ระบบ build เว็บ** (บัญชีระบบ ไม่มีรหัสผ่าน ใช้ token): อ่านอย่างเดียว เข้าหน้า admin ไม่ได้

ไฟล์ที่อัปโหลดได้: รูป (jpg/png/webp/gif/svg), PDF, Word, Excel ไม่เกิน 10 MB ไม่เก็บ EXIF/GPS ของรูป

ปุ่ม **preview**: เปิดดูหน้าตาจริงของข่าวที่ยังเป็นฉบับร่างได้ (ใช้ preview server ของ Astro เฟส 2)

## 6. หน้าเว็บสาธารณะ (Astro) — เฟส 2

- หน้า: หน้าแรก (แบนเนอร์ + ข่าวล่าสุด + ปักหมุด + ข้อความแจ้งเตือนด่วน), รวมข่าวแยกหมวดมีเลขหน้า, หน้าข่าว, หน้าเว็บทั่วไป, ติดต่อ, 404
- ค้นหาในเว็บด้วย Pagefind (static ไม่ต้องมี server)
- รองรับมือถือ, อ่านง่ายสำหรับผู้สูงอายุ (ตัวอักษรใหญ่, contrast ตาม WCAG AA), ฟอนต์ไทยแบบ self-host
- ไม่มี cookie/tracking ของบุคคลที่สาม จึงไม่ต้องมี cookie banner ตาม PDPA (ถ้าจะใส่ Google Analytics ค่อยเพิ่ม)
- **การ build**: `scripts/build-site.sh` รันจาก cron ทุก 5 นาที เช็กว่ามีการแก้ไขใหม่ใน Directus ไหม (ดู `date_updated` ล่าสุด) ถ้ามีจึง build ใหม่ลงโฟลเดอร์ใหม่ แล้วสลับ symlink `/srv/hospweb/site/current` แบบ atomic เก็บ build เก่าไว้ 5 ชุดเพื่อย้อนกลับได้ทันที ไม่ต้องเปิดช่องให้ Directus เรียกเข้ามา
  เจ้าหน้าที่กดเผยแพร่แล้ว ข่าวขึ้นเว็บภายใน ~5 นาที
- **preview**: Astro โหมด SSR อีกตัว รันที่ `127.0.0.1:4321` อ่านฉบับร่างได้ เข้าผ่าน `:8443/preview/` จึงเห็นได้แค่ใน LAN

## 7. ย้ายเนื้อหาจาก WordPress

`migration/wp-to-directus.mjs` ดึงผ่าน `/wp-json` ของเว็บเดิมแบบอ่านอย่างเดียว ไม่ต้องเข้า DB ไม่แก้เว็บเดิม รันซ้ำได้ (ข้ามรายการที่ย้ายแล้ว)

ย้ายอะไร
- โพสต์ → ข่าว (เดาหมวดจากชื่อหมวดเดิม เช่น มีคำว่า "จัดซื้อ" → ข่าวจัดซื้อจัดจ้าง ปรับกฎได้ที่ `CATEGORY_RULES`)
- หน้า → หน้าเว็บ
- รูปในเนื้อหา, รูปหน้าปก, ไฟล์ PDF/Word/Excel ที่ลิงก์ไว้ → อัปโหลดเข้า Directus โฟลเดอร์ `wp-import` (ใช้รูปต้นฉบับแทนรูปย่อของ WP) PDF ที่ลิงก์ในข่าวจะถูกใส่ใน "ไฟล์แนบ" ด้วย
- ล้าง srcset, class ของ WP, คอมเมนต์ Gutenberg, shortcode ที่ค้าง
- สร้าง `migration/out/redirects.map` และ `redirects-p.map` ให้ลิงก์เดิม (`/2024/05/ข่าว.../`, `?p=123`, `?page_id=45`) redirect 301 ไปลิงก์ใหม่ Google และลิงก์ที่แชร์ใน Facebook จะไม่เสีย

ทดสอบแล้วกับ WordPress 6.8 จำลอง: ข่าวภาษาไทย, หมวดจัดซื้อ, รูปในเนื้อหา, รูปหน้าปก, PDF แนบ, redirect ทั้งลิงก์ไทยและ `?p=` ผ่านใน nginx 1.20

ขั้นตอน
```bash
set -a; . ./.env; set +a
WP_URL=https://waritch-hosp.moph.go.th ADMIN_OTP=xxxxxx node migration/wp-to-directus.mjs --limit 20   # ลองก่อน 20 ข่าว
WP_URL=https://waritch-hosp.moph.go.th ADMIN_OTP=xxxxxx node migration/wp-to-directus.mjs              # ทั้งหมด
cat migration/out/report.json      # ดูไฟล์ที่ดึงไม่ได้
```
ต้องตรวจด้วยตา: หน้าที่ทำด้วย page builder (Elementor ฯลฯ) อาจจัดหน้าเพี้ยน ให้ประชาสัมพันธ์ช่วยไล่ดูหน้าเว็บสำคัญ (คาดว่า 10–20 หน้า)

ไม่ย้าย: ITA67 และ WordPress อื่นที่อยู่ใน subfolder ยังเป็นเว็บเดิม (ทำเฟสถัดไป), ความเห็น, ผู้ใช้ WP

## 8. Backup / Restore

```bash
./scripts/backup.sh                         # สำรองทันที
./scripts/restore.sh <โฟลเดอร์ชุดสำรอง>      # กู้คืน (ถามยืนยัน และสำรองสถานะปัจจุบันให้ก่อนทับเสมอ)
```
- ชุดสำรองมี: `db.dump` (pg_dump), `uploads.tar.gz`, `env`, `SHA256SUMS` ตรวจความถูกต้องทั้งตอนสำรองและตอนกู้
- cron ทุกวัน 01:30 เก็บรายวัน 14 ชุด + รายสัปดาห์ (วันอาทิตย์) 8 ชุด
  `30 1 * * * /srv/hospweb/scripts/backup.sh >> /var/log/hospweb-backup.log 2>&1`
- ตั้ง `BACKUP_OFFSITE` ให้ rsync ไป NAS/เครื่องอื่น และ `BACKUP_GPG_RECIPIENT` ถ้าจะเข้ารหัส
- **ทดสอบกู้คืนเดือนละครั้ง** บนเครื่อง dev (ใช้ restore.sh กับชุดล่าสุดของ production)
- หน้าเว็บสาธารณะไม่ต้อง backup แยก เพราะ build ใหม่จาก Directus ได้ทุกเมื่อ
- ทดสอบแล้ว: สำรอง → ลบข่าว → กู้คืน → ข่าวและไฟล์กลับมาครบ
- ข้อมูลหายได้มากสุด 1 วัน (RPO 24 ชม.) กู้คืนใช้เวลาไม่กี่นาที

## 9. Security checklist

ทำไว้ใน repo แล้ว
- [x] หน้าเว็บสาธารณะเป็น static ไม่มี PHP/DB, CSP เข้ม, HSTS, nosniff, `.php` ที่ root ตอบ 404, `wp-login.php`/`xmlrpc.php`/`wp-admin` ตอบ 410
- [x] หลังบ้านแยกพอร์ต 8443 เฉพาะ LAN, deny `192.168.1.1` (router NAT ที่เจอในเฟส 0), rate limit หน้า login 5 ครั้ง/นาที
- [x] Directus: 2FA บังคับทุกคน + extension ปิดช่อง API, `ip_access` ราย policy, ล็อกบัญชีหลังผิด 5 ครั้ง, รหัสผ่านอย่างน้อย 12 ตัวมีตัวเล็ก/ใหญ่/ตัวเลข, session 12 ชม., cookie Secure + SameSite=Strict
- [x] ปิด GraphQL introspection, OpenAPI, WebSocket, MCP, CORS, สมัครสมาชิกเอง
- [x] container: rootfs read-only, `cap_drop: ALL`, `no-new-privileges`, image ระบุเวอร์ชันตายตัว, DB อยู่ network internal ออกอินเทอร์เน็ตไม่ได้และไม่เปิดพอร์ต
- [x] nginx เขียนทับ `X-Forwarded-For` ไม่ให้ปลอม IP หลอก `ip_access`
- [x] รับไฟล์เฉพาะรูป/PDF/Office, ไม่มีไฟล์ใดถูกรันเป็นโค้ด
- [x] `.env` สิทธิ์ 600 ไม่อยู่ใน git, backup สิทธิ์ 700

ต้องทำบนเครื่องจริง
- [ ] firewalld: เปิด 8443 เฉพาะ `192.168.0.0/16` และยืนยันว่า router ไม่ forward 8443
  `sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=192.168.0.0/16 port port=8443 protocol=tcp accept' && sudo firewall-cmd --reload`
- [ ] DNS ภายใน (หรือ hosts ของเครื่องประชาสัมพันธ์) ชี้ `waritch-hosp.moph.go.th` → `192.168.1.251` เพื่อไม่ให้ผ่าน router แล้วกลายเป็น 192.168.1.1
- [ ] อัปเกรด nginx 1.20 (2021) เป็นรุ่นที่ยัง support จาก AppStream หรือ nginx.org
- [ ] `dnf-automatic` สำหรับ security update ของ OS, อัปเดต image Directus/Postgres ทุกเดือน (`docker compose pull && up -d` หลัง backup)
- [ ] ส่ง backup ออกนอกเครื่อง (NAS) และทดสอบกู้คืนรายเดือน

## 10. Deploy ลง server จริง

ใช้วิธีเดียวกับย้ายเครื่อง: backup จากเครื่อง dev แล้ว restore บนเครื่องจริง

1. ติดตั้ง Docker บนเครื่องจริง, clone repo ไป `/srv/hospweb`
2. `./scripts/backup.sh` บนเครื่อง dev → คัดลอกชุดสำรองไปเครื่องจริง → `./scripts/restore.sh <ชุด>` (ใช้ `.env` จากชุดสำรอง แก้ `PUBLIC_URL`)
3. วาง nginx: `00-hospweb-maps.conf` และ `hospweb-admin.conf` ใน `/etc/nginx/conf.d/`, `hospweb-proxy.conf` และ `hospweb-public.conf` ใน `/etc/nginx/snippets/`, redirect map ใน `/srv/hospweb/redirects/` แก้ path ใบรับรองให้ตรงกับ `waritch.conf`
4. build หน้าเว็บครั้งแรก ตรวจที่ `https://waritch-hosp.moph.go.th:8443/preview/` และให้ประชาสัมพันธ์ตรวจรับ
5. **วัน cut-over** (นอกเวลาราชการ)
   - รัน migration รอบสุดท้าย (ดึงข่าวที่เพิ่มหลังรอบแรก) แล้ว build ใหม่
   - คัดลอก `wp-content/uploads` เดิมไป `/srv/hospweb/legacy/wp-content/uploads` (ให้ลิงก์รูปเก่าที่เว็บอื่นอ้างถึงยังเปิดได้)
   - ใน `conf.d/waritch.conf` ใส่ `include /etc/nginx/snippets/hospweb-public.conf;` แทนส่วน `location /` ของ WordPress เดิม เก็บ location ของแอปอื่นและ `snippets/phase0.conf` ไว้ครบ
   - `sudo nginx -t && sudo systemctl reload nginx`
   - ไล่ทดสอบ: หน้าแรก, ข่าว, ลิงก์เดิม 20 ลิงก์สุ่ม, แอปเดิมทุกตัว (`/waritch/*`, `/iclaim/`, `/ita67/`, `/dispensingx/`, `/HOSxP_Update/`)
6. **ย้อนกลับ**: เอา include ออก คืน `location /` เดิม แล้ว reload nginx (ไม่กี่วินาที WordPress ยังอยู่ครบ ไม่ได้ลบ)
7. หลังใช้งานได้ 30 วันไม่มีปัญหา: ปิด WordPress หลัก (ย้ายไฟล์ออกจาก webroot, เก็บ backup DB เดิมไว้)

## 11. ลำดับงานและเวลาโดยประมาณ

| เฟส | งาน | เวลา |
| --- | --- | --- |
| 1 | ตั้ง Directus + DB + backup บนเครื่อง dev (repo นี้), ตั้ง nginx :8443, เปิดบัญชีเจ้าหน้าที่ | 2–3 วัน |
| 2 | หน้าเว็บ Astro + build script + preview | 2–3 สัปดาห์ |
| 3 | ย้ายเนื้อหา + ประชาสัมพันธ์ตรวจ + แก้หน้าเพี้ยน | 1 สัปดาห์ |
| 4 | ทดสอบความปลอดภัย (สแกน, ทดลองกู้คืน), อบรมเจ้าหน้าที่ 1 ชั่วโมง + คู่มือภาพ | 3–4 วัน |
| 5 | cut-over + เฝ้าระวัง 30 วัน | 1 วัน + 30 วัน |

## 12. คำถามที่ยังเปิดอยู่

1. เจ้าหน้าที่ที่จะแก้เว็บคือใครบ้าง (รุ่นฟรีได้ 2 คน + แอดมิน)
2. มี DNS ภายในไหม หรือจะตั้ง hosts ที่เครื่องประชาสัมพันธ์ (สำหรับเข้า :8443 ไม่ผ่าน router)
3. มี NAS หรือเครื่องอื่นสำหรับเก็บ backup นอกเครื่องไหม
4. มี SMTP สำหรับส่งอีเมลลืมรหัสผ่านไหม (ถ้าไม่มี แอดมินรีเซ็ตให้ได้)
5. "server จริง" คือ .251 เดิม หรือเครื่องใหม่
