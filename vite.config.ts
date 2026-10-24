// 二つの入口: index.html（既存の本編・デバッグ画面）と skeleton.html（骨格: 採取だけの経済）。
// 開発サーバはどちらも root 直下の HTML として配信する。本番ビルドの入口をここで両方指定する。
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: `${here}index.html`,
        skeleton: `${here}skeleton.html`,
      },
    },
  },
});
