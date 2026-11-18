# แผนพัฒนาเว็บไซต์โรงพยาบาลใหม่ (Directus + PostgreSQL + Astro)

สถานะ: ร่าง v2 · 17 พ.ย. 2026 (อัปเดตตามคำตอบ: ผู้ใช้ 3 คน, เข้า admin จากใน LAN, NAS .241, deploy บน .251 เดิม)
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
| ผู้ใช้ที่เข้าหลังบ้านได้ **3 คน** | admin01, admin02, admin03 พอดี (ห้ามสร้างบัญชีที่ 4 รวมถึงบัญชีทดสอบ) | บัญชีระบบที่ไม่มีสิทธิ์เข้าหน้า admin (ตัว build เว็บ) ไม่นับ ถ้าต้องเพิ่มคนค่อยซื้อ license ไม่ต้องย้ายระบบ |
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
scripts/setup-server.sh          ติดตั้งเฟส 1 บน .251 คำสั่งเดียว (rollback ได้)
scripts/build-site.sh            สร้างหน้าเว็บ static + preview ฉบับร่าง สลับขึ้นเว็บแบบไม่มีช่วงล่ม (cron ทุก 1 นาที)
nginx/                           config ฝั่ง host: เว็บสาธารณะ, หลังบ้าน :8443, redirect, header ความปลอดภัย
site/                            หน้าเว็บ Astro (ดึงข้อมูลจาก Directus ตอน build เท่านั้น)
```

ที่อยู่บน server: โค้ด (repo นี้) อยู่ `/opt/hospweb` ส่วนไฟล์ที่ nginx เสิร์ฟอยู่ `/srv/hospweb`

```
/srv/hospweb/site/current     -> releases/<เวลา>   หน้าเว็บจริง (เก็บ 5 ชุดล่าสุด ถอยกลับได้)
/srv/hospweb/preview/current  -> releases/<เวลา>   ตัวอย่างรวมฉบับร่าง (:8443/preview/)
/srv/hospweb/redirects/       redirect map จาก migration
/srv/hospweb/legacy/          สำเนา wp-content/uploads เดิม (read-only)
```

## 4. ติดตั้งบนเครื่องพัฒนา (Docker เครื่องเดิม)

พอร์ตที่ใช้ไม่ชนกับ waritch-backoffice (3000/3100, mariadb, redis, minio, seaweedfs)

| บริการ | พอร์ต | เปิดให้ใคร |
| --- | --- | --- |
| Directus | `127.0.0.1:8055` | เฉพาะ nginx บนเครื่อง |
| PostgreSQL | ไม่เปิด | เฉพาะ container directus (network internal) |
| หลังบ้านผ่าน nginx | `8443` | LAN เท่านั้น |
| preview ฉบับร่าง | ไม่มี (ไฟล์ static) | `:8443/preview/` LAN เท่านั้น |

**วง IP ของ Docker**: ระบบนี้ใช้ `10.250.230.0/24` และ `10.250.231.0/24` (ตั้งได้ใน `.env`) ห้ามปล่อยให้ Docker เลือกเอง เพราะค่าเริ่มของ Docker คือ 172.17–172.31 ซึ่งชนกับเครื่องในโรงพยาบาลวง 172.18.x (เจอจริงตอนติดตั้ง 18 พ.ย. 2026: .251 ส่งคำตอบให้เครื่อง 172.18.x เข้า Docker แทน ทำให้เข้า .251 ไม่ได้ทั้งเครื่อง) สคริปต์ติดตั้งตรวจให้ก่อนว่าไม่ทับเส้นทางที่มีอยู่และไม่ทับวงใน `ADMIN_LAN_CIDRS`
ข้อควรระวังเพิ่ม: bridge เริ่มต้นของ Docker (`docker0`) ใช้ 172.17.0.0/16 ถ้าโรงพยาบาลมีวง 172.17.x ด้วย ต้องย้ายใน `/etc/docker/daemon.json` (`"bip"` และ `"default-address-pools"`)

**ติดตั้งบน .251 แบบคำสั่งเดียว (เฟส 1)**: ทำทุกขั้นด้านล่าง + nginx :8443 + firewalld + SELinux + cron + กุญแจ ssh สำหรับ NAS ให้เอง ไม่แตะ `waritch.conf`/WordPress รันซ้ำได้ และถอนได้ด้วย `rollback`

```bash
sudo git clone https://github.com/papajedi48001-creator/Migration-Web-Hosp /opt/hospweb
cd /opt/hospweb && sudo ./scripts/setup-server.sh
# ถอน: sudo ./scripts/setup-server.sh rollback   (ข้อมูลไม่ถูกลบ)
```

ขั้นตอนแบบทำเอง (สิ่งที่สคริปต์ทำ)

```bash
sudo mkdir -p /opt/hospweb && sudo chown $USER /opt/hospweb
git clone https://github.com/papajedi48001-creator/Migration-Web-Hosp /opt/hospweb
cd /opt/hospweb
./scripts/gen-secrets.sh            # สร้าง .env + รหัสลับ + รหัส admin คนแรก (แสดงครั้งเดียว)
nano .env                           # ตั้ง PUBLIC_URL, BACKUP_DIR
docker compose up -d
docker compose ps                   # รอ directus เป็น healthy

