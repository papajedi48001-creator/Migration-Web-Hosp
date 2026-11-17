#!/usr/bin/env bash
# สร้างหน้าเว็บ static จาก Directus แล้วสลับให้ nginx เสิร์ฟทันที (ไม่มีช่วงที่เว็บล่ม)
#
#   ./scripts/build-site.sh              # สร้างใหม่เฉพาะเมื่อเนื้อหาเปลี่ยน (cron เรียกทุก 1 นาที)
#   ./scripts/build-site.sh --force      # สร้างใหม่ทั้งสองชุดทันที
#   ./scripts/build-site.sh --install    # ติดตั้ง/อัปเดต package ของ site/ (ครั้งแรก และหลัง git pull ที่แก้ package.json) ต้องใช้ sudo
#                                        ถ้าออกเน็ตผ่าน proxy: ตั้ง HTTPS_PROXY หรือ INSTALL_DOCKER_ARGS="--network host ..." 
#   ./scripts/build-site.sh --rollback   # ถอยหน้าเว็บสาธารณะกลับไป release ก่อนหน้า
#
# ผลลัพธ์ ($SITE_ROOT ค่าเริ่ม /srv/hospweb)
#   site/releases/<เวลา>/   site/current -> release ล่าสุด          หน้าเว็บจริง (เฉพาะที่เผยแพร่)
#   preview/releases/<เวลา>/ preview/current -> release ล่าสุด      :8443/preview/ (รวมฉบับร่าง)
# ระหว่าง build ใช้ site/out/ และ site/.cache/media/ (รูปและไฟล์จาก Directus ใช้ซ้ำทุก build)
# แต่ละ release ใช้ hardlink กับ release ก่อนหน้าสำหรับไฟล์ที่ไม่เปลี่ยน จึงเก็บหลายชุดได้โดยไม่เปลืองพื้นที่
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=${1:-}
log() { echo "[$(date '+%F %T')] $*"; }

set -a; source ./.env; set +a
ROOT=${SITE_ROOT:-/srv/hospweb}
KEEP=${SITE_KEEP_RELEASES:-5}
API="http://127.0.0.1:${DIRECTUS_PORT:-8055}"
IMAGE=$(awk '/^  site-builder:/{f=1} f&&/image:/{print $2; exit}' compose.yaml)
BUILDER_UID=1000

if [[ $MODE == --install ]]; then
	[[ $EUID -eq 0 ]] || { echo "ใช้ sudo"; exit 1; }
	command -v rsync > /dev/null || dnf install -y rsync
	mkdir -p "$ROOT"/{site,preview}/releases site/.cache site/.astro site/out
	chown -R $BUILDER_UID:$BUILDER_UID site/.cache site/.astro site/out
	[[ -d site/dist ]] && chown -R $BUILDER_UID:$BUILDER_UID site/dist
	docker volume inspect "${COMPOSE_PROJECT_NAME:-hospweb}_site-node-modules" > /dev/null 2>&1 ||
		docker volume create --label com.docker.compose.project="${COMPOSE_PROJECT_NAME:-hospweb}" --label com.docker.compose.volume=site-node-modules "${COMPOSE_PROJECT_NAME:-hospweb}_site-node-modules" > /dev/null
	# ติดตั้งผ่านอินเทอร์เน็ต (ตัว builder จริงอยู่ในเครือข่ายปิด จึงใช้ container แยกขั้นนี้)
	docker run --rm -v "$PWD/site:/site:z" -v "${COMPOSE_PROJECT_NAME:-hospweb}_site-node-modules":/site/node_modules -w /site \
		-e HOME=/tmp -e npm_config_update_notifier=false \
		${HTTPS_PROXY:+-e HTTPS_PROXY} ${HTTP_PROXY:+-e HTTP_PROXY} ${NO_PROXY:+-e NO_PROXY} \
		${INSTALL_DOCKER_ARGS:-} \
		"$IMAGE" sh -c "npm ci --no-audit --no-fund && chown -R $BUILDER_UID:$BUILDER_UID node_modules"
	log "ติดตั้ง package เรียบร้อย"
	exit 0
fi

[[ -n ${DIRECTUS_READ_TOKEN:-} ]] || { echo "ยังไม่ได้ตั้ง DIRECTUS_READ_TOKEN ใน .env"; exit 1; }
command -v rsync > /dev/null || { echo "ต้องติดตั้ง rsync ก่อน (sudo ./scripts/build-site.sh --install)"; exit 1; }

# รันทีละรอบ (cron ทุกนาที แต่ build อาจนานกว่านั้น)
exec 9> "$ROOT/.build.lock"
flock -n 9 || exit 0

