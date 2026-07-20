// 关卡内 HUD(v2 射击,T14)—— 四维状态 N/L/R/D + 火力 F vs 需求告警 + 关卡进度 + 击杀数 + 暂停。
// 只读 game 字段做呈现,不含任何玩法规则(火力/需求都取 core 的 getter)。
//
// **对撞时代那条「敌方 / BOSS 血条」已废,别留**:v2 的怪潮是连续流按 F 结算、没有单条血可画;
// 闸门血量(大数字)与 BOSS 血条现在都由 ArenaView 就地画在赛道上,HUD 不再重复。

import { Color, Label, Node } from 'cc';
import { HALF_H, SAFE_HALF_W, UI_C, UiBar, UiButton, uiIcon, uiLabel, uiNode } from './UiKit';
import type { Game } from '../core/game';
import type { Stats } from '../defs/types';

// 维度配色(《v2》§4):N 蓝 / L 紫 / R 橙 / D 红。与 ArenaView 门色同源。
const DIM_COLOR: Record<keyof Stats, Color> = {
  N: new Color(62, 143, 224, 255),
  L: new Color(155, 93, 229, 255),
  R: new Color(244, 157, 26, 255),
  D: new Color(229, 72, 77, 255),
};
const POWER_OK = new Color(182, 240, 156, 255);
const POWER_SHORT = new Color(255, 107, 107, 255);   // 火力 < 需求:在漏怪,标红告警

export class HudScreen {
  readonly node: Node;
  private readonly lbLevel: Label;
  private readonly lbKills: Label;
  private readonly dims: Record<keyof Stats, Label>;
  private readonly lbPower: Label;
  private readonly barProgress: UiBar;
  private readonly lbTarget: Label;

  constructor(parent: Node, onPause: () => void) {
    this.node = uiNode(parent, 'Hud');

    this.lbLevel = uiLabel(this.node, 'Level', '', {
      size: 46, color: UI_C.textLight, x: -SAFE_HALF_W + 120, y: HALF_H - 95, outline: true,
    });
    this.lbKills = uiLabel(this.node, 'Kills', '', {
      size: 40, color: UI_C.textLight, x: -SAFE_HALF_W + 300, y: HALF_H - 95, outline: true,
    });

    // ui_icon_pause_base_01.png;96 见方已过 88px@2x 触区下限
    const pause = new UiButton(this.node, 'Pause', {
      text: '', w: 96, h: 96, color: UI_C.mask, x: SAFE_HALF_W - 68, y: HALF_H - 100,
    }, onPause);
    uiIcon(pause.node, 'Icon', '‖', UI_C.secondary, 60);

    this.barProgress = new UiBar(this.node, 'Progress', 780, 24, POWER_OK);
    this.barProgress.node.setPosition(0, HALF_H - 165, 0);

    // 四维状态一排(带配色),抬眼就能读当前 N/L/R/D
    this.dims = {} as Record<keyof Stats, Label>;
    const order: (keyof Stats)[] = ['N', 'L', 'R', 'D'];
    order.forEach((k, i) => {
      this.dims[k] = uiLabel(this.node, `Dim_${k}`, `${k} 0`, {
        size: 44, color: DIM_COLOR[k], x: -285 + i * 190, y: HALF_H - 240, outline: true,
      });
    });

    // 火力 vs 需求:不足标红 —— 分神打桶 / 限时 buff 的即时变化也在这里读到
    this.lbPower = uiLabel(this.node, 'Power', '', {
      size: 44, color: POWER_OK, y: HALF_H - 315, outline: true,
    });

    // 挑战局的目标分(spec §4.2),压在火力行下面;普通闯关时隐藏
    this.lbTarget = uiLabel(this.node, 'Target', '', {
      size: 40, color: UI_C.starOn, y: HALF_H - 385, outline: true,
    });
    this.lbTarget.node.active = false;
  }

  /** 挑战局:显示"目标:超过好友的 N"(spec §4.2);传 null 恢复普通闯关。 */
  setChallenge(invite: { score: number; from: string } | null): void {
    this.lbTarget.node.active = !!invite;
    if (invite) this.lbTarget.string = `目标:超过${invite.from}的 ${invite.score}`;
  }

  show(): void { this.node.active = true; }
  hide(): void { this.node.active = false; }

  tick(game: Game, _dt: number): void {
    this.lbLevel.string = `第 ${game.level.level} 关`;
    this.lbKills.string = `击杀 ${game.killCount}`;
    this.barProgress.set(game.progress);

    const s = game.stats;
    this.dims.N.string = `N ${s.N}`;
    this.dims.L.string = `L ${s.L}`;
    this.dims.R.string = `R ${s.R.toFixed(1)}`;
    this.dims.D.string = `D ${s.D.toFixed(1)}`;

    // clearF 是真正落在怪身上的火力(打桶被分走 / buff 加成都并进它),拿它跟 demand 比,分神的代价当场看得见
    const f = game.clearF;
    const need = game.demand;
    const short = need > 0 && f < need;
    const tag = game.barrelTarget ? ' ↘打桶' : game.buffMul > 1 ? ' ↗buff' : '';
    this.lbPower.string = `火力 ${Math.round(f)}${need > 0 ? ` / 需 ${Math.round(need)}` : ''}${tag}`;
    this.lbPower.color = short ? POWER_SHORT : POWER_OK;
  }
}
