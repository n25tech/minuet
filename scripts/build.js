import { cp, mkdir, rm } from 'node:fs/promises';
await rm('public', { recursive: true, force: true });
await mkdir('public');
for (const path of ['index.html', 'js', 'assets', 'sw.js', '_headers']) {
    await cp(path, `public/${path}`, { recursive: true });
}
