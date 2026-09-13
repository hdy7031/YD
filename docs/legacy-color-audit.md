# YD legacy color audit

本审计对应 YD Visual System 2.0（Mist & Sage）。处理原则是按语义迁移，
不是对所有暖色做全局替换。

## 已迁移

- `src/ui/style.css` 根级品牌 token：从黄铜金默认值迁移为 muted teal / sage。
  独立 Electron surface 不再因未挂载 `main-body` 而回落到金色主题。
- Sidebar hover / active、通用按钮和 legacy `--yd-gold` alias：统一指向品牌 teal。
- Companion / Avatar 设置中的选中、预览和状态选择：统一使用 brand teal，
  不再使用暗金边框或金色文字。

## 有意保留

- `course-block.amber`、`tone-amber` 与 `--yd-tone-oat`：属于课程区分 palette，
  是低饱和 warm sand，不承担按钮、active 或品牌功能色。
- warning / overdue：保留克制的暖色语义，用于真正需要注意的状态。
- danger / error：保留低饱和红棕语义，不属于 legacy gold。

## 兼容性保留

- `--yd-gold` 名称暂时保留为 alias，值已指向 `--yd-brand`。这是对历史 CSS
  引用的兼容，不再代表一套可见金色主题。
- `settings.pet.mode === 'orb'` 是历史持久化枚举；运行时已解释为 Status Dock，
  本轮不为纯命名新增数据库迁移。
