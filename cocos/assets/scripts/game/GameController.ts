// 一局流程编排(《P0工程骨架》§3)——配置加载 → 养成接线 → 主循环 → 结算落盘 → 下一关。
// 挂在 Main.scene 的 Canvas 上。core/ 不认引擎,平台相关的东西全部收在本层。

import { _decorator, Component, EventTouch, JsonAsset, Node, resources } from 'cc';
import { adManager } from '../core/AdManager';
import { track } from '../core/Analytics';
import { Game } from '../core/game';
import { starRating, fMin } from '../core/rules';
import { Progress } from '../core/progress';
import type { AdConfig, AdScene, LevelConfig, LevelResult, Tuning, UpgradeConfig } from '../defs/types';
import { Systems } from '../systems/Systems';
import type { DailyConfig } from '../systems/Systems';
import { UiRoot } from '../ui/UiRoot';
import type { AdBtnState } from '../ui/ResultScreen';
import type { HomeData } from '../ui/HomeScreen';
import { ArenaView } from './ArenaView';
import { RankService } from './RankService';
import { judge, readLaunchInvite, trackAccept, watchInvite } from './Challenge';
import type { ChallengeInvite } from './Challenge';
import { cocosSharePort } from './SharePort';
import { cocosStorageAdapter, cocosSystemsStore } from './StorageAdapter';
import { isWx, wxApi } from './WxApi';
import type { WxErrorInfo } from './WxApi';

const { ccclass } = _decorator;

const DESIGN_W = 1080;
const MAX_DT = 0.05;   // 与 prototype/src/main.js 一致:单帧步长上限,切后台回来不跳关

@ccclass('GameController')
export class GameController extends Component {
  private tuning: Tuning = null;
  private levels: LevelConfig[] = null;
  private progress: Progress = null;
  private view: ArenaView = null;
  private ui: UiRoot = null;
  private game: Game = null;
  private systems: Systems = null;    // 签到 / 每日任务 / 分享(设计文档 §4)
  private readonly ads = adManager;   // 全局单例(广告spec §3.1),这里只拿引用
  private readonly rank = new RankService();   // 托管数据写入 + 子域指令(排行榜spec §2/§3)
  /** 正在打的这一局是不是挑战局(从好友的挑战卡进来的),null ＝ 普通闯关。 */
  private challenge: ChallengeInvite = null;
  /** 已经接过的那张挑战卡,给 onShow 去重用(见 startChallenge)。 */
  private lastInviteKey = '';

  private levelIndex = 0;
  private settled = false;
  /** 本局结算收益,金币翻倍要在它基础上再发一份,故存下来。 */
  private gain = { coins: 0, unlocked: false };
  private paused = false;
  /** 这次暂停是切后台造成的(而不是玩家自己按的),回前台时只恢复这一种。 */
  private bgPaused = false;
  private dragging = false;
  private lastTouchX = 0;
  private unitPx = 0;
  /** 本局星级,结算时算一次(§8 starRating(fPeak,targetF)),翻倍刷新结算页时复用。 */
  private star = 0;
  /** wave_result 埋点用:每段怪流进入时的漏怪基线(下标＝waves 下标),越过 wave.to 时结一条。 */
  private waveEnterLeak: number[] = [];
  private waveReported: boolean[] = [];

  start(): void {
    this.bindPlatform();
    // 配置表走 resources,与 prototype/config 保持同一份数值(同步以 prototype 为准)
    resources.load(
      ['config/tuning', 'config/levels', 'config/upgrade', 'config/ad', 'config/daily'],
      JsonAsset,
      (err, assets: JsonAsset[]) => {
        if (err) { console.error('[GameController] 配置加载失败', err); return; }
        this.boot(
          assets[0].json as Tuning,
          assets[1].json as LevelConfig[],
          assets[2].json as UpgradeConfig,
          assets[3].json as AdConfig,
          assets[4].json as DailyConfig,
        );
      },
    );
  }

