// 关卡内 HUD(v2)—— 兵力大字 / 关卡进度条 / 闸门与 BOSS 血条 / 暂停按钮。
// 只读 game 的字段做呈现,不含任何玩法规则。HUD 的正式改造是 T14,这里只把 v1 对撞字段换成 v2。

import { Label, Node } from 'cc';
import { HALF_H, SAFE_HALF_W, UI_C, UiBar, UiButton, uiIcon, uiLabel, uiNode } from './UiKit';
import type { Game } from '../core/game';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class HudScreen {
  readonly node: Node;
  private readonly lbLevel: Label;
  private readonly lbArmy: Label;
  private readonly lbEnemy: Label;
  private readonly lbEnemyHp: Label;
  private readonly lbTarget: Label;
  private readonly barProgress: UiBar;
  private readonly barEnemy: UiBar;
  private readonly enemyGroup: Node;

  private lastN = -1;
  private pop = 0;

  constructor(parent: Node, onPause: () => void) {
    this.node = uiNode(parent, 'Hud');

    this.lbLevel = uiLabel(this.node, 'Level', '', {
      size: 46, color: UI_C.textLight, x: -SAFE_HALF_W + 130, y: HALF_H - 110, outline: true,
    });
    // ui_icon_pause_base_01.png;96 见方已过 88px@2x 触区下限
    const pause = new UiButton(this.node, 'Pause', {
      text: '', w: 96, h: 96, color: UI_C.mask, x: SAFE_HALF_W - 68, y: HALF_H - 110,
    }, onPause);
    uiIcon(pause.node, 'Icon', '‖', UI_C.secondary, 60);

    this.barProgress = new UiBar(this.node, 'Progress', 720, 26, UI_C.barProgress);
    this.barProgress.node.setPosition(0, HALF_H - 190, 0);

    // 敌方 / BOSS 血条:整组随波次进出隐显
    this.enemyGroup = uiNode(this.node, 'Enemy');
    this.enemyGroup.setPosition(0, HALF_H - 330, 0);
    this.lbEnemy = uiLabel(this.enemyGroup, 'Name', '', { size: 40, color: UI_C.textLight, y: 52, outline: true });
    this.barEnemy = new UiBar(this.enemyGroup, 'Hp', 640, 34, UI_C.barEnemy);
    this.lbEnemyHp = uiLabel(this.enemyGroup, 'HpText', '', { size: 30, color: UI_C.textLight, y: -54, outline: true });

    // 兵力大字(军队图标 + 数值),变化时跳动
    const army = uiNode(this.node, 'Army');
    army.setPosition(0, -150, 0);
    uiIcon(army, 'Icon', '军', UI_C.secondary, 72).setPosition(-160, 6, 0);
    this.lbArmy = uiLabel(army, 'Value', '0', { size: 128, color: UI_C.textLight, x: 26, outline: true });

    // 挑战局的目标分,压在兵力大字下面 —— 抬眼就能对上"我现在多少 / 要超多少"
    this.lbTarget = uiLabel(this.node, 'Target', '', {
      size: 42, color: UI_C.starOn, y: -300, outline: true,
    });
    this.lbTarget.node.active = false;
  }

  /** 挑战局:显示"目标:超过好友的 N"(spec §4.2);传 null 恢复普通闯关。 */
  setChallenge(invite: { score: number; from: string } | null): void {
    this.lbTarget.node.active = !!invite;
    if (invite) this.lbTarget.string = `目标:超过${invite.from}的 ${invite.score}`;
  }

  show(): void {
    this.lastN = -1;
    this.pop = 0;
    this.lbArmy.node.setScale(1, 1, 1);
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }

  tick(game: Game, dt: number): void {
    this.lbLevel.string = `第 ${game.level.level} 关`;
    this.barProgress.set(game.progress);

    const n = game.stats.N;
    if (n !== this.lastN) {
      if (this.lastN >= 0) this.pop = 1;
      this.lastN = n;
      this.lbArmy.string = String(n);
    }
    this.pop = Math.max(0, this.pop - dt * 4);
    const s = 1 + this.pop * 0.25;
    this.lbArmy.node.setScale(s, s, 1);

    this.tickCheckpoint(game);
  }

  /**
   * v2 血条只给两个火力检验点:闸门(吃总火力 F)与 BOSS(吃单目标 DPS)。
   * 怪潮是连续流、按 F 结算,没有单条血条可画(那是 T14 的 ArenaView 表现),这里不显示。
   */
  private tickCheckpoint(game: Game): void {
    const barrier = game.barrier;
    const boss = game.bossActive ? game.boss : null;
    if (!barrier && !boss) { this.enemyGroup.active = false; return; }
    this.enemyGroup.active = true;

    if (barrier) {
      this.barEnemy.setColor(UI_C.barEnemy);
      this.barEnemy.set(clamp01(barrier.hp / barrier.maxHp));
      this.lbEnemy.string = '闸门 · 火力打穿';
      this.lbEnemyHp.string = `${Math.max(0, Math.round(barrier.hp))} / ${barrier.maxHp}`;
    } else if (boss) {
      this.barEnemy.setColor(UI_C.barBoss);
      this.barEnemy.set(clamp01(boss.hp / boss.maxHp));
      this.lbEnemy.string = '烂蒜魔王';
      this.lbEnemyHp.string = `${Math.max(0, Math.round(boss.hp))} / ${boss.maxHp}`;
    }
  }
}
