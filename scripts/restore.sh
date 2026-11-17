#!/usr/bin/env bash
# กู้คืนจากชุดสำรองที่ได้จาก backup.sh (ใช้ย้ายจากเครื่องทดลองไป server จริงได้ด้วย)
#
#   ./scripts/restore.sh /srv/backup/hospweb/daily/20261117-013000
#   ./scripts/restore.sh /srv/backup/hospweb/daily/20261117-013000.tar.gpg   # ชุดที่เข้ารหัส
#   เพิ่ม --yes เพื่อไม่ต้องพิมพ์ยืนยัน
#
# ขั้นตอน: ตรวจ checksum -> สำรองสถานะปัจจุบันไว้ก่อน -> หยุด directus -> แทนที่ฐานข้อมูลและไฟล์อัปโหลด -> เปิด directus
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=${1:?ระบุโฟลเดอร์ชุดสำรอง}
YES=${2:-}
log() { echo "[$(date '+%F %T')] $*"; }

TMP=""
cleanup() { [[ -n $TMP ]] && rm -rf "$TMP"; }
trap cleanup EXIT
if [[ $SRC == *.tar.gpg ]]; then
	TMP=$(mktemp -d)
	gpg --batch --decrypt "$SRC" | tar xf - -C "$TMP"
	SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
fi
[[ -f $SRC/db.dump && -f $SRC/uploads.tar.gz && -f $SRC/SHA256SUMS ]] || { echo "ไม่พบไฟล์ครบใน $SRC"; exit 1; }
(cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || { echo "checksum ไม่ตรง ไฟล์สำรองเสียหาย"; exit 1; }
log "checksum ถูกต้อง"

# .env: เครื่องใหม่ใช้ของชุดสำรองได้เลย เครื่องเดิมต้องมี KEY/SECRET ตรงกัน
if [[ ! -f .env ]]; then
	install -m 600 "$SRC/env" .env
	log "ยังไม่มี .env ใช้ของชุดสำรอง (แก้ PUBLIC_URL ถ้าย้ายเครื่อง)"
elif ! diff -q <(grep -E '^(DIRECTUS_KEY|DIRECTUS_SECRET)=' .env) <(grep -E '^(DIRECTUS_KEY|DIRECTUS_SECRET)=' "$SRC/env") > /dev/null; then
	echo "!! DIRECTUS_KEY/SECRET ใน .env ไม่ตรงกับชุดสำรอง ค่าที่เข้ารหัสไว้ (เช่น token) จะอ่านไม่ได้"
	echo "   ถ้าตั้งใจกู้ทั้งระบบ ให้ใช้ค่าจาก $SRC/env"
fi
set -a; source ./.env; set +a
DB_USER=${DB_USER:-directus}
DB_DATABASE=${DB_DATABASE:-directus}

if [[ $YES != --yes ]]; then
	echo "ข้อมูลปัจจุบันทั้งหมด (ฐานข้อมูล + ไฟล์อัปโหลด) จะถูกแทนที่ด้วยชุด $SRC"
	read -r -p "พิมพ์ YES เพื่อยืนยัน: " ans
	[[ $ans == YES ]] || { echo "ยกเลิก"; exit 1; }
fi

docker compose up -d db
until docker compose exec -T db pg_isready -U "$DB_USER" -d postgres > /dev/null 2>&1; do sleep 2; done

# สำรองสถานะปัจจุบันก่อนทับ (ถ้ามีข้อมูล)
if docker compose exec -T db psql -U "$DB_USER" -d "$DB_DATABASE" -tAc "select 1 from information_schema.tables where table_name='directus_users'" 2>/dev/null | grep -q 1; then
	log "สำรองสถานะปัจจุบันไว้ก่อน"
	docker compose up -d directus
	until [[ $(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q directus)") == healthy ]]; do sleep 3; done
	BACKUP_KEEP_DAILY=9999 ./scripts/backup.sh
fi

log "หยุด directus"
docker compose stop directus

log "กู้ฐานข้อมูล"
docker compose exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q <<SQL
DROP DATABASE IF EXISTS "$DB_DATABASE" WITH (FORCE);
CREATE DATABASE "$DB_DATABASE" OWNER "$DB_USER";
SQL
docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_DATABASE" --no-owner --no-privileges --exit-on-error < "$SRC/db.dump"

log "กู้ไฟล์อัปโหลด"
docker compose run --rm --no-deps -T --entrypoint sh directus \
	-c 'find /directus/uploads -mindepth 1 -delete && tar xzf - -C /directus/uploads' < "$SRC/uploads.tar.gz"

log "เปิด directus"
docker compose up -d directus
for _ in $(seq 1 60); do
	[[ $(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q directus)") == healthy ]] && { log "กู้คืนเสร็จ ระบบพร้อมใช้"; exit 0; }
	sleep 3
done
echo "directus ยังไม่ healthy ดู log: docker compose logs directus"
exit 1
