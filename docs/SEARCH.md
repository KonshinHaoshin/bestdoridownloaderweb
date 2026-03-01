# 服装名搜索说明

## 已支持

- 角色名（中/日/英）
- 角色昵称
- Live2D 模型键（如 `037_live_event_250_r`）
- 服装标题（`costumes/all.5.json` 的 `description` 多语言）

## 行为规则

- 当输入命中角色名时：展示该角色全部模型
- 当输入命中服装名/模型键时：展示命中的模型子集

## 示例

- `花园 多惠`
- `ひみつの作戦会議`
- `037_live_event_250_r`

## 数据映射

- `assetBundleName` 直接映射到 Live2D key
- 例如：`037_live_event_250_r` 可关联到该服装名
