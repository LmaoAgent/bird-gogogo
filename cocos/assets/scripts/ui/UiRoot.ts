// UI 总装 —— 四块界面的显隐编排,GameController 的唯一 UI 入口。
// 本层只读 game 字段与 core 结算返回值做呈现,不含任何玩法规则(星级、金币都由 core 给)。

import { Node } from 'cc';
import { HomeScreen } from './HomeScreen';
import { HudScreen } from './HudScreen';
import { PauseScreen } from './PauseScreen';
import { ResultScreen } from './ResultScreen';
import { Toast, uiNode } from './UiKit';
import type { HomeData } from './HomeScreen';
import type { Game } from '../core/game';

export interface UiCallbacks {
  /** 主界面开始 → 开打当前关。 */
  onStart(): void;
  /** 结算页下一关。 */
  onNext(): void;
  /** 失败页 / 暂停页重开本关。 */
  onRetry(): void;
  onPause(): void;
  onResume(): void;
  onHome(): void;
}

/** 失败原因文案:只把 core 记下的 failWave 与对撞快照翻成人话。 */
function failReason(game: Game): string {
  const r = game.result;
  if (!r || r.failWave < 0) return '兵力被陷阱耗尽';

  const wave = game.smash ? game.smash.wave : null;
  const who = wave && wave.isBoss
    ? (wave.phaseCount > 1 ? `烂蒜魔王第 ${wave.phase}/${wave.phaseCount} 段` : '烂蒜魔王')
    : `第 ${r.failWave + 1} 波`;
  const detail = game.smash ? `(撞击时 ${game.smash.nBefore} 兵)` : '';
  return `撞不动${who}${detail}`;
}

export class UiRoot {
  readonly node: Node;
  private readonly home: HomeScreen;
  private readonly hud: HudScreen;
  private readonly result: ResultScreen;
  private readonly pause: PauseScreen;
  private readonly toast: Toast;

  constructor(parent: Node, cb: UiCallbacks) {
    // 建在 ArenaView 之后 → 兄弟序更靠后 → 盖在赛道上层;界面之间也按建的先后叠。
    this.node = uiNode(parent, 'Ui');

    this.home = new HomeScreen(this.node, cb.onStart, (name) => this.toast.show(`${name}敬请期待`));
    this.hud = new HudScreen(this.node, () => { this.pause.show(); cb.onPause(); });
    this.result = new ResultScreen(this.node, {
      onNext: () => { this.result.hide(); cb.onNext(); },
      onRetry: () => { this.result.hide(); cb.onRetry(); },
      onAdPlaceholder: () => this.toast.show('广告功能开发中'),
    });
    this.pause = new PauseScreen(this.node, {
      onResume: () => { this.pause.hide(); cb.onResume(); },
      onRetry: () => { this.pause.hide(); cb.onRetry(); },
      onHome: () => { this.pause.hide(); cb.onHome(); },
    });
    this.toast = new Toast(this.node);   // 最后建,盖在所有面板之上
  }

  showHome(data: HomeData): void {
    this.hud.hide();
    this.result.hide();
    this.pause.hide();
    this.home.show(data);
  }

  showHud(): void {
    this.home.hide();
    this.result.hide();
    this.pause.hide();
    this.hud.show();
  }

  /** gain / coins 直接取 Progress.applyLevelResult 的返回值与存档余额。 */
  showResult(game: Game, gain: { coins: number; unlocked: boolean }, coins: number): void {
    const r = game.result;
    if (r.win) this.result.showWin(r.star, r.nPeak, gain.coins, coins);
    else this.result.showFail(failReason(game), r.nPeak);
  }

  tick(game: Game | null, dt: number): void {
    this.toast.tick(dt);
    if (game && this.hud.node.active) this.hud.tick(game, dt);
  }
}
