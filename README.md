# EarthOL Player Profile

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-blue?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Framework-Hono-000000?style=flat-square&logo=hono)](https://hono.dev/)
[![D1](https://img.shields.io/badge/Database-D1-4285F4?style=flat-square&logo=sqlite)](https://developers.cloudflare.com/d1/)
[![KV](https://img.shields.io/badge/Storage-KV-FF6B6B?style=flat-square&logo=redis)](https://developers.cloudflare.com/kv/)
[![Tailwind CSS](https://img.shields.io/badge/CSS-Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)

地球OL玩家档案，使用Cloudflare Worker运行的玩家个人主页服务。

## 快速开始

你可以点击下方的`Deploy to Cloudflare`按钮一键部署此项目到你的worker中

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Yang-qwq/earthol-player-profile)

前置条件：Node.js 18+、已登录的 `wrangler`（仅部署时需要）。

```bash
npm install
npm run db:init  # 应用数据库 schema（必须先执行）
npm run dev      # 启动开发服务器（http://localhost:8787）
```

## 功能

- 个人主页 `/:username`：三档可见性（public/unlisted/private）
- 自定义字段：任意键值对，支持链接自动识别
- 标签系统：管理员维护分类，用户挂标签，支持隐藏标签
- 可选 R2 对象存储：绑定后在控制台直接上传头像，经 `/files/*` 提供访问
- 分享功能：二维码生成与WebNFC写入
- 登录：GitHub OAuth + 邮箱魔法链接
- 控制台：编辑资料、字段、标签、主题与可见性
- 管理面板：运行时设置、用户管理
- i18n：中/英双语支持
- SEO：canonical/OG标签、sitemap

## 部署

推荐直接点击上方 **Deploy to Cloudflare** 按钮，自动创建D1/KV资源。

部署后需完成：

1. 初始化数据库：在Cloudflare Dashboard执行 `wrangler d1 execute <库名> --remote --file=./schema.sql`
2. 配置环境变量：`APP_URL`（必填）
3. 可选配置：站点名称、GitHub 登录、邮件（SMTP）与 Gravatar 可在管理面板 `/admin` 中设置；也可用环境变量（`APP_NAME`、`GITHUB_CLIENT_ID/SECRET`、`MAILER_DRIVER`/`SMTP_*`、`GRAVATAR_MIRROR`、`ADMIN_EMAILS`）。环境变量优先，已由环境变量设置的项在控制台中会自动锁定，无法修改。
4. 可选启用 R2（头像上传）：在 `wrangler.jsonc` 中取消注释 `r2_buckets` 绑定块（本地与 `env.production` 都要，或在 Cloudflare Dashboard 中添加名为 `R2` 的 R2 桶绑定）后重新部署。启用后控制台会出现“上传头像”卡片，文件存储在 `avatars/<userId>/<随机串>.<扩展名>` 并经 `GET /files/*` 提供；未绑定时该功能完全隐藏，应用行为与之前完全一致。

## 贡献

如果你发现任何问题，欢迎提交Issue或PR！
