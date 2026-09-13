// v0.3 Phase 1：Self / Companion 共用的 Daily Summary 组件系统。
//
// 首页「今日日程」与「TA 的安排」属于同一层级的信息，因此共用这一套组件契约：
//   DailySummary       标题 + 日期 + 数量摘要 + 时间范围 + Daily Timeline
//   DailyTimeline      00:00—24:00 的横向时间带，事项 = 低饱和短色带
//   DailyAgendaList    具体内容列表（由调用方提供每一行如何渲染）
//   DailyEmptyState    受 max-width 约束、上对齐的空状态（不再垂直居中漂浮）
//
// 组件只做排版：状态文案必须来自 CurrentState / live 投影，这里不重新推导。
import React from 'react';
import type { DailyAgendaItem, DailyPlan } from './daily-plan.ts';
import { TIMELINE_TICKS, dailyCountText, dailyNextText, timelinePlacement } from './daily-plan.ts';

const h = React.createElement;

const dateText = (date: string) => {
  const [year, month, day] = date.split('-');
  const weekday = '日一二三四五六'[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  return `${Number(month)}/${Number(day)} 周${weekday}`;
};

export interface DailySummaryProps {
  plan: DailyPlan;
  /** 标题：Self 是「今日日程」，Companion 是「今日安排」——结构相同，只差用词。 */
  heading: string;
  /** 数量量词：Self「项安排」、Companion「节课」。 */
  unit: string;
  /** 数量前缀：今天是「今天」，其它日期是「这天」——两者结构相同。 */
  countPrefix?: string;
  /** 页脚左侧标签：Self 用「时间范围」，Companion 用「第一项 · 最后一项」。 */
  rangeLabel?: string;
  /** 当天没有任何事项时的页脚说明（避免出现空标签）。 */
  emptyRangeText?: string;
  /** 标题图标（与页面其余 section 一致）。 */
  icon?: React.ReactNode;
  /** 右侧动作（日期选择等）。 */
  actions?: React.ReactNode;
}

/** 摘要区：0 项也是一个完整摘要，仍然渲染头部与时间带结构。 */
export function DailySummary({ plan, heading, unit, countPrefix = '今天', rangeLabel = '时间范围', emptyRangeText = '当天没有安排', icon, actions }: DailySummaryProps) {
  return h('section', { className: 'daily-summary' },
    h('div', { className: 'daily-summary-head' },
      h('div', { className: 'daily-summary-heading' },
        icon ?? null,
        h('div', { className: 'daily-summary-copy' },
          h('h2', null, heading),
          h('div', { className: 'daily-summary-meta' },
            h('span', { className: 'daily-summary-date' }, dateText(plan.date)),
            h('span', { className: 'daily-summary-dot', 'aria-hidden': true }, '·'),
            h('span', { className: 'daily-summary-count' }, `${countPrefix}${dailyCountText(plan, unit)}`)))),
      actions ? h('div', { className: 'daily-summary-actions' }, actions) : null),
    h(DailyTimeline, { plan }),
    h('div', { className: 'daily-summary-foot' },
      plan.rangeText
        ? h('span', { className: 'daily-summary-range' }, `${rangeLabel} ${plan.rangeText}`)
        : h('span', { className: 'daily-summary-range' }, emptyRangeText),
      h('span', { className: 'daily-summary-next' }, dailyNextText(plan))));
}

/** 横向时间带：刻度固定 00:00—24:00，事项按其真实时间占位。 */
export function DailyTimeline({ plan }: { plan: DailyPlan }) {
  const hasItems = plan.items.length > 0;
  return h('div', { className: `daily-timeline${hasItems ? '' : ' is-empty'}` },
    h('div', { className: 'daily-timeline-rail', 'aria-hidden': true },
      ...plan.items.map(item => {
        const placement = timelinePlacement(plan.dayStart, item.start, item.end);
        return h('span', {
          key: item.id,
          className: `daily-timeline-seg tone-${item.tone}${item.cancelled ? ' is-cancelled' : ''}`,
          style: { left: `${placement.left}%`, width: `${placement.width}%` },
          title: item.title,
        });
      })),
    h('div', { className: 'daily-timeline-ticks', 'aria-hidden': true },
      ...TIMELINE_TICKS.map(tick =>
        h('span', { key: tick.at, className: 'daily-timeline-tick', style: { left: `${(tick.at / (24 * 3600000)) * 100}%` } },
          h('i', null), h('small', null, tick.label)))));
}

export interface DailyAgendaListProps {
  plan: DailyPlan;
  renderItem: (item: DailyAgendaItem) => React.ReactNode;
  className?: string;
}

/** 具体内容列表：容器由本组件统一，每一行的差异交给调用方。 */
export function DailyAgendaList({ plan, renderItem, className = '' }: DailyAgendaListProps) {
  return h('div', { className: `daily-agenda${className ? ' ' + className : ''}` },
    ...plan.items.map(item => h(React.Fragment, { key: item.id }, renderItem(item))));
}

export interface DailyEmptyStateProps {
  title: string;
  description: string;
  illustration?: string;
  actions?: React.ReactNode;
}

/**
 * 每日空状态：上对齐、受 max-width 控制、留在主内容列里。
 * 页面变大时它只占据内容宽度，不会漂到窗口中部。
 */
export function DailyEmptyState({ title, description, illustration, actions }: DailyEmptyStateProps) {
  return h('div', { className: 'daily-empty' },
    h('div', { className: 'daily-empty-card' },
      illustration
        ? h('img', { className: 'daily-empty-art', src: illustration, alt: '', 'aria-hidden': true, draggable: false })
        : h('span', { className: 'daily-empty-icon', 'aria-hidden': true },
          h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3.2 }),
            h('path', { d: 'M7.6 9.6h8.8M7.6 13h5.6' }))),
      h('div', { className: 'daily-empty-copy' }, h('strong', null, title), h('p', null, description)),
      actions ? h('div', { className: 'daily-empty-actions' }, actions) : null));
}