# ---------- เนื้อหาเปลี่ยนหรือยัง ----------
# นับจำนวนและเวลาแก้ไขล่าสุดของทุกตาราง (จับได้ทั้งเพิ่ม แก้ ลบ เปลี่ยนสถานะ)
q() { curl -fsSg --max-time 20 -H "authorization: Bearer $DIRECTUS_READ_TOKEN" "$API$1"; }
fingerprint() {
	{
		for c in news pages banners; do q "/items/$c?aggregate[count]=*&aggregate[max]=date_updated,date_created"; done
		q "/items/news_files?aggregate[count]=*&aggregate[max]=id"
		q "/items/site_settings"
		q "/files?aggregate[count]=*&aggregate[max]=modified_on,uploaded_on"
		git rev-parse HEAD 2> /dev/null || true # แก้โค้ดหน้าเว็บแล้ว git pull ก็ build ใหม่
	} | sha256sum | cut -c1-16
}
FP=$(fingerprint) || { log "อ่าน Directus ไม่ได้ ข้ามรอบนี้"; exit 1; }
if [[ $MODE == --rollback ]]; then
	cur=$(readlink "$ROOT/site/current" || true)
	prev=$(ls -1d "$ROOT"/site/releases/*/ 2> /dev/null | sed 's#/$##' | sort | grep -B1 -F "$(basename "${cur:-none}")" | head -1)
	[[ -n $prev && $(basename "$prev") != $(basename "${cur:-none}") ]] || { echo "ไม่มี release ก่อนหน้า"; exit 1; }
	ln -sfn "releases/$(basename "$prev")" "$ROOT/site/current.tmp" && mv -T "$ROOT/site/current.tmp" "$ROOT/site/current"
	# ไม่ให้ cron build ทับทันที: พักไว้จนกว่าจะมีการแก้เนื้อหาในหลังบ้าน
	echo "$FP" > "$ROOT/site/.hold"
	log "ถอยหน้าเว็บกลับไปที่ $(basename "$prev") แล้ว (สร้างใหม่อัตโนมัติเมื่อมีการแก้เนื้อหาครั้งถัดไป หรือสั่ง --force)"
	exit 0
fi

# หน้าเว็บจริง build ซ้ำทุกชั่วโมงด้วย เพื่อให้ข่าวที่ตั้งเวลาประกาศ และแบนเนอร์ที่ตั้งช่วงวันแสดง ขึ้น/ลงตามเวลา
HOUR=$(TZ=Asia/Bangkok date +%Y%m%d%H)

build() { # build <public|preview> <fingerprint>
	local target=$1 fp=$2 dir="$ROOT/site"
	[[ $target == preview ]] && dir="$ROOT/preview"
	if [[ $MODE != --force ]]; then
		[[ -f $dir/.fingerprint && $(cat "$dir/.fingerprint") == "$fp" ]] && return 0
		# หลัง --rollback: ข้ามจนกว่าเนื้อหาจะเปลี่ยนจริง
		[[ -f $dir/.hold && $(cat "$dir/.hold") == "$FP" ]] && return 0
	fi
	rm -f "$dir/.hold"

	local rel; rel=$(date +%Y%m%d-%H%M%S)
	log "build $target -> $rel"
	local preview=0
	[[ $target == preview ]] && preview=1
	if ! docker compose --profile build run --rm -T -e SITE_PREVIEW=$preview -e SITE_OUT="out/$target" \
		site-builder npm run --silent build > "$dir/build.log" 2>&1; then
		log "build $target ไม่สำเร็จ ดู $dir/build.log (หน้าเว็บยังเป็นชุดเดิม)"
		return 1
	fi
	# ไฟล์ที่เหมือน release ปัจจุบันใช้ hardlink ร่วมกัน
	local link=()
	[[ -d $dir/current/ ]] && link=(--link-dest="$(readlink -f "$dir/current")/")
	rsync -a --delete "${link[@]}" "site/out/$target/" "$dir/releases/$rel/" || { log "คัดลอกผล build $target ไม่สำเร็จ"; rm -rf "${dir:?}/releases/$rel"; return 1; }

	# ตรวจผลก่อนสลับ: ต้องมีหน้าหลัก และจำนวนหน้าไม่หายไปเกินครึ่ง (กันกรณีอ่านข้อมูลมาไม่ครบ)
	local new="$dir/releases/$rel" pages old=0
	for f in index.html 404.html news/index.html pagefind/pagefind.js; do
		[[ -f $new/$f ]] || { log "build $target ไม่มี $f ยกเลิก"; rm -rf "$new"; return 1; }
	done
	pages=$(find "$new" -name '*.html' | wc -l)
	[[ -L $dir/current ]] && old=$(find -L "$dir/current/" -name '*.html' | wc -l)
	if [[ $MODE != --force && $old -gt 20 && $pages -lt $((old / 2)) ]]; then
		log "build $target ได้ $pages หน้า (เดิม $old) น้อยผิดปกติ ไม่สลับ ตรวจแล้วสั่ง --force"
		rm -rf "$new"
		return 1
	fi

	ln -sfn "releases/$rel" "$dir/current.tmp" && mv -T "$dir/current.tmp" "$dir/current"
	echo "$fp" > "$dir/.fingerprint"
	log "เผยแพร่ $target แล้ว ($pages หน้า)"
	# เก็บไว้ $KEEP ชุดล่าสุด (ถอยกลับได้ด้วย --rollback)
	ls -1d "$dir"/releases/*/ | sort | head -n -"$KEEP" | xargs -r rm -rf
}

status=0
build preview "$FP" || status=1 # ฉบับร่างก่อน เพราะเจ้าหน้าที่กำลังรอดูอยู่
build public "$FP-$HOUR" || status=1

# ไฟล์ใน cache ที่ไม่มีหน้าไหนใช้มา 30 วันแล้ว ลบทิ้ง (build จดเวลาใช้ล่าสุดไว้ที่ atime)
find site/.cache/media -type f -atime +30 -delete 2> /dev/null || true
exit $status
