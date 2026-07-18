// 关卡内 HUD —— 兵力大字 / 关卡进度条 / 敌方与 BOSS 血条 / 暂停按钮。
// 只读 game 的字段做呈现:兵力与血量在对撞期间按 smash.progress 插值(纯演出插值,不改判定)。

import { Label, Node } from 'cc';
import { HALF_H, SAFE_HALF_W, UI_C, UiBar, UiButton, uiIcon, uiLabel, uiNode } from './UiKit';
import type { Game } from '../core/game';

/** 敌人进到这个纵深内才亮血条,与 ArenaView 的显示距离同值。 */
const REVEAL_Z = 70;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class HudScreen {
  readonly node: Node;
  private readonly lbLevel: Label;
  private readonly lbArmy: Label;
  private readonly lbEnemy: Label;
  private readonly lbEnemyHp: Label;
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
  }

  show(): void {
    this.lastN = -1;
    this.pop = 0;
    this.lbArmy.node.setScale(1, 1, 1);
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }

  tick(game: Game, dt: number): void {
    const smashing = game.state === 'smashing';

    this.lbLevel.string = `第 ${game.level.level} 关`;
    this.barProgress.set(game.progress);

    // 对撞期间兵力从 nBefore 平滑落到 nAfter,和血条同步下降
    const n = smashing
      ? Math.round(lerp(game.smash.nBefore, game.smash.nAfter, game.smash.progress))
      : game.n;
    if (n !== this.lastN) {
      if (this.lastN >= 0) this.pop = 1;
      this.lastN = n;
      this.lbArmy.string = String(n);
    }
    this.pop = Math.max(0, this.pop - dt * 4);
    const s = 1 + this.pop * 0.25;
    this.lbArmy.node.setScale(s, s, 1);

    this.tickEnemy(game);
  }

  private tickEnemy(game: Game): void {
    const wave = game.currentWave;
    if (!wave || wave.posZ - game.z > REVEAL_Z) { this.enemyGroup.active = false; return; }
    this.enemyGroup.active = true;

    // 认 smash 快照而不是 state：撞输时 core 会留着快照,血条得停在残血而不是弹回满血
    const hp = game.smash && game.smash.wave === wave
      ? lerp(game.smash.hBefore, game.smash.hAfter, game.smash.progress)
      : wave.H;

    this.barEnemy.setColor(wave.isBoss ? UI_C.barBoss : UI_C.barEnemy);
    this.barEnemy.set(hp / wave.H);
    // BOSS 多阶段:core 已把每段展开成独立波次,这里直接显示它给的 phase / phaseCount
    this.lbEnemy.string = wave.isBoss
      ? (wave.phaseCount > 1 ? `烂蒜魔王  第 ${wave.phase}/${wave.phaseCount} 段` : '烂蒜魔王')
      : '霉烂军团';
    this.lbEnemyHp.string = `${Math.max(0, Math.round(hp))} / ${wave.H}`;
  }
}
