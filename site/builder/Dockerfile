# image ที่ใช้ build หน้าเว็บ (compose service site-builder)
# = node ตัวเดิม + qemu-x86_64-static ไว้รัน compiler ของ Astro และ Pagefind
#   บน CPU ที่ไม่มี AVX2/BMI2/FMA (x86-64-v3) เช่น VM ที่ตั้ง CPU type เป็น x86-64-v2 (ดู site/build.sh)
# qemu เอามาจาก Ubuntu 24.04 (รุ่น 8.2 ทดสอบแล้วว่ารองรับ AVX2) เป็นไฟล์ static ไฟล์เดียว
FROM ubuntu:24.04 AS qemu
RUN apt-get update \
	&& apt-get install -y --no-install-recommends qemu-user-static \
	&& cp /usr/bin/qemu-x86_64-static /qemu-x86_64-static

FROM node:22.23.4-bookworm-slim
COPY --from=qemu /qemu-x86_64-static /usr/local/bin/qemu-x86_64-static
