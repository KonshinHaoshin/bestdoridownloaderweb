# Bestdori Live2D Web Downloader

一个用于搜索、预览、打包下载 BanG Dream! Live2D 模型的前端项目。

## 功能

- 角色名搜索 Live2D 模型
- 服装名搜索 Live2D 模型（例如：`ひみつの作戦会議`）
- 模型预览（Cubism 2）
- 多模型打包下载 ZIP

## 本地运行

```bash
pnpm install
pnpm dev
```

默认开发地址：`http://localhost:5173`

## API / 资源请求

- 所有 Bestdori API / 资源请求都指向本地镜像：`/mirror/bestdori-api/*` 和 `/mirror/bestdori-assets/*`
- 本地开发 / `pnpm preview`：Vite 从项目根目录的 `mirror/` 静态读取文件
- 线上部署：服务器需要把 `/mirror/` 映射到同步脚本生成的镜像目录
- 不再通过 Vite proxy、Vercel rewrite 或 Cloudflare Worker 访问 Bestdori 源站

## 搜索说明

- 输入角色名：显示该角色全部 Live2D 模型
- 输入服装名/关键词：仅显示匹配的模型
- 服装数据来源：`/mirror/bestdori-api/costumes/all.5.json`

## 文档

- 服装名搜索规则：[`docs/SEARCH.md`](./docs/SEARCH.md)
- 镜像同步与部署：[`docs/BESTDORI_MIRROR_SYNC.md`](./docs/BESTDORI_MIRROR_SYNC.md)
