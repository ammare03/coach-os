// The `expo-sqlite` stand-in every outbox test runs against.
//
// `expo-sqlite` has no Jest-side native module, so this is a hand-built
// fake with a real (if small) SQL parser over in-memory tables: `begin`/
// `commit`/`rollback`, `INSERT`, `UPDATE`, and a `SELECT` grammar covering
// the `WHERE`/`ORDER BY`/`LIMIT` subset this folder's queries actually
// emit. It serves both `executeSync` (raw `sql`, object rows) and
// `executeForRawResultSync` (Drizzle builder selects, positional rows).
//
// It lives here rather than inside one test file because `outbox/02` and
// `outbox/03` both need it, and a second divergent copy is how two suites
// start disagreeing about what SQLite does. (`enqueue.test.ts` still
// carries task 01's narrower original — that file is not this task's to
// rewrite, and its fake is a strict subset of this one.)
//
// Not a `*.test.ts` file, so Jest never collects it as a suite.

type Row = Record<string, unknown>;

/**
 * Builds a fresh fake module. Called from inside a `jest.mock` factory,
 * which may not close over an out-of-scope value but may `require`.
 */
export function createSqliteFake() {
  const tables = new Map<string, Row[]>();
  let snapshot: Map<string, Row[]> | null = null;

  function tableRows(name: string): Row[] {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  }

  function copyTables(): Map<string, Row[]> {
    return new Map([...tables].map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]));
  }

  function makeResult(rows: Row[], columns: string[] | null, changes = 0, lastInsertRowId = 0) {
    return {
      changes,
      lastInsertRowId,
      getFirstSync: () => rows[0],
      // Drizzle's builder selects go through `executeForRawResultSync`, which
      // returns positional arrays; raw `sql` selects go through
      // `executeSync`, which returns objects.
      getAllSync: () => (columns ? rows.map((r) => columns.map((c) => r[c])) : rows),
    };
  }

  const stripQuotes = (token: string) => token.replace(/"/g, '').trim();
  const columnOf = (token: string) => {
    const parts = stripQuotes(token).split('.');
    return parts[parts.length - 1] ?? '';
  };

  function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (depth === 0 && text.startsWith(separator, i)) {
        parts.push(text.slice(start, i));
        i += separator.length - 1;
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
  }

  // Compiles the `WHERE` subset this module's queries actually emit —
  // `col in (?, …)`, `col <op> ?`, joined by `and`. Placeholders are consumed
  // through `take()` in statement order, which is how the driver binds them.
  function compileWhere(text: string, take: () => unknown): (row: Row) => boolean {
    let body = text.trim();
    while (
      body.startsWith('(') &&
      splitTopLevel(body, ' and ').length === 1 &&
      body.endsWith(')')
    ) {
      const inner = body.slice(1, -1).trim();
      if (splitTopLevel(inner, ')').length > 1 && !inner.startsWith('(')) break;
      body = inner;
    }
    const predicates = splitTopLevel(body, ' and ').map((term) => {
      const inMatch = /^(\S+)\s+in\s*\(([^)]*)\)$/i.exec(term);
      if (inMatch?.[1] && inMatch[2] !== undefined) {
        const column = columnOf(inMatch[1]);
        const values = inMatch[2].split(',').map(() => take());
        return (row: Row) => values.includes(row[column]);
      }
      const nullMatch = /^(\S+)\s+is\s+(not\s+)?null$/i.exec(term);
      if (nullMatch?.[1]) {
        const column = columnOf(nullMatch[1]);
        const negated = Boolean(nullMatch[2]);
        return (row: Row) => (row[column] === null || row[column] === undefined) !== negated;
      }
      const compare = /^(\S+)\s*(<=|>=|!=|<>|<|>|=)\s*\?$/.exec(term);
      if (!compare?.[1] || !compare[2]) {
        throw new Error(`Unhandled WHERE term in fake expo-sqlite: ${term}`);
      }
      const column = columnOf(compare[1]);
      const operator = compare[2];
      const value = take();
      return (row: Row) => {
        const actual = row[column];
        switch (operator) {
          case '=':
            return actual === value;
          case '!=':
          case '<>':
            return actual !== value;
          case '<':
            return Number(actual) < Number(value);
          case '<=':
            return Number(actual) <= Number(value);
          case '>':
            return Number(actual) > Number(value);
          default:
            return Number(actual) >= Number(value);
        }
      };
    });
    return (row: Row) => predicates.every((predicate) => predicate(row));
  }

  function keywordIndex(text: string, keyword: RegExp): number {
    const match = keyword.exec(text);
    return match ? match.index : -1;
  }

  let failNextWrite: string | null = null;

  function execute(sqlText: string, params: unknown[], columnsWanted: boolean) {
    const statement = sqlText.trim();
    let cursor = 0;
    const take = () => params[cursor++];

    if (/^begin/i.test(statement)) {
      snapshot = copyTables();
      return makeResult([], null);
    }
    if (/^commit/i.test(statement)) {
      snapshot = null;
      return makeResult([], null);
    }
    if (/^rollback/i.test(statement)) {
      if (snapshot) {
        tables.clear();
        for (const [name, rows] of snapshot) tables.set(name, rows);
        snapshot = null;
      }
      return makeResult([], null);
    }

    const createTable = /^CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(statement);
    if (createTable?.[1]) {
      tableRows(createTable[1]);
      return makeResult([], null);
    }
    if (/^CREATE INDEX/i.test(statement)) {
      return makeResult([], null);
    }

    const insertInto =
      /^INSERT\s+INTO\s+"?(\w+)"?\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i.exec(statement);
    if (insertInto?.[1] && insertInto[2] && insertInto[3] !== undefined) {
      if (failNextWrite !== null) {
        const message = failNextWrite;
        failNextWrite = null;
        throw new Error(message);
      }
      const columns = insertInto[2].split(',').map((c) => stripQuotes(c));
      const values = insertInto[3].split(',').map((v) => v.trim());
      const row: Row = {};
      columns.forEach((column, i) => {
        const token = values[i];
        if (token === '?') row[column] = take();
        else if (token === undefined || /^null$/i.test(token)) row[column] = null;
        else row[column] = token.replace(/^'|'$/g, '');
      });
      const rows = tableRows(insertInto[1]);
      rows.push(row);
      return makeResult([row], null, 1, rows.length);
    }

    const update = /^update\s+"?(\w+)"?\s+set\s/i.exec(statement);
    if (update?.[1]) {
      if (failNextWrite !== null) {
        const message = failNextWrite;
        failNextWrite = null;
        throw new Error(message);
      }
      const afterSet = statement.slice(update[0].length);
      const whereAt = keywordIndex(afterSet, /\swhere\s/i);
      const setText = whereAt === -1 ? afterSet : afterSet.slice(0, whereAt);
      const assignments = splitTopLevel(setText, ',').map((pair) => {
        const [left, right] = pair.split('=').map((s) => s.trim());
        if (!left || right !== '?') {
          throw new Error(`Unhandled SET clause in fake expo-sqlite: ${pair}`);
        }
        return [columnOf(left), take()] as const;
      });
      const matches =
        whereAt === -1
          ? () => true
          : compileWhere(afterSet.slice(whereAt + ' where '.length), take);
      let changes = 0;
      for (const row of tableRows(update[1])) {
        if (!matches(row)) continue;
        for (const [column, value] of assignments) row[column] = value;
        changes += 1;
      }
      return makeResult([], null, changes);
    }

    const select = /^select\s+([\s\S]*?)\s+from\s+"?(\w+)"?/i.exec(statement);
    if (select?.[1] && select[2]) {
      const columnList = select[1].trim();
      const columns =
        columnList === '*' ? null : columnList.split(',').map((c) => columnOf(c.trim()));
      const tail = statement.slice(select[0].length);
      const whereAt = keywordIndex(tail, /\swhere\s/i);
      const orderAt = keywordIndex(tail, /\sorder\s+by\s/i);
      const limitAt = keywordIndex(tail, /\slimit\s/i);
      const endOfWhere = [orderAt, limitAt].filter((i) => i !== -1).sort((a, b) => a - b)[0];
      let rows = [...tableRows(select[2])];
      if (whereAt !== -1) {
        const whereText = tail.slice(
          whereAt + ' where '.length,
          endOfWhere === undefined ? undefined : endOfWhere,
        );
        const matches = compileWhere(whereText, take);
        rows = rows.filter(matches);
      }
      if (orderAt !== -1) {
        const orderText = tail.slice(
          orderAt + ' order by '.length,
          limitAt === -1 ? undefined : limitAt,
        );
        const [columnToken = '', direction = 'asc'] = orderText.trim().split(/\s+/);
        const column = columnOf(columnToken);
        const sign = direction.toLowerCase() === 'desc' ? -1 : 1;
        rows.sort((a, b) => (Number(a[column]) - Number(b[column])) * sign);
      }
      if (limitAt !== -1) {
        rows = rows.slice(0, Number(take()));
      }
      return makeResult(rows, columnsWanted ? columns : null);
    }

    throw new Error(`Unhandled SQL in fake expo-sqlite: ${statement}`);
  }

  const database = {
    prepareSync: (sqlText: string) => ({
      executeSync: (params: unknown[] = []) => execute(sqlText, params, false),
      executeForRawResultSync: (params: unknown[] = []) => execute(sqlText, params, true),
    }),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
    __reset: () => {
      tables.clear();
      snapshot = null;
      failNextWrite = null;
    },
    __failNextWrite: (message: string) => {
      failNextWrite = message;
    },
  };
}
