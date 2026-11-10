/**
 * Delimited text (CSV/TSV) decoding, sniffing and parsing (RFC 4180 with the usual lenience:
 * any line ending, quotes only significant at the start of a field, unterminated quotes run
 * to the end of the input).
 */

/** Delimiters considered by {@link sniffDelimiter}, in tie-break order. */
export const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"] as const;

export interface CsvParseOptions {
  /** Field separator (one character). Sniffed when omitted. */
  delimiter?: string;
  /** Rows kept in `rows`; later rows are only counted. Default unlimited. */
  maxRows?: number;
  /** Fields kept per row; later fields are only counted. Default unlimited. */
  maxCols?: number;
}

export interface CsvParseResult {
  /** Kept rows (at most `maxRows`), each with at most `maxCols` fields. */
  rows: string[][];
  delimiter: string;
  /** All records in the input. */
  totalRows: number;
  /** Widest record in the input. */
  totalCols: number;
  /** Non-empty fields outside the kept rows/columns. */
  droppedFields: number;
  /** True when the input ended inside a quoted field. */
  unterminatedQuote: boolean;
}

/**
 * Decodes delimited text: honours UTF-8 and UTF-16 byte order marks, otherwise tries strict
 * UTF-8 and falls back to Windows-1252 (what spreadsheet apps write for "CSV" on Windows).
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Picks the delimiter whose field count is the most consistent (and largest) across the first
 * records. `preferred` wins ties (e.g. a tab for `.tsv`). Falls back to a comma.
 */
export function sniffDelimiter(text: string, preferred?: string): string {
  const sample = text.slice(0, 64 * 1024);
  // A cut sample may end inside a record; ignore the last one unless the whole text fit.
  const complete = sample.length === text.length;
  let best = preferred ?? ",";
  let bestScore = 0;
  const order = preferred ? [preferred, ...CANDIDATE_DELIMITERS.filter((d) => d !== preferred)] : CANDIDATE_DELIMITERS;
  for (const delimiter of order) {
    const counts: number[] = [];
    scan(sample, delimiter, 21, (fields) => {
      counts.push(fields);
    });
    if (!complete && counts.length > 1) counts.pop();
    const score = consistency(counts.slice(0, 20));
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function consistency(counts: number[]): number {
  if (counts.length === 0) return 0;
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
  let mode = 1;
  let modeFreq = 0;
  for (const [count, n] of freq) {
    if (n > modeFreq || (n === modeFreq && count > mode)) {
      mode = count;
      modeFreq = n;
    }
  }
  if (mode < 2) return 0;
  // Consistency dominates; wider records break ties between equally consistent candidates.
  return (modeFreq / counts.length) * 1000 + Math.min(mode, 999);
}

/** Counts fields per record without materialising them (used for sniffing). */
function scan(text: string, delimiter: string, maxRecords: number, onRecord: (fields: number) => void): void {
  let records = 0;
  parseInto(text, delimiter, {
    field() {},
    record(fields) {
      onRecord(fields);
      return ++records < maxRecords;
    },
  });
}

interface Sink {
  /** Called for every completed field of the current record. */
  field(value: string, index: number): void;
  /** Called at the end of every record; return false to stop. */
  record(fields: number): boolean;
}

/** Core state machine; returns true when the input ended inside a quoted field. */
function parseInto(text: string, delimiter: string, sink: Sink): boolean {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const delim = delimiter.charCodeAt(0);
  let field = 0;
  let value = "";
  while (i < n) {
    let ch = text.charCodeAt(i);
    if (ch === 0x22 /* " */) {
      // Quoted field: "" is an escaped quote; everything else (delimiters, newlines) is literal.
      i++;
      let start = i;
      let closed = false;
      while (i < n) {
        if (text.charCodeAt(i) === 0x22) {
          value += text.slice(start, i);
          if (text.charCodeAt(i + 1) === 0x22) {
            value += '"';
            i += 2;
            start = i;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        value += text.slice(start, n);
        sink.field(value, field);
        sink.record(field + 1);
        return true;
      }
      // Lenient: characters between the closing quote and the delimiter are kept.
      start = i;
      while (i < n) {
        ch = text.charCodeAt(i);
        if (ch === delim || ch === 0x0a || ch === 0x0d) break;
        i++;
      }
      value += text.slice(start, i);
    } else {
      const start = i;
      while (i < n) {
        ch = text.charCodeAt(i);
        if (ch === delim || ch === 0x0a || ch === 0x0d) break;
        i++;
      }
      value = text.slice(start, i);
    }
    sink.field(value, field);
    value = "";
    if (i >= n) {
      sink.record(field + 1);
      return false;
    }
    ch = text.charCodeAt(i);
    if (ch === delim) {
      field++;
      i++;
      // A trailing delimiter at the very end still opens one (empty) field.
      if (i >= n) {
        sink.field("", field);
        sink.record(field + 1);
        return false;
      }
      continue;
    }
    // Line ending: \r\n, \n or a lone \r.
    i += ch === 0x0d && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
    if (!sink.record(field + 1)) return false;
    field = 0;
  }
  return false;
}

/**
 * Parses delimited text into rows of fields.
 *
 * @example parseCsv('a,"b,c"\n1,"say ""hi"""') -> rows [["a","b,c"],["1",'say "hi"']]
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const delimiter = options.delimiter ?? sniffDelimiter(text);
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new RangeError(`Unsupported delimiter ${JSON.stringify(delimiter)}`);
  }
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const maxCols = options.maxCols ?? Number.POSITIVE_INFINITY;
  const rows: string[][] = [];
  let current: string[] = [];
  let totalRows = 0;
  let totalCols = 0;
  let droppedFields = 0;
  let fieldsInRecord = 0;
  let nonEmpty = 0;
  const unterminatedQuote = parseInto(text, delimiter, {
    field(value, index) {
      fieldsInRecord = index + 1;
      if (value !== "") nonEmpty++;
      if (totalRows < maxRows && index < maxCols) current.push(value);
      else if (value !== "") droppedFields++;
    },
    record(fields) {
      // Blank lines (one empty field) are not records.
      if (fields === 1 && nonEmpty === 0 && fieldsInRecord <= 1) {
        current = [];
        fieldsInRecord = 0;
        return true;
      }
      if (totalRows < maxRows) rows.push(current);
      totalRows++;
      totalCols = Math.max(totalCols, fields);
      current = [];
      fieldsInRecord = 0;
      nonEmpty = 0;
      return true;
    },
  });
  return { rows, delimiter, totalRows, totalCols, droppedFields, unterminatedQuote };
}
