/**
 * Minimal CSV reader for the balance tables in /data.
 * - Delimiter is detected from the header line: ";" (Excel in Russian locale), tab, or ",".
 * - Decimal comma is accepted ("0,8" == "0.8").
 * - Quoted fields ("a;b", "say ""hi""") are supported.
 * - Empty lines and lines starting with "#" are ignored.
 */
export type Row = { line: number; get: (col: string) => string };

export class TableReader {
  readonly rows: Row[] = [];
  readonly columns: string[] = [];

  constructor(
    readonly file: string,
    text: string,
    private readonly errors: string[],
    required: string[],
  ) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
    if (headerIdx < 0) {
      errors.push(`${file}: файл пустой`);
      return;
    }
    const header = lines[headerIdx];
    const delim = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
    this.columns = splitLine(header, delim).map((c) => c.trim().toLowerCase());
    for (const col of required)
      if (!this.columns.includes(col)) errors.push(`${file}: нет столбца «${col}»`);

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      const cells = splitLine(raw, delim);
      if (cells.every((c) => !c.trim())) continue;
      const map = new Map<string, string>();
      this.columns.forEach((c, j) => map.set(c, (cells[j] ?? '').trim()));
      this.rows.push({ line: i + 1, get: (col) => map.get(col) ?? '' });
    }
  }

  private err(row: Row, col: string, msg: string) {
    this.errors.push(`${this.file}, строка ${row.line}, «${col}»: ${msg}`);
  }

  str(row: Row, col: string, required = true): string {
    const v = row.get(col);
    if (!v && required) this.err(row, col, 'пусто');
    return v;
  }

  /** Number; empty cell gives `def` (or an error if def is undefined). */
  num(row: Row, col: string, def?: number, min = 0): number {
    const v = row.get(col);
    if (!v) {
      if (def === undefined) this.err(row, col, 'пусто, нужно число');
      return def ?? 0;
    }
    const n = Number(v.replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(n)) {
      this.err(row, col, `«${v}» не число`);
      return def ?? 0;
    }
    if (n < min) this.err(row, col, `${n} меньше ${min}`);
    return n;
  }

  bool(row: Row, col: string): boolean {
    const v = row.get(col).toLowerCase();
    if (['да', 'yes', 'y', '1', 'true', '+'].includes(v)) return true;
    if (['', 'нет', 'no', 'n', '0', 'false', '-'].includes(v)) return false;
    this.err(row, col, `«${v}»: нужно «да» или «нет»`);
    return false;
  }

  color(row: Row, col: string): number {
    const v = row.get(col).replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(v)) {
      this.err(row, col, `«${row.get(col)}»: нужен цвет вида #ff8800`);
      return 0xff00ff;
    }
    return parseInt(v, 16);
  }

  fail(row: Row, col: string, msg: string) {
    this.err(row, col, msg);
  }
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) {
      quoted = true;
      cur = '';
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
