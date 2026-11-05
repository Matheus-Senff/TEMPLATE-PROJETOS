/**
 * Memoized async loader: the SDK module is imported on first use only (cold start pays nothing for modules
 * that are disabled or not used by the request). A failed import is retried on the next call.
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
