#!/usr/bin/env bash
# เฟส 1: ติดตั้งระบบเว็บใหม่บน 192.168.1.251 (หลังบ้าน + หน้าเว็บตัวอย่าง) โดยยังไม่แตะเว็บจริง
#
#   sudo git clone https://github.com/papajedi48001-creator/Migration-Web-Hosp /opt/hospweb
#   cd /opt/hospweb && sudo ./scripts/setup-server.sh
#
#   sudo ./scripts/setup-server.sh rollback   # ถอด nginx :8443, firewall, cron และหยุด container (ข้อมูลไม่ถูกลบ)
#
# ทำอะไรบ้าง (รันซ้ำได้ ขั้นที่ทำแล้วจะข้าม)
#   1. ตรวจเครื่อง: docker compose, nginx, ใบรับรองใน waritch.conf, พอร์ต 8055/8443 ว่าง  ติดตั้ง rsync/cronie ถ้ายังไม่มี
#   2. สร้าง .env + รหัสลับ  เปิด Directus + PostgreSQL  ตั้งค่าหลังบ้าน (ภาษาไทย ตาราง สิทธิ์ 2FA)
#   3. nginx: หลังบ้าน https://waritch-hosp.moph.go.th:8443 (LAN เท่านั้น) และ /preview/
#      วาง snippet หน้าเว็บใหม่ไว้เฉย ๆ ยังไม่ include ใน waritch.conf  เว็บ WordPress เดิมจึงไม่เปลี่ยน
#   4. firewalld เปิด 8443 เฉพาะวง IP ใน ADMIN_LAN_CIDRS (ค่าเริ่ม 192.168.0.0/16 และ 172.18.0.0/16), SELinux ให้ nginx อ่าน /srv/hospweb ได้
#   5. build หน้าเว็บครั้งแรก  cron: build ทุก 1 นาที, backup ทุกวัน 01:30
#   6. กุญแจ ssh สำหรับส่ง backup ไป NAS 192.168.1.241 (แสดง public key ให้นำไปใส่ใน Synology)
#
# ไม่แตะ: conf.d/waritch.conf, WordPress, แอปเดิม (/waritch/, /iclaim/, ฯลฯ), container ของ waritch-backoffice
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
TS=$(date +%Y%m%d-%H%M%S)
BK=/root/hospweb-setup-backup
NGX=${NGX_DIR:-/etc/nginx}
WARITCH=$NGX/conf.d/waritch.conf
DATA=/srv/hospweb # อ่านจาก SITE_ROOT ใน .env อีกทีด้านล่าง
NAS=192.168.1.241
CRON=/etc/cron.d/hospweb
NGX_FILES=(conf.d/00-hospweb-maps.conf conf.d/hospweb-admin.conf snippets/hospweb-proxy.conf snippets/hospweb-headers.conf snippets/hospweb-public.conf)

say() { printf '\n== %s\n' "$*"; }
warn() { printf '!! %s\n' "$*"; }
die() { printf '!! %s\n' "$*"; exit 1; }
[[ $EUID -eq 0 ]] || die "ต้องรันด้วย sudo"
firewall_active() { systemctl is-active -q firewalld 2> /dev/null; }
# วง IP ของเครื่องในโรงพยาบาลที่ให้เข้าหลังบ้านได้ (ตั้ง ADMIN_LAN_CIDRS ใน .env คั่นด้วยช่องว่าง)
[[ -f .env ]] && ADMIN_LAN_CIDRS=$(sed -n 's/^ADMIN_LAN_CIDRS=//p' .env | tr -d '"')
read -r -a LANS <<< "${ADMIN_LAN_CIDRS:-192.168.0.0/16 172.18.0.0/16}"
rich() { echo "rule family=\"ipv4\" source address=\"$1\" port port=\"8443\" protocol=\"tcp\" accept"; }

