// 签到面板(《签到任务分享系统设计》§1)—— 7 天格子 + 领取 + 补签(看激励视频)。
// ⚠️ 本层不算任何规则:今天该领第几格、断没断签、能不能补签一律问 Systems 要,点完 refresh 一次。

import { Label, Node, Sprite } from 'cc';
import { UI_C, UiButton, rewardText, uiBlock, uiLabel, uiModal } from './UiKit';
import type { Systems } from '../systems/Systems';

/** 上排 4 格、下排 3 格;第 7 天是大奖,单独占下排中间偏右也无妨,先按顺序排。 */
const TOP_ROW = 4;
const CELL_W = 170;
const CELL_H = 190;
const CELL_GAP = 190;

interface Cell {
  sprite: Sprite;
  mark: Label;
}

export interface SignCallbacks {
  /** 领到东西了:主界面要刷新金币与红点,顺手弹个提示。 */
  onChanged(text: string): void;
}

export class SignScreen {
  readonly node: Node;
  private readonly systems: Systems;
  private readonly cb: SignCallbacks;
  private readonly cells: Cell[] = [];
  private readonly lbStreak: Label;
  private readonly btnClaim: UiButton;
  private readonly btnMakeup: UiButton;
  /** 补签广告正在播,挡住连点。 */
  private makingUp = false;

  constructor(parent: Node, systems: Systems, cb: SignCallbacks, onClose: () => void) {
    this.systems = systems;
    this.cb = cb;

    const modal = uiModal(parent, 'Sign', 820, 1180);
    this.node = modal.root;
    const panel = modal.panel;

    uiLabel(panel, 'Title', '每日签到', { size: 72, color: UI_C.textDark, y: 490 });
    this.lbStreak = uiLabel(panel, 'Streak', '', { size: 40, color: UI_C.textDark, y: 400 });

    const rewards = this.systems.sign.rewards;
    for (let i = 0; i < rewards.length; i++) {
      const top = i < TOP_ROW;
      const count = top ? Math.min(TOP_ROW, rewards.length) : rewards.length - TOP_ROW;
      const idx = top ? i : i - TOP_ROW;
      const cell = uiBlock(panel, `Day${i + 1}`, UI_C.secondary, CELL_W, CELL_H);
      cell.setPosition((idx - (count - 1) / 2) * CELL_GAP, top ? 210 : 0, 0);
      uiLabel(cell, 'Day', `第 ${rewards[i].day} 天`, { size: 34, color: UI_C.textDark, y: 62 });
      uiLabel(cell, 'Reward', rewardText(rewards[i]), { size: 32, color: UI_C.textDark, y: 4 });
      this.cells.push({
        sprite: cell.getComponent(Sprite),
        mark: uiLabel(cell, 'Mark', '', { size: 52, color: UI_C.textDark, y: -58 }),
      });
    }

    this.btnClaim = new UiButton(panel, 'Claim', {
      text: '', w: 470, h: 140, fontSize: 50, y: -230,
    }, () => this.onClaim());

    this.btnMakeup = new UiButton(panel, 'Makeup', {
      text: '', w: 470, h: 120, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 42, y: -390,
    }, () => this.onMakeup());

    new UiButton(panel, 'Close', {
      text: '关闭', w: 240, h: 100, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 40, y: -520,
    }, onClose);

    this.node.active = false;
  }

  show(): void {
    this.refresh();
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }

  refresh(): void {
    const st = this.systems.signState();

    this.lbStreak.string = st.claimedToday
      ? `今日已签 · 连签 ${st.streak} 天`
      : `今天可领第 ${st.day} 天 · 已连签 ${st.streak - 1} 天`;

    // 本轮里 st.day 之前的格子都领过了;今天领了的话 st.day 那格也算领过
    const claimed = st.claimedToday ? st.day : st.day - 1;
    for (let i = 0; i < this.cells.length; i++) {
      const day = i + 1;
      const done = day <= claimed;
      const isToday = day === st.day && !st.claimedToday;
      this.cells[i].sprite.color = done ? UI_C.disabled : (isToday ? UI_C.highlight : UI_C.secondary);
      this.cells[i].mark.string = done ? '✓' : '';
    }

    this.btnClaim.setText(st.claimedToday ? '今日已领' : `领取第 ${st.day} 天`);
    this.btnClaim.setEnabled(!st.claimedToday);

    // 广告位没开(AdScene 里还没有补签这一位)时按钮说清楚原因,别让玩家点了没反应
    this.btnMakeup.setText(
      !st.broken ? '连签中 · 无需补签'
        : this.systems.adReady ? '看视频补签' : '补签 · 广告位未开',
    );
    this.btnMakeup.setEnabled(st.canMakeup && this.systems.adReady && !this.makingUp);
  }

  private onClaim(): void {
    const reward = this.systems.claimSign();
    if (!reward) return;
    this.refresh();
    this.cb.onChanged(`签到成功  +${rewardText(reward)}`);
  }

  private onMakeup(): void {
    if (this.makingUp) return;
    this.makingUp = true;
    this.refresh();
    this.systems.makeupSign((ok) => {
      this.makingUp = false;
      this.refresh();
      this.cb.onChanged(ok ? '补签成功,连签续上了' : '补签未完成');
    });
  }
}