# ตั้งค่าหลังบ้าน (ครั้งแรกยังไม่ต้องใส่ OTP)
set -a; . ./.env; set +a
node directus/bootstrap.mjs         # นำ DIRECTUS_READ_TOKEN ที่แสดง (ครั้งเดียว) ไปใส่ใน .env

# หน้าเว็บ
sudo ./scripts/build-site.sh --install   # สร้าง image ตัว build + ติดตั้ง package ของ site/ + สร้างโฟลเดอร์ /srv/hospweb
sudo ./scripts/build-site.sh --force     # build ครั้งแรก
```

CPU: compiler ของ Astro และ Pagefind ต้องใช้ CPU ระดับ x86-64-v3 (AVX2, BMI2, FMA) ถ้า VM ไม่มี (เช่น Proxmox CPU type x86-64-v2-AES) `site/build.sh` จะรันผ่าน qemu ใน image ตัว build ให้อัตโนมัติ ช้ากว่าราว 5 เท่าแต่ได้ผลเหมือนกัน แก้ถาวรโดยตั้ง CPU type ของ VM เป็น `host` แล้ว reboot

พัฒนาหน้าเว็บบนเครื่องตัวเอง: `cd site && cp .env.example .env` (ใส่ token) แล้ว `npm ci && npm run dev`

จากนั้น
1. เข้า `https://waritch-hosp.moph.go.th:8443` ด้วย `admin01@waritch-hosp.moph.go.th` (บัญชีแรกที่ระบบสร้าง ไม่ต้องสร้างบัญชี admin แยก เพราะจะกินที่ 1 ใน 3) ระบบจะบังคับตั้ง 2FA ทันที (สแกน QR ด้วย Google Authenticator / Microsoft Authenticator)
2. ลบ `ADMIN_EMAIL` และ `ADMIN_PASSWORD` ออกจาก `.env` แล้ว `docker compose up -d`
3. สร้าง `admin02@waritch-hosp.moph.go.th` และ `admin03@waritch-hosp.moph.go.th` ในเมนู "ผู้ใช้" แล้วเลือก role ให้แต่ละคน: **ผู้ดูแลระบบ** (ทำได้ทุกอย่าง) หรือ **ประชาสัมพันธ์** (แก้ได้แค่เนื้อหา) ตั้งต้นแนะนำให้ admin01 เป็นผู้ดูแลระบบ ส่วน admin02/03 เป็นประชาสัมพันธ์ ถ้าทั้งสามคนต้องเป็นผู้ดูแลระบบก็ได้ ให้แต่ละคนตั้ง 2FA ตอน login ครั้งแรก
4. รัน bootstrap ครั้งต่อไปต้องใส่ OTP ของ admin: `ADMIN_OTP=123456 node directus/bootstrap.mjs`

