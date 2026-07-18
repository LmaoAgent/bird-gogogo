// 每日任务面板(《签到任务分享系统设计》§2)—— 进度条 / 逐条领取 / 全清宝箱 / 每日分享入口。
// ⚠️ 本层不算规则:进度、能不能领、宝箱开没开全问 Systems 要,点完 refresh 一次。

import { Label, Node } from 'cc';
import { UI_C, UiBar, UiButton, rewardText, uiBlock, uiLabel, uiModal, uiNode } from './UiKit';
import type { Systems } from '../systems/Systems';

/** spec §2 每日 3–5 个,按上限建行,当天少于 5 条就把多余的行藏起来。 */
const MAX_ROWS = 5;
const ROW_TOP = 470;
const ROW_STEP = 170;

interface Row {
  node: Node;
  id: string;
  lbDesc: Label;
  lbProgress: Label;
  bar: UiBar;
  btn: UiButton;
}

export interface TaskCallbacks {
  /** 领到东西 / 分享完:主界面要刷金币与红点,顺手弹提示。 */
  onChanged(text: string): void;
}

export class TaskScreen {
  readonly node: Node;
  private readonly systems: Systems;
  private readonly cb: TaskCallbacks;
  private readonly rows: Row[] = [];
  private readonly btnAll: UiButton;
  private readonly btnShare: UiButton;

  constructor(parent: Node, systems: Systems, cb: TaskCallbacks, onClose: () => void) {
    this.systems = systems;
    this.cb = cb;

    const modal = uiModal(parent, 'Task', 860, 1400);
    this.node = modal.root;
    const panel = modal.panel;

    uiLabel(panel, 'Title', '每日任务', { size: 72, color: UI_C.textDark, y: 610 });

    for (let i = 0; i < MAX_ROWS; i++) {
      this.rows.push(this.buildRow(panel, i));
    }

    this.btnAll = new UiButton(panel, 'AllClear', {
      text: '', w: 620, h: 130, fontSize: 44, y: -390,
    }, () => this.onClaimAll());

    this.btnShare = new UiButton(panel, 'Share', {
      text: '', w: 620, h: 120, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 42, y: -520,
    }, () => this.onShare());

    new UiButton(panel, 'Close', {
      text: '关闭', w: 240, h: 100, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 40, y: -620,
    }, onClose);

    this.node.active = false;
  }

  private buildRow(panel: Node, i: number): Row {
    const node = uiNode(panel, `Row${i}`);
    node.setPosition(0, ROW_TOP - i * ROW_STEP, 0);
    uiBlock(node, 'Bg', UI_C.mask, 780, 150);

    const lbDesc = uiLabel(node, 'Desc', '', { size: 38, color: UI_C.textLight, x: -150, y: 34 });
    const bar = new UiBar(node, 'Bar', 400, 26, UI_C.barProgress);
    bar.node.setPosition(-150, -32, 0);
    const lbProgress = uiLabel(node, 'Progress', '', { size: 32, color: UI_C.textLight, x: 130, y: -32 });

    // 领取按钮:能领时是主色 + 奖励文案,领过就置灰
    const btn = new UiButton(node, 'Claim', {
      text: '', w: 180, h: 110, fontSize: 34, x: 280,
    }, () => this.onClaim(i));

    return { node, id: '', lbDesc, lbProgress, bar, btn };
  }

  show(): void {
    this.refresh();
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }

  refresh(): void {
    const views = this.systems.taskViews();
    for (let i = 0; i < MAX_ROWS; i++) {
      const row = this.rows[i];
      const v = views[i];
      row.node.active = !!v;
      if (!v) continue;
      row.id = v.def.id;
      row.lbDesc.string = v.def.desc;
      row.lbProgress.string = `${v.progress}/${v.def.target}`;
      row.bar.set(v.progress / v.def.target);
      row.btn.setText(v.claimed ? '已领' : rewardText(v.def.reward));
      row.btn.setEnabled(v.claimable);
    }

    const allClaimed = this.systems.taskAllClaimed();
    this.btnAll.setText(allClaimed
      ? '全清宝箱 · 已开'
      : `全清宝箱  ${rewardText(this.systems.task.allClearReward)}`);
    this.btnAll.setEnabled(this.systems.taskAllDone() && !allClaimed);

    // 分享按钮常驻可点(分享本身不限次,只有奖励每日限一次),文案说明今天还有没有奖
    this.btnShare.setText(this.systems.shareRewardTaken() ? '分享给好友 · 今日奖励已领' : '分享给好友 得奖励');
  }

  private onClaim(i: number): void {
    const id = this.rows[i].id;
    if (!id) return;
    const reward = this.systems.claimTask(id);
    if (!reward) return;
    this.refresh();
    this.cb.onChanged(`任务完成  +${rewardText(reward)}`);
  }

  private onClaimAll(): void {
    const reward = this.systems.claimAllTasks();
    if (!reward) return;
    this.refresh();
    this.cb.onChanged(`全清宝箱  +${rewardText(reward)}`);
  }

  /** §3.1 每日分享任务(act=daily)。点了就发起分享,奖励按每日限次结算。 */
  private onShare(): void {
    const reward = this.systems.doShare('daily');
    this.refresh();
    this.cb.onChanged(reward ? `分享成功  +${rewardText(reward)}` : '今日分享奖励已领过');
  }
}
