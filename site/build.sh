#!/bin/sh
# build หน้าเว็บ + ดัชนีค้นหา (npm run build เรียกไฟล์นี้)
# compiler ของ Astro และ Pagefind ต้องใช้ CPU ระดับ x86-64-v3 (AVX2, BMI2, FMA)
# ถ้า CPU ไม่มี จะรันผ่าน qemu แทน (ช้ากว่าประมาณ 5 เท่า แต่ได้ผลเหมือนกัน)
# แก้ถาวร: ตั้ง CPU type ของ VM เป็น host หรือ x86-64-v3 แล้วสคริปต์จะกลับมารันตรงเอง
set -e
cd "$(dirname "$0")"
OUT=${SITE_OUT:-dist}
RUN=""
if [ -n "$FORCE_QEMU" ] || ! grep -qw avx2 /proc/cpuinfo || ! grep -qw bmi2 /proc/cpuinfo || ! grep -qw fma /proc/cpuinfo; then
	if command -v qemu-x86_64-static > /dev/null; then
		echo "CPU ไม่รองรับ x86-64-v3: build ผ่าน qemu (ช้ากว่าปกติ)"
		RUN="qemu-x86_64-static -cpu max"
	else
		echo "CPU ไม่รองรับ x86-64-v3 และไม่มี qemu-x86_64-static (ใช้ image จาก site/builder/Dockerfile)" >&2
		exit 1
	fi
fi
$RUN "$(command -v node)" node_modules/astro/bin/astro.mjs build
$RUN node_modules/@pagefind/linux-x64/bin/pagefind_extended --site "$OUT"
