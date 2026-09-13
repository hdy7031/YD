// Desk pet context menu model.
//
// 系统原生菜单无法改字体、间距与配色，桌宠右键菜单因此改成和主界面同一套语言的
// 自绘菜单窗口。这份模型同时被主进程（决定窗口尺寸、投递内容）与渲染层（渲染行）
// 使用，所以永远不会出现“主进程算的行高和实际渲染对不上”的错位。
export type CompanionMenuItem =
  | { kind: 'item'; id: string; label: string; hint?: string; tone?: 'default' | 'danger' }
  | { kind: 'check'; id: string; label: string; checked: boolean }
  | { kind: 'radio'; id: string; label: string; checked: boolean }
  | { kind: 'sep' };

export interface CompanionMenuContext {
  mode: 'custom' | 'orb';
  // 气泡提醒是否处于暂停状态。
  paused: boolean;
  // 桌宠窗口当前是否可见，用于“隐藏桌宠 / 显示桌宠”文案。
  visible: boolean;
  shortcut: string;
  shortcutReady: boolean;
}

export const companionMenuMetrics = {
  width: 238,
  rowHeight: 34,
  separator: 9,
  paddingY: 8,
};

// 隐藏 / 显示桌宠的全局快捷键（主进程注册，菜单右侧显示同一串文字）。
export const companionToggleShortcut = { accelerator: 'Control+Alt+Y', label: 'Ctrl+Alt+Y' };

export function buildCompanionMenu(context: CompanionMenuContext): CompanionMenuItem[] {
  return [
    { kind: 'item', id: 'open', label: '打开 YD' },
    { kind: 'item', id: 'mini', label: '查看双方状态' },
    // Phase 3C：临时手动状态的入口（打开主窗口里的对话框）。
    { kind: 'item', id: 'status', label: '设置当前状态' },
    { kind: 'sep' },
    { kind: 'radio', id: 'mode:custom', label: '显示为桌宠', checked: context.mode !== 'orb' },
    { kind: 'radio', id: 'mode:orb', label: '显示为状态浮标', checked: context.mode === 'orb' },
    { kind: 'sep' },
    // 气泡这一行是“动作”而不是“开关”：勾选一个叫“暂停…”的行会让人以为是已开启，
    // 所以只有暂停中才在右侧补一行“已暂停”说明。
    {
      kind: 'item',
      id: 'bubbles',
      label: context.paused ? '恢复气泡提醒' : '暂停气泡提醒 1 小时',
      hint: context.paused ? '已暂停' : undefined,
    },
    { kind: 'item', id: 'settings', label: '桌宠设置' },
    { kind: 'sep' },
    {
      kind: 'item',
      id: 'toggle',
      label: context.visible ? '隐藏桌宠' : '显示桌宠',
      hint: context.shortcutReady ? context.shortcut : undefined,
    },
    { kind: 'item', id: 'quit', label: '退出 YD', tone: 'danger' },
  ];
}

export function companionMenuHeight(items: CompanionMenuItem[]): number {
  let height = companionMenuMetrics.paddingY * 2;
  for (const item of items) height += item.kind === 'sep' ? companionMenuMetrics.separator : companionMenuMetrics.rowHeight;
  return height;
}
