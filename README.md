# Migration-Web-Hosp

เว็บไซต์โรงพยาบาลใหม่: **Directus 12** (หลังบ้าน) + **PostgreSQL 17** ใน Docker และหน้าเว็บ static ด้วย **Astro**

- แผนเต็ม: [docs/plan.md](docs/plan.md)
- ติดตั้งบน server (.251): `sudo ./scripts/setup-server.sh` (ถอน: `sudo ./scripts/setup-server.sh rollback`)
- เริ่มต้นแบบทำเอง: `./scripts/gen-secrets.sh && docker compose up -d && node directus/bootstrap.mjs`
- สำรอง/กู้คืน: `./scripts/backup.sh`, `./scripts/restore.sh <ชุดสำรอง>`
- หน้าเว็บ: `sudo ./scripts/build-site.sh --install` ครั้งแรก แล้ว cron `./scripts/build-site.sh` ทุก 1 นาที (โค้ดอยู่ใน `site/`)
- ย้ายเนื้อหาจาก WordPress: `node migration/wp-to-directus.mjs`
