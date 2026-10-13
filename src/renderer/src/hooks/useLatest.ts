import { useCallback, useLayoutEffect, useRef } from 'react';

/** A ref always holding the last rendered `value`: for callbacks created once that must call the current handlers. */
export function useLatest<T>(value: T) {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  return latest;
}

/** A function that keeps its identity across renders but always runs the last rendered `callback`. */
export function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const latest = useLatest(callback);
  return useCallback((...args: A) => latest.current(...args), [latest]);
}
