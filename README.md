# Migration-Web-Hosp

เว็บไซต์โรงพยาบาลใหม่: **Directus 12** (หลังบ้าน) + **PostgreSQL 17** ใน Docker และหน้าเว็บ static ด้วย **Astro**

- แผนเต็ม: [docs/plan.md](docs/plan.md)
- เริ่มต้น: `./scripts/gen-secrets.sh && docker compose up -d && node directus/bootstrap.mjs`
- สำรอง/กู้คืน: `./scripts/backup.sh`, `./scripts/restore.sh <ชุดสำรอง>`
- ย้ายเนื้อหาจาก WordPress: `node migration/wp-to-directus.mjs`
