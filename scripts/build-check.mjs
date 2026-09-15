import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const required = [
  'index.html', 'styles.css', 'package.json', 'vercel.json', '.env.example',
  'api/_shared.js', 'api/health.js', 'api/state.js',
  'src/model.js', 'src/domain.js', 'src/store.js', 'src/app.js',
  'supabase/migrations/001_hotel_manager.sql', 'README.md'
];

const failures = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) failures.push(`Thiếu ${file}`);

const javascript = required.filter((file) => file.endsWith('.js'));
for (const file of javascript) {
  try { execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' }); }
  catch (error) { failures.push(`Lỗi cú pháp ${file}: ${error.stderr?.toString() || error.message}`); }
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const asset of ['/styles.css', '/src/app.js']) if (!html.includes(asset)) failures.push(`index.html chưa liên kết ${asset}`);
const clientText = ['src/model.js', 'src/domain.js', 'src/store.js', 'src/app.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
if (clientText.includes('SUPABASE_SERVICE_ROLE_KEY')) failures.push('Khóa service role xuất hiện trong mã trình duyệt.');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/001_hotel_manager.sql'), 'utf8');
for (const marker of ['enable row level security', 'save_hotel_state', 'service_role']) if (!sql.toLowerCase().includes(marker)) failures.push(`SQL thiếu ${marker}`);

if (failures.length) {
  console.error('BUILD CHECK: KHÔNG ĐẠT'); failures.forEach((item) => console.error('- ' + item)); process.exit(1);
}
console.log(`BUILD CHECK: ĐẠT · ${required.length} tệp bắt buộc · ${javascript.length} tệp JavaScript hợp lệ`);