  /**
   * 平台生命周期(T8-4)。在配置加载之前就挂,onError 才盖得住启动期的报错。
   *
   * ⚠️ 切后台必须停 game.update:引擎自己的 EVENT_HIDE 会 pause 主循环,但那是引擎的实现细节
   * (看广告、跳授权弹窗都会走这条路),把"逻辑要不要推进"押在它身上,哪天它不 pause 了
   * 就是后台把一整关跑完、回来直接看结算。MAX_DT 只挡单帧跳变,挡不住持续推进。
   */
  private bindPlatform(): void {
    if (!isWx) return;   // 编辑器预览 / web 构建下没有 wx,浏览器自己会停 rAF

    wxApi.onHide(() => {
      // 玩家自己按了暂停就别记账,否则回前台会替他把暂停页解掉
      if (this.paused) return;
      this.paused = true;
      this.bgPaused = true;
    });
    wxApi.onShow(() => {
      if (!this.bgPaused) return;
      this.bgPaused = false;
      this.paused = false;
    });
    wxApi.onError((err) => {
      const e: WxErrorInfo = typeof err === 'string' ? { message: err } : err;
      console.error('[wx.onError]', e.message, e.stack);
      track('js_error', { msg: (e.message || '').slice(0, 200), stack: (e.stack || '').slice(0, 500) });
    });
  }

