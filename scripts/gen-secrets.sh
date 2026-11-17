#!/usr/bin/env bash
# เติมรหัสลับที่ยังว่างใน .env ด้วยค่าสุ่ม (ไม่ทับค่าที่มีอยู่แล้ว)
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || cp .env.example .env
chmod 600 .env
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
fill() {
  local k=$1 v=$2
  if grep -qE "^$k=$" .env; then
    sed -i "s|^$k=$|$k=$v|" .env
    echo "สร้าง $k แล้ว"
  fi
}
fill DB_PASSWORD "$(rand 32)"
fill DIRECTUS_KEY "$(rand 40)"
fill DIRECTUS_SECRET "$(rand 64)"
if grep -qE '^ADMIN_PASSWORD=$' .env; then
  p=$(rand 20)
  sed -i "s|^ADMIN_PASSWORD=$|ADMIN_PASSWORD=$p|" .env
  echo "รหัสผ่าน admin คนแรก: $p   (เข้าแล้วเปิด 2FA และลบ ADMIN_EMAIL/ADMIN_PASSWORD ออกจาก .env)"
fi
