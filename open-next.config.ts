// Cloudflare で Next.js を動かすための設定（@opennextjs/cloudflare）。
// このアプリは作り置きのページを更新する仕組み（時間がたったら作り直す等）を使っていないので、作り置き用の保存場所は使わない。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
