/** Binary min-heap of (cost, id) pairs; stale entries are skipped by the caller. */
export class MinHeap {
  constructor() {
    this.costs = [];
    this.ids = [];
  }

  get size() {
    return this.costs.length;
  }

  push(cost, id) {
    const { costs, ids } = this;
    let i = costs.length;
    costs.push(cost);
    ids.push(id);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (costs[parent] <= cost) break;
      costs[i] = costs[parent];
      ids[i] = ids[parent];
      i = parent;
    }
    costs[i] = cost;
    ids[i] = id;
  }

  /** Removes the cheapest entry and returns [cost, id]. */
  pop() {
    const { costs, ids } = this;
    const top = [costs[0], ids[0]];
    const cost = costs.pop();
    const id = ids.pop();
    const n = costs.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && costs[child + 1] < costs[child]) child += 1;
        if (costs[child] >= cost) break;
        costs[i] = costs[child];
        ids[i] = ids[child];
        i = child;
      }
      costs[i] = cost;
      ids[i] = id;
    }
    return top;
  }
}
