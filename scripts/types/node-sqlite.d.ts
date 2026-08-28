/**
 * node:sqlite 最小类型声明。
 * 运行时是 Node 26（内置 node:sqlite）；仓库 @types/node 锁在 ^20，没有该模块的类型，
 * 这里只为类型检查提供与实际用到的 API 一致的声明。
 */
declare module 'node:sqlite' {
  interface SqliteStatement {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean; enableForeignKeyConstraints?: boolean });
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
    open(): void;
  }
}