ระหว่างพัฒนาที่ยังไม่ได้ตั้ง nginx ใช้ `ssh -L 8055:127.0.0.1:8055 admin_waritch@192.168.1.251` แล้วเปิด `http://localhost:8055` ด้วย Chrome/Edge ได้ (IP ที่ Directus เห็นจะเป็น gateway ของ Docker ซึ่งอยู่ในช่วง LAN ที่อนุญาต)

## 5. หลังบ้าน (สิ่งที่เจ้าหน้าที่เห็น)

เมนูซ้ายเหลือแค่ **เนื้อหา** และ **ไฟล์** (แอดมินเห็น ผู้ใช้/ตั้งค่า เพิ่ม) ทุกช่องมีชื่อภาษาไทย ช่องที่อาจสับสนมีคำอธิบายกำกับ

| ตาราง | ใช้ทำอะไร | ช่องหลัก |
| --- | --- | --- |
| ข่าว | ข่าวประชาสัมพันธ์, จัดซื้อจัดจ้าง, รับสมัครงาน, กิจกรรม, ความรู้สุขภาพ | หัวข้อ, หมวด, วันที่ประกาศ, รูปหน้าปก, สรุปสั้น, เนื้อหา, ไฟล์แนบหลายไฟล์, ปักหมุด, สถานะ |
| หน้าเว็บ | เกี่ยวกับเรา, บริการ, ติดต่อ ฯลฯ | ชื่อหน้า, อยู่ในเมนูไหน, เนื้อหา, ลำดับ (ลากเรียงได้) |
| แบนเนอร์หน้าแรก | สไลด์หน้าแรก | รูป, ลิงก์, วันเริ่ม/หยุดแสดง, ลำดับ |
| ข้อมูลโรงพยาบาล | หน้าเดียว | เบอร์โทร, ฉุกเฉิน, ที่อยู่, เวลาทำการ, Facebook, LINE, แผนที่, ข้อความแจ้งเตือนด่วน, ชื่อ/ตำแหน่ง/รูปผู้อำนวยการ |

สิทธิ์
- **ผู้ดูแลระบบ**: ทุกอย่าง · บังคับ 2FA · เฉพาะ IP ในโรงพยาบาล
- **ประชาสัมพันธ์**: เพิ่ม/แก้/ลบ ข่าว หน้าเว็บ แบนเนอร์ แก้ข้อมูลโรงพยาบาล อัปโหลดไฟล์ ลบได้เฉพาะไฟล์ที่ตัวเองอัปโหลด · ไม่เห็นตั้งค่าระบบ · บังคับ 2FA · เฉพาะ IP ในโรงพยาบาล
- **ระบบ build เว็บ** (บัญชีระบบ ไม่มีรหัสผ่าน ใช้ token): อ่านอย่างเดียว เข้าหน้า admin ไม่ได้

ไฟล์ที่อัปโหลดได้: รูป (jpg/png/webp/gif/svg), PDF, Word, Excel ไม่เกิน 10 MB ไม่เก็บ EXIF/GPS ของรูป

ปุ่ม **ดูตัวอย่าง** (รูปตา มุมขวาบนของข่าว/หน้าเว็บ): เปิดหน้าตาจริงของข่าวที่ยังเป็นฉบับร่างได้ที่ `:8443/preview/` หน้าตัวอย่างสร้างใหม่ภายใน ~1 นาทีหลังกดบันทึก (ถ้ายังไม่ขึ้นให้รอแล้วรีเฟรช) ข่าวที่ตั้งวันที่ประกาศล่วงหน้าก็เห็นในตัวอย่าง

## 6. หน้าเว็บสาธารณะ (Astro) — เฟส 2