  private boot(
    tuning: Tuning, levels: LevelConfig[], upgrade: UpgradeConfig, ad: AdConfig, daily: DailyConfig,
  ): void {
    this.tuning = tuning;
    this.levels = levels;
    this.progress = new Progress(cocosStorageAdapter, upgrade);
    // 广告:配置注入 + 进游戏即预加载(广告spec §3.1),非微信环境自然全灰
    this.ads.init(ad);
    this.ads.preloadRewarded();

    // 留存系统(设计文档 §4):金币经 Progress 发,广告 / 埋点 / 分享按端口转接给已有实现
    this.systems = new Systems(daily, cocosSystemsStore, this.progress, {
      analytics: { track },
      share: cocosSharePort,
      ad: {
        canShow: (scene) => this.ads.canShow(scene as AdScene),
        showRewarded: (scene, done) => {
          void this.ads.showRewarded(scene as AdScene).then((res) => done(res.ended));
        },
      },
    });

    this.view = new ArenaView(this.node, tuning);
    this.ui = new UiRoot(this.node, this.systems, {
      onStart: () => this.startLevel(),
      onNext: () => this.advance(),
      onRetry: () => this.startLevel(),
      onAd: () => { void this.onAd(); },
      onPause: () => { this.paused = true; },
      onResume: () => { this.paused = false; },
      onHome: () => this.showHome(),
      homeData: () => this.homeData(),
      onRankBoard: (board) => { track('rank_open', { board }); this.rank.render(board); },
    });

    // 屏幕像素 → 世界坐标的换算系数,与 prototype/src/input.js 同式
    this.unitPx = (DESIGN_W * 0.90) / tuning.track.width;

    // maxLevel 是已通关的最高关(1 起),故下一关的下标正好是 maxLevel
    this.levelIndex = Math.min(this.progress.maxLevel, levels.length - 1);

    // 老玩家装上带排行榜的版本时,把已有进度补写进托管数据(nPeak 传 0,只可能推动关卡那个 key)
    this.rank.submit(this.progress.maxLevel, 0);
    // 挑战卡进来就直接开那一关;热启动(游戏在后台时点卡片)只会走 onShow,所以两条都要接
    const invite = readLaunchInvite(levels.length);
    watchInvite(levels.length, (later) => this.startChallenge(later));
    if (invite) this.startChallenge(invite);
    else this.showHome();

    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  /** 回主界面:清掉局内状态,由 UI 的开始按钮再开局。 */
  private showHome(): void {
    this.game = null;
    this.paused = false;
    this.settled = false;
    this.dragging = false;
    this.challenge = null;
    this.view.reset();
    // 挂后台过夜再回来也要刷新:跨日重抽任务、清分享次数(设计文档 §2/§3.3)
    this.systems.rollover();
    this.ui.showHome(this.homeData());
  }

  /** 主界面这一刻该显示什么;领奖后 UiRoot 也拿它就地刷新金币与红点。 */
  private homeData(): HomeData {
    return {
      nextLevel: this.levels[this.levelIndex].level,
      maxLevel: this.progress.maxLevel,
      coins: this.progress.coins,
      signRedDot: this.systems.signRedDot,
      taskRedDot: this.systems.taskRedDot,
    };
  }

  private startLevel(): void {
    // ⚠️ 养成接线(§9)：起始四维 N0/L0/R0/D0 取自存档曲线,覆写进 tuning.start 后再交给 Game。
    // 这样 core/game.ts 仍然只吃配置、不认存档(引擎无关且无需为养成改规则)。
    const start = {
      N: this.progress.getStartN(this.tuning),
      L: this.progress.getStartL(this.tuning),
      R: this.progress.getStartR(this.tuning),
      D: this.progress.getStartD(this.tuning),
    };
    const tuned: Tuning = { ...this.tuning, start };

    this.game = new Game(tuned, this.levels[this.levelIndex]);
    // §11 level_start:level + 起始四维
    track('level_start', { level: this.game.level.level, N0: start.N, L0: start.L, R0: start.R, D0: start.D });
    this.waveEnterLeak = [];
    this.waveReported = [];
    this.settled = false;
    this.paused = false;
    this.dragging = false;
    this.ads.resetRun();     // 新一局:复活 / 翻倍的每局配额清零(广告spec §4)
    this.view.reset();
    this.ui.showHud();
    // 重开本关(含暂停页重开)时挑战身份要留着,所以这里读字段而不是无脑清空
    this.ui.setChallenge(this.challenge);
  }

  /**
   * 从好友的挑战卡进来:直接开那一关(排行榜spec §4.2 第 2 步)。
   * ⚠️ 挑战局是表演赛 —— 结算不写档、不发币,否则一张分享链接就能把前面几十关的进度跳过去。
   */
  private startChallenge(invite: ChallengeInvite): void {
    // ⚠️ onShow 每次切回前台都会带着当次的 query 触发(看完广告回来也算),同一张卡只认第一次,
    // 否则打到一半会被自己重开一局。换一张卡(关卡或目标分不同)照常接。
    const key = `${invite.level}|${invite.score}|${invite.from}`;
    if (key === this.lastInviteKey) return;
    this.lastInviteKey = key;

    trackAccept(invite);
    this.challenge = invite;
    this.levelIndex = invite.level - 1;
    this.startLevel();
  }

  update(dt: number): void {
    if (!this.ui) return;             // 配置还没加载完

    if (this.game && !this.paused) {
      this.game.update(Math.min(dt, MAX_DT));
      this.view.consume(this.game);
      this.pumpEvents();
      this.trackWaves();
      this.view.draw(this.game, dt);

      if (!this.settled && (this.game.state === 'win' || this.game.state === 'fail')) this.settle();
    }
    // UI 放在最后刷：HUD 读的是本帧推进后的状态,不落后一帧;主界面/暂停时也要走,面板动画才不卡住
    this.ui.tick(this.game, dt);
  }

  private settle(): void {
    this.settled = true;
    const r = this.game.result;
    const level = this.game.level;
    // §8 星级:core 只给 fPeak,分母 level.targetF、阈值 level.star || tuning.star。core 不算星级,接线层算。
    this.star = r.win ? starRating(r.fPeak, level.targetF, level.star || this.tuning.star) : 0;
    const fPeak = Math.round(r.fPeak);

    // §11 埋点。挑战局也照发 —— level_start 那边不分家,这里分了漏斗就对不上账
    // (挑战局另有 challenge_result,要剔除按那个 join)。
    if (r.win) track('level_win', { level: level.level, F_peak: fPeak, targetF: level.targetF, star: this.star });
    else track('level_fail', { level: level.level, F_peak: fPeak, targetF: level.targetF, star: 0, reason: r.reason ?? '' });

    // 挑战局:只比胜负,不写档不发币(见 startChallenge)。战绩纪录照记 ——
    // maxLevel 传 0 就只可能推动 max_troop(v2 分数维度＝fPeak),不会让分享链接把关卡进度顶上去。
    if (this.challenge) {
      this.gain = { coins: 0, unlocked: false };
      if (r.win) this.rank.submit(0, fPeak);
      this.view.showResult(this.game, this.gain, this.progress.coins);
      this.ui.showPkResult(judge(this.challenge, fPeak), fPeak, this.challenge);
      return;
    }

    // ⚠️ 结算落盘:星级回填进 result 后交给 Progress(§8 换了分母,金币/星级框架照旧复用)。
    // 通关才写档给币,失败时 applyLevelResult 内部原样返回(不写档)。
    const scored: LevelResult = { ...r, star: this.star };
    this.gain = this.progress.applyLevelResult(level.level, scored);
    if (r.win) {
      this.systems.feed('level_win', { level: level.level, star: this.star, fPeak });
      this.rank.submit(this.progress.maxLevel, fPeak);   // R01 刷新纪录才写托管数据
      this.rank.beat(fPeak);                             // R04 让子域画"本局击败了 X 位好友"
    }
    this.view.showResult(this.game, this.gain, this.progress.coins);
    this.showResultUi();
  }

  /**
   * 玩法事件泵(§11 埋点 + §2 任务进度)。玩法代码一行没动 —— 事件本来就在 game.events 里,
   * 这里顺手把每条转成埋点(track)与任务进度(systems.feed)。加减任务只改 config/daily.json。
   * 连排门(repeat)展开后一门一条 —— "这排吃到几个"正是要调的数,合并了就没这数了。
   */
  private pumpEvents(): void {
    const level = this.game.level.level;
    for (const e of this.game.events) {
      if (e.kind === 'gate') {
        // §11 gate_pick:level / gateId / dim(N-L-R-D) / op(add-mul) / choice
        track('gate_pick', {
          level, gateId: e.gate.id, dim: e.effect.dim, op: e.effect.op,
          choice: `${e.effect.dim}${e.effect.op === 'mul' ? '×' : '+'}${e.effect.value}@${e.effect.side}`,
        });
        this.systems.feed('gate_pick', { dim: e.effect.dim, op: e.effect.op });
      } else if (e.kind === 'obstacleHit') {
        track('obstacle_hit', { level, type: e.obstacle.type, lossN: e.loss });
        this.systems.feed('obstacle_hit', { type: e.obstacle.type, lossN: e.loss });
      } else if (e.kind === 'barrelHit') {
        // hit/break 成对才有意义:hit 是"多少人选择去打"、break 是"多少人打成了",落差即分神却没换到的那批。
        track('barrel_hit', { level, rewardDim: (e.barrel.reward.buff || e.barrel.reward.dim) as string });
      } else if (e.kind === 'barrelBreak') {
        track('barrel_break', { level, rewardDim: (e.reward.buff || e.reward.dim) as string, gain: +e.gain.toFixed(3) });
        this.systems.feed('barrel_break', { rewardDim: (e.reward.buff || e.reward.dim) as string });
      }
    }
  }

  /**
   * wave_result 埋点(§11 数值调优核心指标)。core 不发这条(v2 怪流是连续的,没有离散"波次结束"),
   * 由接线层在大军越过每段 wave.to 时补一条:leaked = 该段区间内 game.leakCount 的增量。
   * 纯埋点,不影响玩法/对拍。
   */
  private trackWaves(): void {
    const level = this.game.level.level;
    const waves = this.game.level.waves || [];
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      if (this.waveEnterLeak[i] === undefined && this.game.z >= w.from) {
        this.waveEnterLeak[i] = this.game.leakCount;
      }
      if (!this.waveReported[i] && this.waveEnterLeak[i] !== undefined && this.game.z > w.to) {
        this.waveReported[i] = true;
        const leaked = this.game.leakCount - this.waveEnterLeak[i];
        track('wave_result', {
          level, waveIdx: i, F: Math.round(this.game.F), F_min: Math.round(fMin(w)),
          leaked, lossN: Math.floor(leaked / this.tuning.enemiesPerLoss),
        });
        this.systems.feed('wave_result', { waveIdx: i, leaked });
      }
    }
  }

