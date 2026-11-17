#!/usr/bin/env bash
# สำรองข้อมูลเว็บใหม่: ฐานข้อมูล PostgreSQL + ไฟล์อัปโหลด + .env
#
#   ./scripts/backup.sh            # สำรองทันที
#   ใส่ cron (ทุกวัน 01:30):  30 1 * * * /srv/hospweb/scripts/backup.sh >> /var/log/hospweb-backup.log 2>&1
#
# ผลลัพธ์: $BACKUP_DIR/daily/YYYYmmdd-HHMMSS/  (วันอาทิตย์คัดลอกไป weekly/ ด้วย)
#   db.dump          pg_dump แบบ custom format (ใช้ pg_restore)
#   uploads.tar.gz   ไฟล์รูป/เอกสารทั้งหมดที่อัปโหลดผ่านหลังบ้าน
#   env              สำเนา .env (มี KEY/SECRET ที่ต้องใช้ตอนกู้คืน)
#   SHA256SUMS, info.txt
# ถ้าตั้ง BACKUP_GPG_RECIPIENT จะเข้ารหัสทั้งชุดเป็นไฟล์ .tar.gpg ไฟล์เดียว
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
set -a; source ./.env; set +a

BACKUP_DIR=${BACKUP_DIR:-$ROOT/backups}
KEEP_DAILY=${BACKUP_KEEP_DAILY:-14}
KEEP_WEEKLY=${BACKUP_KEEP_WEEKLY:-8}
DB_USER=${DB_USER:-directus}
DB_DATABASE=${DB_DATABASE:-directus}
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/daily/$STAMP"

log() { echo "[$(date '+%F %T')] $*"; }
umask 077
mkdir -p "$OUT"
trap 'log "ล้มเหลว ลบชุดที่ไม่สมบูรณ์ $OUT"; rm -rf "$OUT"' ERR

log "เริ่มสำรอง -> $OUT"
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_DATABASE" -Fc --no-owner --no-privileges > "$OUT/db.dump"
# ตรวจว่าไฟล์ dump อ่านได้จริง
docker compose exec -T db pg_restore --list < "$OUT/db.dump" > /dev/null
log "ฐานข้อมูล $(du -h "$OUT/db.dump" | cut -f1)"

docker compose exec -T directus tar czf - -C /directus/uploads . > "$OUT/uploads.tar.gz"
tar tzf "$OUT/uploads.tar.gz" > /dev/null
log "ไฟล์อัปโหลด $(du -h "$OUT/uploads.tar.gz" | cut -f1)"

cp .env "$OUT/env"
{
	echo "created: $(date -Iseconds)"
	echo "host: $(hostname)"
	echo "git: $(git rev-parse --short HEAD 2>/dev/null || echo -)"
	docker compose images --format json 2>/dev/null | tr -d '\n' | sed 's/},{/}\n{/g' | grep -oE '"Repository":"[^"]+","Tag":"[^"]+"' || true
} > "$OUT/info.txt"
(cd "$OUT" && sha256sum db.dump uploads.tar.gz env info.txt > SHA256SUMS)
trap - ERR

if [[ -n ${BACKUP_GPG_RECIPIENT:-} ]]; then
	tar cf - -C "$BACKUP_DIR/daily" "$STAMP" | gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" -o "$OUT.tar.gpg"
	rm -rf "$OUT"
	OUT="$OUT.tar.gpg"
	log "เข้ารหัสแล้ว -> $OUT"
fi

# วันอาทิตย์: เก็บสำเนารายสัปดาห์
if [[ $(date +%u) == 7 ]]; then
	mkdir -p "$BACKUP_DIR/weekly"
	cp -a "$OUT" "$BACKUP_DIR/weekly/"
fi

# ลบชุดเก่าเกินจำนวนที่กำหนด
prune() {
	local dir=$1 keep=$2
	[[ -d $dir ]] || return 0
	ls -1d "$dir"/* 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
		rm -rf -- "$old"
		log "ลบชุดเก่า $old"
	done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

# ส่งไปเก็บอีกเครื่อง (เช่น NAS) ถ้าตั้งไว้ เช่น BACKUP_OFFSITE=backup@192.168.1.20:/volume1/hospweb
if [[ -n ${BACKUP_OFFSITE:-} ]]; then
	rsync -a --delete "$BACKUP_DIR/" "$BACKUP_OFFSITE/"
	log "ส่งสำเนาไป $BACKUP_OFFSITE แล้ว"
fi
log "เสร็จ"
