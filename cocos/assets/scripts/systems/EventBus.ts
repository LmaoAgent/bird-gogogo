// 事件总线 —— 埋点事件的分发中枢(《签到任务分享系统设计》§2 的关键:任务进度靠订阅埋点事件推进,
// 不侵入玩法代码)。引擎无关、零 cc 依赖:玩法侧只管 track,每日任务在另一头订阅,两边互不认识。
//
// ⚠️ 《P0工程骨架》§1 规划的位置是 core/EventBus.ts,但 T8/T9 都还没落地,按并行纪律不越界建
// 别人边界内的文件,故先落在 systems/。core 版本到位后把本类改成转发即可,订阅方一行不用改。

export type TrackParams = Record<string, number | string | boolean>;
export type EventHandler = (params: TrackParams) => void;

export class EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(evt: string, fn: EventHandler): void {
    const list = this.handlers.get(evt);
    if (list) list.push(fn);
    else this.handlers.set(evt, [fn]);
  }

  emit(evt: string, params: TrackParams): void {
    const list = this.handlers.get(evt);
    if (!list) return;
    for (const fn of list) fn(params);
  }
}
