// ที่เก็บไฟล์ระหว่าง build (ใช้ร่วมกันระหว่าง src/lib/media.js กับ src/integrations/media.mjs)
import { join } from 'node:path';

// อยู่ใน filesystem เดียวกับโฟลเดอร์ผลลัพธ์ จะได้ hardlink แทนการคัดลอก
export const CACHE_DIR = process.env.MEDIA_CACHE ?? join(process.cwd(), '.cache', 'media');
export const USED_FILE = join(process.cwd(), '.cache', 'used.txt');
