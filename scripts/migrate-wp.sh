#!/usr/bin/env bash
# ย้ายข่าว หน้าเว็บ รูป และไฟล์แนบ จาก WordPress เดิม (บนเครื่องนี้) เข้า Directus
# อ่านเว็บเดิมผ่าน REST API (index.php?rest_route=) อย่างเดียว ไม่แก้อะไรบนเว็บเดิม รันซ้ำได้ (ข้ามรายการที่ย้ายแล้ว)
#
#   sudo ./scripts/migrate-wp.sh --limit 20     # ลองก่อน 20 รายการ
#   sudo ./scripts/migrate-wp.sh                # ทั้งหมด
#   sudo ./scripts/migrate-wp.sh --only pages   # เฉพาะหน้าเว็บ (หรือ --only posts)
#   sudo ./scripts/migrate-wp.sh --dry-run      # อ่านอย่างเดียว ไม่เขียน Directus
#
# จะถามอีเมล รหัสผ่าน และรหัส 2FA ของ admin (ไม่เก็บไว้ที่ไหน)
# ค่าที่เปลี่ยนได้: WP_URL (ค่าเริ่ม SITE_URL ใน .env), WP_HOST_IP (IP ที่เว็บเดิมรับอยู่ ค่าเริ่ม 127.0.0.1)
#   WP_INSECURE=1 ไม่ตรวจใบรับรองของเว็บเดิม (ใช้เมื่อ chain ไม่ครบ ปลอดภัยเพราะต่อเข้าเครื่องตัวเอง)
# ผลลัพธ์: migration/out/report.json, redirects.map, redirects-p.map (ใช้ตอนสลับเว็บ)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source ./.env; set +a

WP_URL=${WP_URL:-${SITE_URL:-https://waritch-hosp.moph.go.th}}
WP_URL=${WP_URL%/}
WP_HOST=$(sed -E 's#^https?://([^/:]+).*#\1#' <<< "$WP_URL")
WP_PORT=443; [[ $WP_URL == http://* ]] && WP_PORT=80
[[ $WP_URL =~ ^https?://[^/]+:([0-9]+) ]] && WP_PORT=${BASH_REMATCH[1]}
WP_HOST_IP=${WP_HOST_IP:-127.0.0.1}
IMAGE=$(awk '/^  site-builder:/{f=1} f&&/image:/{print $2; exit}' compose.yaml)
DIRECTUS_URL="http://127.0.0.1:${DIRECTUS_PORT:-8055}"

docker image inspect "$IMAGE" > /dev/null 2>&1 || { echo "ไม่มี image $IMAGE (รัน sudo ./scripts/build-site.sh --install ก่อน)"; exit 1; }

# เว็บเดิมเปิด REST API ไว้ไหม (ปลั๊กอินความปลอดภัยบางตัวปิดไว้)
check() {
	local err; err=$(mktemp)
	curl -sS -m 20 ${WP_INSECURE:+-k} --noproxy '*' --resolve "$WP_HOST:$WP_PORT:$WP_HOST_IP" -o /dev/null -D - "$WP_URL/index.php?rest_route=/wp/v2/$1&per_page=1" 2> "$err" |
		awk -v t="$1" 'NR==1{code=$2} tolower($1)=="x-wp-total:"{n=$2} END{gsub(/\r/,"",n); printf "  %-6s HTTP %s  %s รายการ\n", t, (code==""?"000":code), (n==""?"?":n); exit (code!=200)}'
	local rc=$?
	[[ -s $err ]] && sed 's/^/         /' "$err"
	rm -f "$err"
	return $rc
}
echo "ตรวจเว็บเดิม $WP_URL (ผ่าน $WP_HOST_IP)"
ok=1
for t in posts pages; do check "$t" || ok=0; done
if [[ $ok == 0 ]]; then
	cat << EOF
อ่าน REST API ของเว็บเดิมไม่ได้
- ถ้าขึ้น curl: (60) SSL certificate problem: ใบรับรองของเว็บเดิมไม่ได้แนบ intermediate (chain ไม่ครบ)
  เราอ่านจากเครื่องตัวเองจึงข้ามการตรวจได้: sudo WP_INSECURE=1 ./scripts/migrate-wp.sh ...
- ถ้าขึ้น HTTP 000 แบบอื่น: เว็บเดิมไม่ได้รับที่ $WP_HOST_IP ลองตั้ง WP_HOST_IP=192.168.1.251
- ถ้าขึ้น 401/403: ปลั๊กอินความปลอดภัยใน WordPress ปิด REST API ไว้ ให้เปิดชั่วคราวระหว่างย้าย
EOF
	exit 1
fi

if [[ " $* " != *" --dry-run "* ]]; then
	read -r -p "อีเมล admin [admin01@$WP_HOST]: " ADMIN_EMAIL
	ADMIN_EMAIL=${ADMIN_EMAIL:-admin01@$WP_HOST}
	read -r -s -p "รหัสผ่าน: " ADMIN_PASSWORD; echo
	read -r -p "รหัส 2FA 6 หลัก (ใส่ตอนรหัสใหม่เพิ่งขึ้น): " ADMIN_OTP
	export ADMIN_EMAIL ADMIN_PASSWORD ADMIN_OTP
fi

mkdir -p migration/out
docker run --rm --network host --add-host "$WP_HOST:$WP_HOST_IP" \
	-v "$PWD/migration:/migration:z" -w /migration \
	-e WP_URL="$WP_URL" -e DIRECTUS_URL="$DIRECTUS_URL" -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_OTP \
	${WP_INSECURE:+-e NODE_TLS_REJECT_UNAUTHORIZED=0} \
	"$IMAGE" node wp-to-directus.mjs "$@"

echo
echo "เสร็จ หน้าเว็บจะ build ใหม่เองภายในไม่กี่นาที ตรวจได้ที่ ${PUBLIC_URL:-https://$WP_HOST:8443}/preview/"
echo "ไฟล์ที่ดึงไม่ได้ (ถ้ามี): migration/out/report.json"
