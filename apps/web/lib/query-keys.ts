/** Central query keys: invalidate by prefix, e.g. `queryClient.invalidateQueries({ queryKey: queryKeys.files.all })`. */
export const queryKeys = {
  notifications: { all: ["notifications"] as const, list: () => ["notifications", "list"] as const },
  files: { all: ["files"] as const, list: () => ["files", "list"] as const },
  billing: { all: ["billing"] as const, subscription: () => ["billing", "subscription"] as const },
  flags: () => ["flags"] as const,
} as const;
