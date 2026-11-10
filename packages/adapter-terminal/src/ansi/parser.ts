/**
 * Incremental ANSI/VT escape sequence tokenizer (ECMA-48 subset). It keeps its state between
 * `feed` calls, because recordings split escape sequences across output events.
 */

/** Receives the tokens of a byte stream decoded to text. */
export interface AnsiHandler {
  /** A run of printable characters (no C0/C1 controls, no escapes). */
  print(text: string): void;
  /** A C0 control character code (BEL, BS, HT, LF, VT, FF, CR, ...). */
  control(code: number): void;
  /** Control sequence: `ESC [ <priv><params><inter><final>`. `priv` is one of `?`, `>`, `<`, `=` or "". */
  csi(priv: string, params: string, inter: string, final: string): void;
  /** Two-character escape: `ESC <inter> <final>` (e.g. `ESC 7`, `ESC ( B`). */
  esc(inter: string, final: string): void;
  /** Operating system command payload (`ESC ] ... BEL|ST`), e.g. `0;title`. */
  osc(data: string): void;
}

/** Tokenizer states. `IGNORE` covers DCS, SOS, PM and APC, whose payload is skipped until ST. */
const GROUND = 0;
const ESCAPE = 1;
const CSI = 2;
const OSC = 3;
const IGNORE = 4;

/** Longest parameter string kept; longer sequences are dropped (hostile input guard). */
const MAX_CSI = 256;
/** Longest OSC payload kept; longer payloads are cut. */
const MAX_OSC = 4096;

const ESC = 0x1b;
const BEL = 0x07;

export class AnsiParser {
  #state = GROUND;
  #priv = "";
  #params = "";
  #inter = "";
  #osc = "";
  /** True after an ESC inside OSC/ignored strings: the next `\` ends the string (ST). */
  #stringEsc = false;
  #overflow = false;

  /** Forgets any partial sequence. */
  reset(): void {
    this.#state = GROUND;
    this.#priv = "";
    this.#params = "";
    this.#inter = "";
    this.#osc = "";
    this.#stringEsc = false;
    this.#overflow = false;
  }

  /** Tokenizes `data`, calling `h` for every complete token. */
  feed(data: string, h: AnsiHandler): void {
    let runStart = -1;
    const flush = (end: number): void => {
      if (runStart >= 0 && end > runStart) h.print(data.slice(runStart, end));
      runStart = -1;
    };
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i);
      switch (this.#state) {
        case GROUND:
          if (c === ESC) {
            flush(i);
            this.#state = ESCAPE;
            this.#inter = "";
          } else if (c < 0x20 || c === 0x7f) {
            flush(i);
            if (c !== 0x7f) h.control(c);
          } else if (c >= 0x80 && c <= 0x9f) {
            flush(i);
            this.#c1(c);
          } else if (runStart < 0) {
            runStart = i;
          }
          break;
        case ESCAPE:
          this.#escape(c, h);
          break;
        case CSI:
          this.#csi(c, h);
          break;
        case OSC:
          this.#oscChar(c, h);
          break;
        case IGNORE:
          this.#ignoreChar(c);
          break;
      }
    }
    flush(data.length);
  }

  #c1(c: number): void {
    if (c === 0x9b) this.#enterCsi();
    else if (c === 0x9d) this.#enterOsc();
    else if (c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) this.#enterIgnore();
    // Other C1 controls are dropped.
  }

  #enterCsi(): void {
    this.#state = CSI;
    this.#priv = "";
    this.#params = "";
    this.#inter = "";
    this.#overflow = false;
  }

  #enterOsc(): void {
    this.#state = OSC;
    this.#osc = "";
    this.#stringEsc = false;
  }

  #enterIgnore(): void {
    this.#state = IGNORE;
    this.#stringEsc = false;
  }

  #escape(c: number, h: AnsiHandler): void {
    const ch = String.fromCharCode(c);
    if (c === 0x5b) this.#enterCsi();
    else if (c === 0x5d) this.#enterOsc();
    else if (c === 0x50 || c === 0x58 || c === 0x5e || c === 0x5f) this.#enterIgnore();
    else if (c >= 0x20 && c <= 0x2f) {
      // Intermediate bytes (charset designation `ESC ( B`, `ESC # 8`, ...).
      if (this.#inter.length < 4) this.#inter += ch;
    } else if (c >= 0x30 && c <= 0x7e) {
      h.esc(this.#inter, ch);
      this.#state = GROUND;
    } else if (c === ESC) {
      this.#inter = "";
    } else if (c < 0x20) {
      // C0 controls execute even inside an escape sequence.
      h.control(c);
    } else {
      this.#state = GROUND;
    }
  }

  #csi(c: number, h: AnsiHandler): void {
    if (c >= 0x30 && c <= 0x3f) {
      const ch = String.fromCharCode(c);
      if (this.#params === "" && this.#priv === "" && (ch === "?" || ch === ">" || ch === "<" || ch === "=")) {
        this.#priv = ch;
      } else if (this.#inter !== "") {
        this.#overflow = true; // parameter after intermediate: malformed
      } else if (this.#params.length < MAX_CSI) {
        this.#params += ch;
      } else {
        this.#overflow = true;
      }
    } else if (c >= 0x20 && c <= 0x2f) {
      if (this.#inter.length < 4) this.#inter += String.fromCharCode(c);
      else this.#overflow = true;
    } else if (c >= 0x40 && c <= 0x7e) {
      if (!this.#overflow) h.csi(this.#priv, this.#params, this.#inter, String.fromCharCode(c));
      this.#state = GROUND;
    } else if (c === ESC) {
      this.#state = ESCAPE;
      this.#inter = "";
    } else if (c < 0x20) {
      h.control(c);
    } else {
      this.#state = GROUND;
    }
  }

  #oscChar(c: number, h: AnsiHandler): void {
    if (this.#stringEsc) {
      this.#stringEsc = false;
      if (c === 0x5c) {
        h.osc(this.#osc);
        this.#state = GROUND;
        return;
      }
      // ESC followed by something else aborts the string and starts a new escape.
      this.#state = ESCAPE;
      this.#inter = "";
      this.#escape(c, h);
      return;
    }
    if (c === BEL || c === 0x9c) {
      h.osc(this.#osc);
      this.#state = GROUND;
    } else if (c === ESC) {
      this.#stringEsc = true;
    } else if (this.#osc.length < MAX_OSC) {
      this.#osc += String.fromCharCode(c);
    }
  }

  #ignoreChar(c: number): void {
    if (this.#stringEsc) {
      this.#stringEsc = false;
      if (c === 0x5c) this.#state = GROUND;
      return;
    }
    if (c === 0x9c) this.#state = GROUND;
    else if (c === ESC) this.#stringEsc = true;
  }
}