  // —— 广告(《广告接入spec.md》§7 接线:结算页翻倍 / 失败页复活) ——

  /** 结算页每次刷新都重算广告按钮三态:发完奖、配额用尽后按钮自己收掉。星级本局算一次(this.star)。 */
  private showResultUi(): void {
    this.ui.showResult(this.game, this.gain, this.progress.coins, this.adState(this.adScene()), this.star);
  }

  /** 通关页是金币翻倍位,失败页是复活位。 */
  private adScene(): AdScene {
    return this.game.state === 'win' ? 'double' : 'revive';
  }

  private adState(scene: AdScene): AdBtnState {
    if (this.ads.remaining(scene) <= 0) return 'hidden';      // 本局配额用尽:按钮不出
    return this.ads.canShow(scene) ? 'ready' : 'disabled';    // 没配 adUnitId / 无填充:置灰
  }

  /**
   * 看广告拿奖励。红线:只有 res.ended(看完)才发奖,中途退出原样退回结算页。
   * 奖励本身一律由 core 算 —— 复活兵力走 Game.revive(§7 公式),金币走 Progress。
   */
  private async onAd(): Promise<void> {
    const scene = this.adScene();
    if (!this.ads.canShow(scene)) return;   // 按钮此时本该是灰的/收起的,这里再挡一道

    const res = await this.ads.showRewarded(scene);
    if (!res.ended) {
      this.ui.showToast('广告没看完,奖励未发放');
      this.showResultUi();
      return;
    }
    if (scene === 'double') this.doubleCoins();
    else this.reviveRun();
  }

