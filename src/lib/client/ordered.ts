/**
 * Keeps answers in the order the questions were asked. Hand out a number when a request starts; when its answer arrives,
 * `accept(number)` is true only if no newer request has already been answered. An older answer that arrives late is refused,
 * so it can never overwrite newer state.
 */
export type Ordered = {
  next(): number;
  accept(n: number): boolean;
};

export function createOrdered(): Ordered {
  let issued = 0;
  let applied = 0;
  return {
    next: () => ++issued,
    accept(n) {
      if (n <= applied) return false;
      applied = n;
      return true;
    },
  };
}