# ---------------------------------------------------------------- rollback
if [[ ${1:-} == rollback ]]; then
	say "rollback"
	for f in "${NGX_FILES[@]}"; do
		if [[ -f $BK/nginx-before/$f ]]; then cp -a "$BK/nginx-before/$f" "$NGX/$f"; else rm -f "$NGX/$f"; fi
	done
	grep -q 'hospweb-public.conf' "$WARITCH" 2> /dev/null && warn "waritch.conf ยัง include hospweb-public.conf อยู่ (ทำตอน cut-over) ใช้ขั้น rollback ของ cut-over ใน docs/plan.md ก่อน"
	nginx -t && systemctl reload nginx
	if firewall_active; then
		firewall-cmd --permanent --list-rich-rules | grep 'port="8443"' | while read -r r; do firewall-cmd -q --permanent --remove-rich-rule="$r"; done
		firewall-cmd -q --reload
	fi
	rm -f "$CRON"
	docker compose stop || true
	say "rollback เสร็จ  ข้อมูล (ฐานข้อมูล ไฟล์อัปโหลด .env $DATA) ยังอยู่ครบ รัน setup อีกครั้งเมื่อพร้อม"
	exit 0
fi

mkdir -p "$BK" && chmod 700 "$BK"
exec > >(tee -a "$BK/setup-$TS.log") 2>&1
say "เริ่มติดตั้ง $(date '+%F %T') จาก $REPO ($(git rev-parse --short HEAD 2> /dev/null || echo '?'))"
[[ $REPO == /opt/hospweb ]] || warn "แนะนำให้วาง repo ที่ /opt/hospweb (ตอนนี้อยู่ $REPO ใช้ต่อได้ cron จะชี้มาที่นี่)"

# ---------------------------------------------------------------- 1. ตรวจเครื่อง
say "1. ตรวจเครื่อง"
docker compose version > /dev/null 2>&1 || die "ไม่พบ docker compose (dnf install docker-compose-plugin)"
command -v nginx > /dev/null || die "ไม่พบ nginx"
[[ -f $WARITCH ]] || die "ไม่พบ $WARITCH"
for p in rsync cronie openssl openssh-clients policycoreutils-python-utils; do
	rpm -q "$p" > /dev/null 2>&1 || { echo "ติดตั้ง $p"; dnf install -y -q "$p"; }
done
systemctl enable --now crond > /dev/null

CRT=$(grep -E '^\s*ssl_certificate\s' "$WARITCH" | head -1 | awk '{print $2}' | tr -d ';')
KEY=$(grep -E '^\s*ssl_certificate_key\s' "$WARITCH" | head -1 | awk '{print $2}' | tr -d ';')
[[ -s $CRT && -s $KEY ]] || die "อ่าน path ใบรับรองจาก $WARITCH ไม่ได้"
echo "ใบรับรอง: $CRT ($(openssl x509 -noout -enddate -in "$CRT"))"

[[ -f .env ]] && { set -a; source ./.env; set +a; }
PORT=${DIRECTUS_PORT:-8055}
DATA=${SITE_ROOT:-/srv/hospweb}
if ss -ltnH "sport = :$PORT" | grep -q . && ! docker compose ps -q directus 2> /dev/null | grep -q .; then
	die "พอร์ต $PORT มีโปรแกรมอื่นใช้อยู่ ตั้ง DIRECTUS_PORT ใน .env เป็นพอร์ตอื่นแล้วรันใหม่"
fi
other=$(grep -rlE '^\s*listen\s+([0-9.]+:)?8443\b' "$NGX/conf.d" 2> /dev/null | grep -v hospweb-admin.conf || true)
[[ -z $other ]] || die "พอร์ต 8443 ถูกใช้ใน $other อยู่แล้ว"
if [[ ! -f $NGX/conf.d/hospweb-admin.conf ]] && ss -ltnH 'sport = :8443' | grep -q .; then
	die "มีโปรแกรมอื่นใช้พอร์ต 8443 อยู่ (ดู: ss -ltnp 'sport = :8443')"
fi