  /** 金币翻倍:在本局收益之上再入账一份,记账走 Progress(UI 一个数都不算)。 */
  private doubleCoins(): void {
    const extra = this.gain.coins;
    this.progress.grant({ coin: extra });
    this.gain = { coins: this.gain.coins + extra, unlocked: this.gain.unlocked };
    track('ad_reward', { scene: 'double', rewardType: 'coin', rewardValue: extra });
    this.systems.feed('ad_reward', { scene: 'double' });   // 「看 1 次广告」任务(设计文档 §2)
    this.showResultUi();
  }

  /** 复活续冲:兵力按 core §7 公式恢复,收掉结算页接着打这一局。 */
  private reviveRun(): void {
    const n = this.game.revive();
    track('ad_reward', { scene: 'revive', rewardType: 'army', rewardValue: n });
    this.systems.feed('ad_reward', { scene: 'revive' });   // 「看 1 次广告」任务(设计文档 §2)
    this.settled = false;
    this.ui.showHud();
  }

  // —— 输入(单指水平拖动 → 队形中心 X,行为对齐 prototype/src/input.js) ——

  private onTouchStart(e: EventTouch): void {
    if (!this.canDrag()) return;
    this.dragging = true;
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
  }

  /** 只有正在打的那一局吃拖动;主界面 / 结算 / 暂停时手指不该影响赛道(推进改由 UI 按钮触发)。 */
  private canDrag(): boolean {
    return !!this.game && !this.settled && !this.paused;
  }

  /** 通关进下一关(打完一轮回到第 1 关),失败重开本关 —— 同 prototype/src/main.js,现由结算页按钮触发。 */
  private advance(): void {
    if (this.game.state === 'win') this.levelIndex = (this.levelIndex + 1) % this.levels.length;
    this.challenge = null;   // 往下打就回到自己的进度线,不再顶着好友的目标分
    this.startLevel();
  }
}
