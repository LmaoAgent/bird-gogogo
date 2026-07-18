// 一局流程编排(《P0工程骨架》§3)——配置加载 → 养成接线 → 主循环 → 结算落盘 → 下一关。
// 挂在 Main.scene 的 Canvas 上。core/ 不认引擎,平台相关的东西全部收在本层。

import { _decorator, Component, EventTouch, JsonAsset, Node, resources } from 'cc';
import { Game } from '../core/game';
import { Progress } from '../core/progress';
import type { LevelConfig, Tuning, UpgradeConfig } from '../defs/types';
import { ArenaView } from './ArenaView';
import { cocosStorageAdapter } from './StorageAdapter';

const { ccclass } = _decorator;

const DESIGN_W = 1080;
const MAX_DT = 0.05;   // 与 prototype/src/main.js 一致:单帧步长上限,切后台回来不跳关

@ccclass('GameController')
export class GameController extends Component {
  private tuning: Tuning = null;
  private levels: LevelConfig[] = null;
  private progress: Progress = null;
  private view: ArenaView = null;
  private game: Game = null;

  private levelIndex = 0;
  private settled = false;
  private dragging = false;
  private tapAfterSettle = false;
  private lastTouchX = 0;
  private unitPx = 0;

  start(): void {
    // 配置表走 resources,与 prototype/config 保持同一份数值(同步以 prototype 为准)
    resources.load(
      ['config/tuning', 'config/levels', 'config/upgrade'],
      JsonAsset,
      (err, assets: JsonAsset[]) => {
        if (err) { console.error('[GameController] 配置加载失败', err); return; }
        this.boot(
          assets[0].json as Tuning,
          assets[1].json as LevelConfig[],
          assets[2].json as UpgradeConfig,
        );
      },
    );
  }

  private boot(tuning: Tuning, levels: LevelConfig[], upgrade: UpgradeConfig): void {
    this.tuning = tuning;
    this.levels = levels;
    this.progress = new Progress(cocosStorageAdapter, upgrade);
    this.view = new ArenaView(this.node, tuning);

    // 屏幕像素 → 世界坐标的换算系数,与 prototype/src/input.js 同式
    this.unitPx = (DESIGN_W * 0.90) / tuning.track.width;

    // maxLevel 是已通关的最高关(1 起),故下一关的下标正好是 maxLevel
    this.levelIndex = Math.min(this.progress.maxLevel, levels.length - 1);
    this.startLevel();

    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  private startLevel(): void {
    // ⚠️ 养成接线：起始兵力与单兵 DPS 取自存档曲线,覆写进 tuning 后再交给 Game。
    // 这样 core/game.ts 仍然只吃配置、不认存档(引擎无关且无需为养成改规则)。
    // getUnitPower 只进 smashDuration(演出时长);resolveSmash 不看 dps,故不影响胜负。
    const tuned: Tuning = {
      ...this.tuning,
      startArmy: this.progress.getStartArmy(this.tuning),
      combat: { ...this.tuning.combat, dps: this.progress.getUnitPower(this.tuning) },
    };

    this.game = new Game(tuned, this.levels[this.levelIndex]);
    this.settled = false;
    this.view.reset();
  }

  update(dt: number): void {
    if (!this.game) return;
    this.game.update(Math.min(dt, MAX_DT));
    this.view.consume(this.game);
    this.view.draw(this.game, dt);

    if (!this.settled && (this.game.state === 'win' || this.game.state === 'fail')) this.settle();
  }

  private settle(): void {
    this.settled = true;
    // ⚠️ 结算落盘：通关才写档给币,失败时 applyLevelResult 内部原样返回(不写档)。
    const gain = this.progress.applyLevelResult(this.game.level.level, this.game.result);
    this.view.showResult(this.game, gain, this.progress.coins);
  }

  // —— 输入(单指水平拖动 → 队形中心 X,行为对齐 prototype/src/input.js) ——

  private onTouchStart(e: EventTouch): void {
    this.dragging = true;
    this.tapAfterSettle = this.settled;   // 结算前按下的手指抬起时不算"点击继续"
    this.lastTouchX = e.getUILocation().x;
  }

  private onTouchMove(e: EventTouch): void {
    if (!this.dragging) return;
    const x = e.getUILocation().x;
    // 相对增量映射(而非绝对定位),手指抬起再落下不会瞬移大军
    this.game.dragBy(((x - this.lastTouchX) / this.unitPx) * this.tuning.dragSensitivity);
    this.lastTouchX = x;
  }

  private onTouchEnd(): void {
    this.dragging = false;
    if (this.settled && this.tapAfterSettle) this.advance();
  }

  /** 通关进下一关(打完一轮回到第 1 关),失败重开本关 —— 同 prototype/src/main.js。 */
  private advance(): void {
    if (this.game.state === 'win') this.levelIndex = (this.levelIndex + 1) % this.levels.length;
    this.startLevel();
  }
}