# ---------------------------------------------------------------- 2. Directus
say "2. Directus + PostgreSQL"
NEW_ENV=0
[[ -f .env ]] || NEW_ENV=1
SECRETS=$(./scripts/gen-secrets.sh)
[[ -n $SECRETS ]] && { echo "$SECRETS" | grep -v 'รหัสผ่าน admin' || true; }
set -a; source ./.env; set +a
# ค่าที่เพิ่มใน .env.example หลังจากสร้าง .env ไปแล้ว
for k in DIRECTUS_READ_TOKEN SITE_URL SITE_ROOT ADMIN_LAN_CIDRS HOSPWEB_NET_BACKEND HOSPWEB_NET_EGRESS; do
	grep -qE "^$k=" .env || grep -E "^$k=" .env.example >> .env
done
set -a; source ./.env; set +a

# ดึง image (ถ้าดึงไม่ได้ เช่นโดน Docker Hub จำกัดจำนวนครั้ง แต่มี image ในเครื่องแล้ว ก็ใช้ต่อได้)
docker compose --profile build pull -q || warn "ดึง image ใหม่ไม่ได้ ใช้ image ที่มีในเครื่อง"

# วง IP ของ Docker ต้องไม่ทับเส้นทางอื่นของเครื่อง (ไม่งั้นเครื่องในวงนั้นจะติดต่อ .251 ไม่ได้)
NET_BACKEND=${HOSPWEB_NET_BACKEND:-10.250.230.0/24}
NET_EGRESS=${HOSPWEB_NET_EGRESS:-10.250.231.0/24}
P=${COMPOSE_PROJECT_NAME:-hospweb}
mine=$(docker network ls -q --filter "label=com.docker.compose.project=$P" | xargs -r -I{} echo br-{} | cut -c1-15 | paste -sd'|')
clash=$(ip -4 route show | grep -vE "${mine:-^$}" | python3 -c '
import ipaddress, sys
want = [ipaddress.ip_network(n) for n in sys.argv[1:]]
for line in sys.stdin:
    dst = line.split()[0]
    if dst == "default":
        continue
    try:
        net = ipaddress.ip_network(dst, strict=False)
    except ValueError:
        continue
    for w in want:
        if net.overlaps(w):
            print(f"{w} ทับกับ {line.strip()}")
' "$NET_BACKEND" "$NET_EGRESS")
[[ -z $clash ]] || die "วง IP ของ Docker ชนกับเครือข่ายที่มีอยู่: $clash  ตั้ง HOSPWEB_NET_BACKEND/HOSPWEB_NET_EGRESS ใน .env เป็นวงอื่น"
for c in "${LANS[@]}"; do
	python3 -c 'import ipaddress,sys; a=ipaddress.ip_network(sys.argv[1]); sys.exit(any(a.overlaps(ipaddress.ip_network(n)) for n in sys.argv[2:]))' "$c" "$NET_BACKEND" "$NET_EGRESS" ||
		die "วง $c ใน ADMIN_LAN_CIDRS ทับกับวงของ Docker"
done
for n in backend egress; do # network เดิมที่วงไม่ตรงกับที่ตั้งไว้ ต้องสร้างใหม่ (ข้อมูลอยู่ใน volume ไม่หาย)
	want=$([[ $n == backend ]] && echo "$NET_BACKEND" || echo "$NET_EGRESS")
	have=$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "${P}_$n" 2> /dev/null || true)
	if [[ -n $have && $have != "$want" ]]; then
		echo "network ${P}_$n ใช้วง $have ต้องเปลี่ยนเป็น $want: หยุด container ชั่วคราว"
		docker compose down
		break
	fi
done

