// 通用对象池(《P0工程骨架》§3)—— 大军几百只,禁止逐帧 new/destroy。
// 刻意不认引擎:池只管"取/还",创建与启停由调用方以回调注入,故 core/ 保持引擎无关。

export class ObjectPool<T> {
  private readonly create: () => T;
  private readonly onGet?: (item: T) => void;
  private readonly onPut?: (item: T) => void;
  private readonly free: T[] = [];

  /** 池外在用的数量,压测/调试用。 */
  private inUse = 0;

  constructor(create: () => T, onGet?: (item: T) => void, onPut?: (item: T) => void, prewarm = 0) {
    this.create = create;
    this.onGet = onGet;
    this.onPut = onPut;
    for (let i = 0; i < prewarm; i++) this.free.push(create());
  }

  get size(): number { return this.free.length + this.inUse; }
  get active(): number { return this.inUse; }

  get(): T {
    const item = this.free.pop() ?? this.create();
    this.inUse++;
    if (this.onGet) this.onGet(item);
    return item;
  }

  put(item: T): void {
    if (this.onPut) this.onPut(item);
    this.free.push(item);
    this.inUse--;
  }
}