- หน้าตาตาม [mockup ที่ตกลงแล้ว](https://claude.ai/artifact/DAC3ukv8rFbD9sXfHgvaXf) (17 พ.ย. 2026)
- หน้า: หน้าแรก (แบนเนอร์คู่กับรูปผู้อำนวยการ + ข่าวล่าสุด + ปักหมุด + ข้อความแจ้งเตือนด่วน), รวมข่าวแยกหมวดมีเลขหน้า, หน้าข่าว, หน้าเว็บทั่วไป, ติดต่อ, 404
- ค้นหาในเว็บด้วย Pagefind (static ไม่ต้องมี server)
- รองรับมือถือ, อ่านง่ายสำหรับผู้สูงอายุ (ตัวอักษรใหญ่, contrast ตาม WCAG AA), ฟอนต์ไทยแบบ self-host
- ไม่มี cookie/tracking ของบุคคลที่สาม จึงไม่ต้องมี cookie banner ตาม PDPA (ถ้าจะใส่ Google Analytics ค่อยเพิ่ม)
- **การ build**: `scripts/build-site.sh` รันจาก cron ทุก 1 นาที เช็กว่าเนื้อหาใน Directus เปลี่ยนไหม (จำนวนและเวลาแก้ไขล่าสุดของทุกตาราง รวมการลบและเปลี่ยนสถานะ) ถ้าเปลี่ยนจึง build ใหม่ใน container `site-builder` (อยู่ในเครือข่ายปิด อ่าน Directus ด้วย token อ่านอย่างเดียว) ตรวจผล แล้วสลับ symlink `/srv/hospweb/site/current` แบบ atomic ไม่ต้องเปิดช่องให้ Directus เรียกเข้ามา
  - เจ้าหน้าที่กดบันทึกแล้ว ข่าวขึ้นเว็บภายใน 1–2 นาที
  - build ใหม่ทุกชั่วโมงด้วย เพื่อให้ข่าวที่ตั้งเวลาประกาศ และแบนเนอร์ที่ตั้งช่วงวันแสดง ขึ้น/ลงเอง (คลาดได้ไม่เกิน 1 ชั่วโมง)
  - build ล้มหรือได้จำนวนหน้าน้อยกว่าครึ่งของชุดเดิม จะไม่สลับ เว็บยังเป็นชุดเดิม ดูสาเหตุที่ `/srv/hospweb/site/build.log`
  - เก็บ 5 ชุดล่าสุด ไฟล์ที่ไม่เปลี่ยนใช้ hardlink ร่วมกันจึงไม่เปลือง disk ถอยกลับชุดก่อนหน้า: `sudo ./scripts/build-site.sh --rollback`
- **รูปและไฟล์แนบ** คัดลอกจาก Directus มาเป็นไฟล์ในเว็บ (`/media/`) รูปย่อเป็น webp ตามขนาดที่ใช้ คนนอกจึงไม่ต้องเข้าถึง Directus เลย ไฟล์ที่ลบในหลังบ้านหายจากเว็บใน build ถัดไป
- **เนื้อหาจาก editor** ถูกกรองก่อนแสดง: ตัด script/event handler ทิ้ง, รูปต้องเป็นไฟล์ในเว็บ, iframe ได้เฉพาะ YouTube / Google Maps / Facebook
- **เมนู** สร้างจากช่อง "อยู่ในเมนู" ของหน้าเว็บ (หมวดเดียวมีหน้าเดียวเป็นลิงก์ตรง หลายหน้าเป็นเมนูย่อย) ไอคอน "บริการสำหรับผู้ป่วย" หน้าแรก = หน้าเว็บในเมนู "สำหรับผู้ป่วย" + LINE OA (ถ้ากรอกไว้)
- **ลิงก์**: ข่าว `/news/<slug>/` (ไม่มี slug หรือ slug ภาษาไทยใช้ `/news/<id>/`), หน้าเว็บ `/<slug>/` หรือ `/pages/<id>/`, หมวด `/news/category/<หมวด>/`, เลขหน้า `/news/page/2/`
- **preview**: build อีกชุดที่รวมฉบับร่าง ใช้ไฟล์ static เหมือนกัน เสิร์ฟที่ `:8443/preview/` จึงเห็นได้แค่ใน LAN ไม่มี server เพิ่ม
- CSP ของหน้าเว็บอยู่ที่ `nginx/hospweb-headers.conf` (ไม่มี inline script; `'wasm-unsafe-eval'` สำหรับ Pagefind เท่านั้น)

## 7. ย้ายเนื้อหาจาก WordPress

`migration/wp-to-directus.mjs` ดึงผ่าน REST API ของเว็บเดิม (`index.php?rest_route=` ใช้ได้แม้ไม่เปิด pretty permalink) แบบอ่านอย่างเดียว ไม่ต้องเข้า DB ไม่แก้เว็บเดิม รันซ้ำได้ (ข้ามรายการที่ย้ายแล้ว)

ย้ายอะไร
- โพสต์ → ข่าว (เดาหมวดจากชื่อหมวดเดิม เช่น มีคำว่า "จัดซื้อ" → ข่าวจัดซื้อจัดจ้าง ปรับกฎได้ที่ `CATEGORY_RULES`)
- หน้า → หน้าเว็บ
- รูปในเนื้อหา, รูปหน้าปก, ไฟล์ PDF/Word/Excel ที่ลิงก์ไว้ → อัปโหลดเข้า Directus โฟลเดอร์ `wp-import` (ใช้รูปต้นฉบับแทนรูปย่อของ WP) PDF ที่ลิงก์ในข่าวจะถูกใส่ใน "ไฟล์แนบ" ด้วย
- ล้าง srcset, class ของ WP, คอมเมนต์ Gutenberg, shortcode ที่ค้าง
- สร้าง `migration/out/redirects.map` และ `redirects-p.map` ให้ลิงก์เดิม (`/2024/05/ข่าว.../`, `?p=123`, `?page_id=45`) redirect 301 ไปลิงก์ใหม่ Google และลิงก์ที่แชร์ใน Facebook จะไม่เสีย

ทดสอบแล้วกับ WordPress 6.8 จำลอง: ข่าวภาษาไทย, หมวดจัดซื้อ, รูปในเนื้อหา, รูปหน้าปก, PDF แนบ, redirect ทั้งลิงก์ไทยและ `?p=` ผ่านใน nginx 1.20

ขั้นตอน (บน .251 สคริปต์ถามอีเมล รหัสผ่าน และรหัส 2FA ของ admin ไม่เก็บไว้ที่ไหน)
```bash
sudo ./scripts/migrate-wp.sh --limit 20   # ลองก่อน 20 ข่าว
sudo ./scripts/migrate-wp.sh              # ทั้งหมด (รันซ้ำได้ ข้ามที่ย้ายแล้ว)
cat migration/out/report.json             # ดูไฟล์ที่ดึงไม่ได้
```
- อ่านเว็บเดิมที่เครื่องนี้เอง (`--resolve` ไป 127.0.0.1) ถ้าเว็บเดิมรับเฉพาะ IP ของเครื่อง ตั้ง `WP_HOST_IP=192.168.1.251`
- ถ้าตรวจแล้วได้ 401/403 แปลว่าปลั๊กอินความปลอดภัยปิด REST API ให้เปิดชั่วคราว
- token ของ Directus อายุ 15 นาที สคริปต์ต่ออายุเองระหว่างย้าย และถ้า slug ซ้ำกับหน้าที่สร้างไว้แล้วจะต่อท้ายด้วย id ของ WordPress
ต้องตรวจด้วยตา: หน้าที่ทำด้วย page builder (Elementor ฯลฯ) อาจจัดหน้าเพี้ยน ให้ประชาสัมพันธ์ช่วยไล่ดูหน้าเว็บสำคัญ (คาดว่า 10–20 หน้า)

ไม่ย้าย: ITA67 และ WordPress อื่นที่อยู่ใน subfolder ยังเป็นเว็บเดิม (ทำเฟสถัดไป), ความเห็น, ผู้ใช้ WP

## 8. Backup / Restore

```bash
./scripts/backup.sh                         # สำรองทันที
./scripts/restore.sh <โฟลเดอร์ชุดสำรอง>      # กู้คืน (ถามยืนยัน และสำรองสถานะปัจจุบันให้ก่อนทับเสมอ)
```
- ชุดสำรองมี: `db.dump` (pg_dump), `uploads.tar.gz`, `env`, `SHA256SUMS` ตรวจความถูกต้องทั้งตอนสำรองและตอนกู้
- cron ทุกวัน 01:30 เก็บรายวัน 14 ชุด + รายสัปดาห์ (วันอาทิตย์) 8 ชุด
  `30 1 * * * /opt/hospweb/scripts/backup.sh >> /var/log/hospweb-backup.log 2>&1`
- ส่งสำเนาไป **NAS 192.168.1.241** ด้วย rsync ผ่าน ssh (ตั้ง `BACKUP_OFFSITE` ใน `.env`)
  1. บน Synology (DSM):
     - Control Panel > File Services > rsync: ติ๊ก **Enable rsync service** (ใช้พอร์ต SSH 22)
     - Control Panel > Terminal & SNMP: ติ๊ก **Enable SSH service**
     - Control Panel > Shared Folder: สร้าง shared folder `backup` (ถ้ามีอยู่แล้วใช้ได้เลย) แล้วสร้างโฟลเดอร์ย่อย `hospweb`
     - Control Panel > User: สร้าง user `hospweb-backup` (ไม่ใช่ administrators) ให้สิทธิ์ Read/Write เฉพาะ shared folder `backup` และในแท็บ Applications ให้ **Allow** เฉพาะ `rsync` นอกนั้น Deny
     - Control Panel > User > Advanced: ติ๊ก **Enable user home service** (ต้องมี home เพื่อเก็บ `.ssh/authorized_keys`)
     - **อย่าติ๊ก "ห้ามเข้าใช้" ที่ shared folder `homes`** ให้ user นี้ (ปล่อยว่าง) ไม่งั้น sshd อ่าน `authorized_keys` ไม่ได้ จะถามรหัสผ่านแทน key (ตรวจด้วย `sudo synoacltool -get /volume1/homes` ต้องไม่มี `user:hospweb-backup:deny`)
  2. บน .251 (user ที่รัน cron): `ssh-keygen -t ed25519 -f ~/.ssh/hospweb_backup -N ''` แล้วคัดลอก public key ไปที่ `/var/services/homes/hospweb-backup/.ssh/authorized_keys` บน NAS (ใช้ File Station อัปโหลดก็ได้ สิทธิ์ `.ssh` 700, ไฟล์ 600)
     ใส่ key ผ่าน ssh ด้วยบัญชี admin ของ DSM: `H=/var/services/homes/hospweb-backup; sudo mkdir -p $H/.ssh; echo '<public key>' | sudo tee $H/.ssh/authorized_keys; sudo chown -R hospweb-backup:users $H; sudo chmod 755 $H; sudo chmod 700 $H/.ssh; sudo chmod 600 $H/.ssh/authorized_keys` (setup-server.sh สร้าง key ให้แล้วที่ `/root/.ssh/hospweb_backup`)
     ทดสอบ: `sudo ssh -o BatchMode=yes 192.168.1.241 true` ถ้าขึ้น `Permission denied, please try again.` แปลว่า key ผ่านแล้ว (Synology ไม่ให้ user นี้เปิด shell แต่ rsync ได้) ถ้าขึ้น `(publickey,password)` แปลว่า key ยังไม่ผ่าน
  3. ใน `~/.ssh/config` ของ .251: `Host 192.168.1.241` / `User hospweb-backup` / `IdentityFile ~/.ssh/hospweb_backup`
  4. ตั้ง `BACKUP_OFFSITE=hospweb-backup@192.168.1.241:/volume1/backup/hospweb` แล้วทดสอบ `./scripts/backup.sh` ดูว่าไฟล์ขึ้นใน File Station
  5. ติดตั้งแพ็กเกจ **Snapshot Replication** (ต้องเป็น volume Btrfs) ตั้ง snapshot รายวันของ shared folder `backup` เก็บ 30 วัน กัน ransomware ที่ลามจาก .251 มาลบ backup เพราะ user `hospweb-backup` ลบ snapshot ไม่ได้
- ตั้ง `BACKUP_GPG_RECIPIENT` ถ้าจะเข้ารหัสชุดสำรองก่อนส่งออก
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
- [ ] เครื่องของ admin01–03: ชี้ `waritch-hosp.moph.go.th` → `192.168.1.251` (DNS ภายใน หรือแก้ `C:\Windows\System32\drivers\etc\hosts` เพิ่ม `192.168.1.251 waritch-hosp.moph.go.th`) แล้วเข้า `https://waritch-hosp.moph.go.th:8443` ต้องใช้ชื่อโดเมน ไม่ใช่ `https://192.168.1.251:8443` เพราะใบรับรองออกให้ *.moph.go.th ถ้าไม่ชี้ จะวิ่งผ่าน router กลายเป็น 192.168.1.1 แล้วถูก deny
- [ ] อัปเกรด nginx 1.20 (2021) เป็นรุ่นที่ยัง support จาก AppStream หรือ nginx.org
- [ ] `dnf-automatic` สำหรับ security update ของ OS, อัปเดต image Directus/Postgres ทุกเดือน (`docker compose pull && up -d` หลัง backup)
- [ ] ส่ง backup ออกนอกเครื่อง (NAS) และทดสอบกู้คืนรายเดือน

## 10. Deploy ลง server จริง

ใช้วิธีเดียวกับย้ายเครื่อง: backup จากเครื่อง dev แล้ว restore บนเครื่องจริง

1. ติดตั้ง Docker บนเครื่องจริง, clone repo ไป `/opt/hospweb`
2. `./scripts/backup.sh` บนเครื่อง dev → คัดลอกชุดสำรองไปเครื่องจริง → `./scripts/restore.sh <ชุด>` (ใช้ `.env` จากชุดสำรอง แก้ `PUBLIC_URL`)
3. วาง nginx: `00-hospweb-maps.conf` และ `hospweb-admin.conf` ใน `/etc/nginx/conf.d/`, `hospweb-proxy.conf` `hospweb-headers.conf` และ `hospweb-public.conf` ใน `/etc/nginx/snippets/`, redirect map ใน `/srv/hospweb/redirects/` แก้ path ใบรับรองให้ตรงกับ `waritch.conf`
4. `sudo ./scripts/build-site.sh --install && sudo ./scripts/build-site.sh --force` แล้วตั้ง cron ของ root: `* * * * * /opt/hospweb/scripts/build-site.sh >> /var/log/hospweb-build.log 2>&1` ตรวจที่ `https://waritch-hosp.moph.go.th:8443/preview/` และให้ประชาสัมพันธ์ตรวจรับ
5. **วัน cut-over** (นอกเวลาราชการ) ปิด WordPress หลัก แต่ยังเก็บไว้ครบเพื่อ rollback
   - สำรอง WordPress เดิมทั้งชุดก่อน: `mysqldump` ฐาน `waritchhosp_db` (อยู่ที่ .254) + `tar` ไฟล์ WordPress หลักใน `/var/www/html` (ไม่รวมโฟลเดอร์แอปอื่น) เก็บที่ `/srv/hospweb/legacy-wp-<วันที่>/` และ NAS
   - รัน migration รอบสุดท้าย (ดึงข่าวที่เพิ่มหลังรอบแรก) แล้ว build ใหม่
   - คัดลอก `wp-content/uploads` เดิมไป `/srv/hospweb/legacy/wp-content/uploads` (ให้ลิงก์รูปเก่าที่เว็บอื่นอ้างถึงยังเปิดได้)
   - เก็บ `conf.d/waritch.conf` ปัจจุบันไว้เป็น `/root/hospweb-cutover/waritch.conf.wp` แล้วแก้ไฟล์จริง: ใส่ `include /etc/nginx/snippets/hospweb-public.conf;` แทน `location /` และ `location ~ \.php$` ส่วนที่เป็นของ WordPress หลัก เก็บ location ของแอปอื่น (`/waritch/`, `/iclaim/`, `/ita67/`, `/dispensingx/`, `/HOSxP_Update/`, `/hs4/` ฯลฯ) และ `snippets/phase0.conf` ไว้ครบ
   - `sudo nginx -t && sudo systemctl reload nginx` ตั้งแต่ตอนนี้ WordPress หลัก**ไม่ถูกเรียกใช้อีก** (ไม่มีเส้นทางจากเว็บไปถึง PHP ของมัน) แต่ไฟล์และ DB ยังอยู่ php-fpm ยังรันต่อเพราะแอปอื่นใช้อยู่
   - ไล่ทดสอบ: หน้าแรก, ข่าว, ลิงก์เดิม 20 ลิงก์สุ่ม, แอปเดิมทุกตัว
6. **Rollback** (ถ้าเว็บใหม่มีปัญหา ใช้เวลาไม่ถึง 1 นาที)
   ```bash
   sudo cp /root/hospweb-cutover/waritch.conf.wp /etc/nginx/conf.d/waritch.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```
   WordPress กลับมาทันทีพร้อมข่าวทั้งหมดจนถึงวัน cut-over ข่าวที่ลงในเว็บใหม่ระหว่างนั้นยังอยู่ใน Directus ค่อยลงซ้ำใน WP หรือรอแก้แล้ว cut-over ใหม่ (redirect map ยังอยู่ ไม่กระทบ WordPress เพราะ include ถูกถอดออกแล้ว)
   ระหว่างช่วงเฝ้าระวัง **ห้ามอัปเดต/ลบ WordPress หลัก** เพื่อให้ rollback ได้เสมอ
7. หลังใช้งานได้ 30 วันไม่มีปัญหา: ย้ายไฟล์ WordPress หลักออกจาก webroot ไปไว้ใน `/srv/hospweb/legacy-wp-<วันที่>/` เก็บ dump DB เดิมไว้บน NAS อย่างน้อย 1 ปี แล้วค่อย drop ฐาน `waritchhosp_db` (ระวัง: `waritch/waritchaphum-hos` ใช้ฐานเดียวกัน ต้องเช็กก่อน)

## 11. ลำดับงานและเวลาโดยประมาณ

| เฟส | งาน | เวลา |
| --- | --- | --- |
| 1 | ตั้ง Directus + DB + backup บนเครื่อง dev (repo นี้), ตั้ง nginx :8443, เปิดบัญชีเจ้าหน้าที่ | 2–3 วัน |
| 2 | หน้าเว็บ Astro + build script + preview | 2–3 สัปดาห์ |
| 3 | ย้ายเนื้อหา + ประชาสัมพันธ์ตรวจ + แก้หน้าเพี้ยน | 1 สัปดาห์ |
| 4 | ทดสอบความปลอดภัย (สแกน, ทดลองกู้คืน), อบรมเจ้าหน้าที่ 1 ชั่วโมง + คู่มือภาพ | 3–4 วัน |
| 5 | cut-over + เฝ้าระวัง 30 วัน | 1 วัน + 30 วัน |

## 12. ข้อสรุปจากคำถาม (17 พ.ย. 2026)

1. ผู้ใช้หลังบ้าน: **admin01, admin02, admin03** (ครบ 3 ที่ของรุ่นฟรีพอดี)
2. คนนอกเข้า admin ไม่ได้ ข้างในเข้า `https://waritch-hosp.moph.go.th:8443` โดยชี้ชื่อโดเมนไปที่ .251
3. backup นอกเครื่องไปที่ **NAS 192.168.1.241**
4. SMTP มี ใส่ทีหลังได้ (ระหว่างนี้ admin01 รีเซ็ตรหัสให้คนอื่น)
5. deploy บน **.251 เดิม** ปิด WordPress หลักตอน cut-over แต่เก็บไว้ rollback ได้ (หัวข้อ 10)

NAS เป็น Synology ตั้งค่าตามหัวข้อ 8

ที่ยังต้องยืนยัน: admin02/03 เป็นผู้ดูแลระบบหรือประชาสัมพันธ์ (ตั้งต้นเป็นประชาสัมพันธ์)