docker compose up -d
echo -n "รอ Directus พร้อม"
for i in $(seq 1 60); do
	[[ $(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q directus)" 2> /dev/null) == healthy ]] && break
	[[ $i == 60 ]] && die "Directus ไม่พร้อมใน 3 นาที ดู: docker compose logs directus"
	echo -n .; sleep 3
done
echo " พร้อม"

NODE_IMAGE=$(awk '/^  site-builder:/{f=1} f&&/image:/{print $2; exit}' compose.yaml)
bootstrap() {
	docker run --rm --network host -v "$REPO/directus:/app:ro,z" -w /app \
		-e DIRECTUS_URL="http://127.0.0.1:$PORT" -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_OTP -e PUBLIC_URL \
		"$NODE_IMAGE" node bootstrap.mjs
}
if [[ -z ${DIRECTUS_READ_TOKEN:-} ]]; then
	[[ -n ${ADMIN_PASSWORD:-} ]] || die "ไม่มี ADMIN_PASSWORD ใน .env สำหรับตั้งค่าครั้งแรก"
	out=$(ADMIN_OTP=${ADMIN_OTP:-} bootstrap) || { echo "$out"; die "ตั้งค่าหลังบ้านไม่สำเร็จ (ถ้า admin01 ตั้ง 2FA แล้ว รันใหม่ด้วย sudo ADMIN_OTP=123456 ./scripts/setup-server.sh)"; }
	echo "$out" | grep -v '^DIRECTUS_READ_TOKEN=' || true
	token=$(echo "$out" | sed -n 's/^DIRECTUS_READ_TOKEN=//p')
	if [[ -n $token ]]; then
		sed -i "s|^DIRECTUS_READ_TOKEN=.*|DIRECTUS_READ_TOKEN=$token|" .env
		export DIRECTUS_READ_TOKEN=$token
		echo "บันทึก DIRECTUS_READ_TOKEN ลง .env แล้ว"
	else
		warn "บัญชี 'ระบบ build เว็บ' มีอยู่แล้ว token จึงไม่แสดงซ้ำ ให้ admin สร้าง token ใหม่ในหลังบ้าน (ผู้ใช้ > site-reader > Token) แล้วใส่ DIRECTUS_READ_TOKEN ใน .env"
	fi
elif [[ -n ${ADMIN_OTP:-} ]]; then
	bootstrap # อัปเดตโครงสร้างหลังบ้านหลัง git pull (ต้องใส่ OTP เพราะ admin ตั้ง 2FA แล้ว)
else
	echo "ตั้งค่าหลังบ้านไปแล้ว (ถ้าต้องการอัปเดตโครงสร้างหลัง git pull: sudo ADMIN_OTP=<รหัส 6 หลัก> ./scripts/setup-server.sh)"
fi

# ---------------------------------------------------------------- 3. โฟลเดอร์ + SELinux
say "3. โฟลเดอร์เว็บ $DATA"
mkdir -p "$DATA"/{site/releases,preview/releases,redirects,legacy}
for m in redirects.map redirects-p.map; do
	[[ -f $DATA/redirects/$m ]] || echo "# สร้างโดย migration/wp-to-directus.mjs (ตอนนี้ยังว่าง)" > "$DATA/redirects/$m"
done
chmod 755 "$DATA" "$DATA"/*
if [[ $(getenforce 2> /dev/null) == Enforcing ]]; then
	semanage fcontext -a -t httpd_sys_content_t "$DATA(/.*)?" 2> /dev/null || semanage fcontext -m -t httpd_sys_content_t "$DATA(/.*)?"
	restorecon -R "$DATA"
	setsebool -P httpd_can_network_connect 1 # nginx -> Directus ที่ 127.0.0.1:$PORT
	semanage port -l | grep -E '^http_port_t' | grep -qw 8443 || semanage port -a -t http_port_t -p tcp 8443 2> /dev/null || semanage port -m -t http_port_t -p tcp 8443
	echo "SELinux: ตั้งค่าแล้ว"
fi

# ---------------------------------------------------------------- 4. nginx
say "4. nginx หลังบ้าน :8443"
mkdir -p "$BK/nginx-before/conf.d" "$BK/nginx-before/snippets" "$NGX/snippets"
for f in "${NGX_FILES[@]}"; do # เก็บของเดิมไว้ครั้งแรกครั้งเดียว (ใช้ตอน rollback)
	[[ -f $NGX/$f && ! -f $BK/nginx-before/$f && ! -f $BK/nginx-installed ]] && cp -a "$NGX/$f" "$BK/nginx-before/$f"
done
touch "$BK/nginx-installed"
STAGE=$(mktemp -d)
cp nginx/00-hospweb-maps.conf nginx/hospweb-admin.conf nginx/hospweb-proxy.conf nginx/hospweb-headers.conf nginx/hospweb-public.conf "$STAGE/"
sed -i -E "s#^(\s*ssl_certificate\s+)[^;]+;#\1$CRT;#; s#^(\s*ssl_certificate_key\s+)[^;]+;#\1$KEY;#" "$STAGE/hospweb-admin.conf"
sed -i "s#127.0.0.1:8055#127.0.0.1:$PORT#g" "$STAGE/hospweb-proxy.conf"
sed -i "s#/srv/hospweb/#$DATA/#g" "$STAGE"/*.conf
mkdir -p "$BK/nginx-prev"
for f in "${NGX_FILES[@]}"; do [[ -f $NGX/$f ]] && cp -a "$NGX/$f" "$BK/nginx-prev/$(basename "$f")"; done
install -m 644 "$STAGE/00-hospweb-maps.conf" "$STAGE/hospweb-admin.conf" "$NGX/conf.d/"
install -m 644 "$STAGE/hospweb-proxy.conf" "$STAGE/hospweb-headers.conf" "$STAGE/hospweb-public.conf" "$NGX/snippets/"
rm -rf "$STAGE"
restorecon -F "$NGX"/conf.d/*hospweb* "$NGX"/snippets/hospweb-* 2> /dev/null || true
if ! nginx -t; then
	warn "nginx -t ไม่ผ่าน คืนไฟล์เดิม ไม่ reload (เว็บเดิมไม่กระทบ)"
	for f in "${NGX_FILES[@]}"; do
		if [[ -f $BK/nginx-prev/$(basename "$f") ]]; then cp -a "$BK/nginx-prev/$(basename "$f")" "$NGX/$f"; else rm -f "$NGX/$f"; fi
	done
	nginx -t
	exit 1
fi
systemctl reload nginx
echo "nginx reload แล้ว"

# ---------------------------------------------------------------- 5. firewall
say "5. firewall"
if firewall_active; then
	# ลบกฎ 8443 เดิมที่ไม่อยู่ในรายการแล้ว แล้วเพิ่มตามรายการปัจจุบัน
	firewall-cmd --permanent --list-rich-rules | grep 'port="8443"' | while read -r r; do
		keep=0
		for c in "${LANS[@]}"; do [[ $r == "$(rich "$c")" ]] && keep=1; done
		[[ $keep == 1 ]] || firewall-cmd -q --permanent --remove-rich-rule="$r"
	done
	for c in "${LANS[@]}"; do
		firewall-cmd -q --permanent --query-rich-rule="$(rich "$c")" || firewall-cmd -q --permanent --add-rich-rule="$(rich "$c")"
	done
	firewall-cmd -q --reload
	echo "เปิดพอร์ต 8443 ให้ ${LANS[*]}"
	firewall-cmd --list-ports | grep -qw '8443/tcp' && warn "zone หลักเปิด 8443/tcp ให้ทุกคนอยู่ ควรปิด: firewall-cmd --permanent --remove-port=8443/tcp && firewall-cmd --reload"
else
	warn "firewalld ไม่ได้ทำงาน: router ต้องไม่ forward พอร์ต 8443 (nginx จำกัด IP ไว้อีกชั้นแล้ว)"
fi

# ---------------------------------------------------------------- 6. หน้าเว็บ
say "6. build หน้าเว็บครั้งแรก"
./scripts/build-site.sh --install
if [[ -n ${DIRECTUS_READ_TOKEN:-} ]]; then
	./scripts/build-site.sh --force || warn "build ไม่สำเร็จ ดู $DATA/site/build.log"
else
	warn "ข้าม build เพราะยังไม่มี DIRECTUS_READ_TOKEN"
fi

# ---------------------------------------------------------------- 7. cron + log
say "7. cron"
cat > "$CRON" << EOF
# เว็บโรงพยาบาลใหม่ (สร้างโดย scripts/setup-server.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
* * * * * root $REPO/scripts/build-site.sh >> /var/log/hospweb-build.log 2>&1
30 1 * * * root $REPO/scripts/backup.sh >> /var/log/hospweb-backup.log 2>&1
EOF
chmod 644 "$CRON"
restorecon -F "$CRON" 2> /dev/null || true
cat > /etc/logrotate.d/hospweb << 'EOF'
/var/log/hospweb-build.log /var/log/hospweb-backup.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
EOF
echo "build ทุก 1 นาที (เมื่อเนื้อหาเปลี่ยน), backup ทุกวัน 01:30"

# ---------------------------------------------------------------- 8. backup ไป NAS
say "8. backup ไป NAS $NAS"
SSHKEY=/root/.ssh/hospweb_backup
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[[ -f $SSHKEY ]] || ssh-keygen -q -t ed25519 -f "$SSHKEY" -N '' -C "hospweb-backup@$(hostname -s)"
if ! grep -q "^Host $NAS\$" /root/.ssh/config 2> /dev/null; then
	printf '\nHost %s\n    User hospweb-backup\n    IdentityFile %s\n    IdentitiesOnly yes\n    StrictHostKeyChecking accept-new\n' "$NAS" "$SSHKEY" >> /root/.ssh/config
	chmod 600 /root/.ssh/config
fi
NAS_OK=0
if [[ -n ${BACKUP_OFFSITE:-} ]] && timeout 20 rsync --list-only -e 'ssh -o BatchMode=yes -o ConnectTimeout=5' "${BACKUP_OFFSITE%/}/" > /dev/null 2>&1; then
	NAS_OK=1
	echo "เชื่อม NAS ได้"
fi
echo "สำรองข้อมูลครั้งแรก"
if [[ $NAS_OK == 1 ]]; then ./scripts/backup.sh || warn "backup ไม่สำเร็จ ดู log ด้านบน"; else BACKUP_SKIP_OFFSITE=1 ./scripts/backup.sh || warn "backup ไม่สำเร็จ ดู log ด้านบน"; fi

# ---------------------------------------------------------------- สรุป
say "เสร็จ  (log: $BK/setup-$TS.log)"
check() { printf '  %-52s %s\n' "$1" "$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "waritch-hosp.moph.go.th:8443:127.0.0.1" "https://waritch-hosp.moph.go.th:8443$2")"; }
echo "ตรวจจากเครื่องนี้ (ควรได้ 200):"
check "หลังบ้าน /admin/login" /admin/login
check "ตัวอย่างหน้าเว็บ /preview/" /preview/
echo "  เว็บจริง https://waritch-hosp.moph.go.th ยังเป็น WordPress เดิม (เปลี่ยนตอน cut-over)"
cat << EOF

สิ่งที่ต้องทำต่อ
  1. เครื่องของ admin01-03 ชี้ waritch-hosp.moph.go.th ไปที่ 192.168.1.251
     (Windows: แก้ C:\\Windows\\System32\\drivers\\etc\\hosts เพิ่มบรรทัด  192.168.1.251 waritch-hosp.moph.go.th)
  2. เปิด https://waritch-hosp.moph.go.th:8443 เข้าด้วย ${ADMIN_EMAIL:-admin01@waritch-hosp.moph.go.th}
EOF
if [[ $NEW_ENV == 1 || -n ${ADMIN_PASSWORD:-} ]]; then
	echo "     รหัสผ่านอยู่ใน $REPO/.env บรรทัด ADMIN_PASSWORD (ดู: sudo grep ADMIN_PASSWORD $REPO/.env)"
fi
cat << EOF
     ระบบจะบังคับตั้ง 2FA ทันที จากนั้นลบ ADMIN_EMAIL/ADMIN_PASSWORD ออกจาก .env แล้ว sudo docker compose up -d
  3. สร้าง admin02, admin03 ในเมนูผู้ใช้ (ดู docs/plan.md หัวข้อ 4)
EOF
if [[ $NAS_OK == 0 ]]; then
	cat << EOF
  4. ยังส่ง backup ไป NAS ไม่ได้ (ตอนนี้เก็บในเครื่องที่ ${BACKUP_DIR:-$REPO/backups}) ตั้งค่า Synology ตาม docs/plan.md หัวข้อ 8
     แล้วนำ public key นี้ไปใส่ใน /var/services/homes/hospweb-backup/.ssh/authorized_keys บน NAS:

     $(cat "$SSHKEY.pub")

     ทดสอบ: sudo ./scripts/backup.sh
EOF
fi
