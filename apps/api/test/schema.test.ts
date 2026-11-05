import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import { PgTimestamp } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";

const tables = Object.values(schema).filter((value) => isTable(value));

describe("schema conventions", () => {
  it("every timestamp column has millisecond precision (timestampMs), so pagination cursors never skip rows", () => {
    const offenders = tables.flatMap((table) =>
      Object.values(getTableColumns(table))
        .filter((column) => column instanceof PgTimestamp && column.precision !== 3)
        .map((column) => `${getTableName(table)}.${column.name}`),
    );
    expect(offenders).toEqual([]);
  });
});
