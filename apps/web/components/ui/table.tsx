import { cn } from "@/lib/utils";

export const Table = ({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
    <table className={cn("w-full text-left text-sm", className)} {...props} />
  </div>
);
export const THead = (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className="bg-neutral-100 text-xs text-neutral-600 uppercase dark:bg-neutral-900 dark:text-neutral-400"
    {...props}
  />
);
export const TBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800" {...props} />
);
export const TR = (props: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />;
export const TH = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn("px-3 py-2 font-medium", className)} {...props} />
);
export const TD = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-2", className)} {...props} />
);
