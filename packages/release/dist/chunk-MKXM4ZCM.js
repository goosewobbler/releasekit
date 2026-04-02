import {
  require_semver
} from "./chunk-PJO2QZSV.js";
import {
  execAsync,
  execSync
} from "./chunk-FM2YXFEQ.js";
import {
  BaseVersionError,
  ReleaseKitError,
  sanitizePackageName
} from "./chunk-HW3BIMUI.js";
import {
  __commonJS,
  __require,
  __toESM
} from "./chunk-QGM4M3NI.js";

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/constants.js"(exports, module) {
    "use strict";
    var WIN_SLASH = "\\\\/";
    var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
    var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
    var DOT_LITERAL = "\\.";
    var PLUS_LITERAL = "\\+";
    var QMARK_LITERAL = "\\?";
    var SLASH_LITERAL = "\\/";
    var ONE_CHAR = "(?=.)";
    var QMARK = "[^/]";
    var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
    var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
    var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
    var NO_DOT = `(?!${DOT_LITERAL})`;
    var NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
    var NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
    var NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
    var QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
    var STAR = `${QMARK}*?`;
    var SEP = "/";
    var POSIX_CHARS = {
      DOT_LITERAL,
      PLUS_LITERAL,
      QMARK_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      QMARK,
      END_ANCHOR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR,
      SEP
    };
    var WINDOWS_CHARS = {
      ...POSIX_CHARS,
      SLASH_LITERAL: `[${WIN_SLASH}]`,
      QMARK: WIN_NO_SLASH,
      STAR: `${WIN_NO_SLASH}*?`,
      DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
      NO_DOT: `(?!${DOT_LITERAL})`,
      NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
      NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
      START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
      END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
      SEP: "\\"
    };
    var POSIX_REGEX_SOURCE = {
      __proto__: null,
      alnum: "a-zA-Z0-9",
      alpha: "a-zA-Z",
      ascii: "\\x00-\\x7F",
      blank: " \\t",
      cntrl: "\\x00-\\x1F\\x7F",
      digit: "0-9",
      graph: "\\x21-\\x7E",
      lower: "a-z",
      print: "\\x20-\\x7E ",
      punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
      space: " \\t\\r\\n\\v\\f",
      upper: "A-Z",
      word: "A-Za-z0-9_",
      xdigit: "A-Fa-f0-9"
    };
    module.exports = {
      DEFAULT_MAX_EXTGLOB_RECURSION,
      MAX_LENGTH: 1024 * 64,
      POSIX_REGEX_SOURCE,
      // regular expressions
      REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
      REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
      REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
      REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
      REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
      REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
      // Replace globs with equivalent patterns to reduce parsing time.
      REPLACEMENTS: {
        __proto__: null,
        "***": "*",
        "**/**": "**",
        "**/**/**": "**"
      },
      // Digits
      CHAR_0: 48,
      /* 0 */
      CHAR_9: 57,
      /* 9 */
      // Alphabet chars.
      CHAR_UPPERCASE_A: 65,
      /* A */
      CHAR_LOWERCASE_A: 97,
      /* a */
      CHAR_UPPERCASE_Z: 90,
      /* Z */
      CHAR_LOWERCASE_Z: 122,
      /* z */
      CHAR_LEFT_PARENTHESES: 40,
      /* ( */
      CHAR_RIGHT_PARENTHESES: 41,
      /* ) */
      CHAR_ASTERISK: 42,
      /* * */
      // Non-alphabetic chars.
      CHAR_AMPERSAND: 38,
      /* & */
      CHAR_AT: 64,
      /* @ */
      CHAR_BACKWARD_SLASH: 92,
      /* \ */
      CHAR_CARRIAGE_RETURN: 13,
      /* \r */
      CHAR_CIRCUMFLEX_ACCENT: 94,
      /* ^ */
      CHAR_COLON: 58,
      /* : */
      CHAR_COMMA: 44,
      /* , */
      CHAR_DOT: 46,
      /* . */
      CHAR_DOUBLE_QUOTE: 34,
      /* " */
      CHAR_EQUAL: 61,
      /* = */
      CHAR_EXCLAMATION_MARK: 33,
      /* ! */
      CHAR_FORM_FEED: 12,
      /* \f */
      CHAR_FORWARD_SLASH: 47,
      /* / */
      CHAR_GRAVE_ACCENT: 96,
      /* ` */
      CHAR_HASH: 35,
      /* # */
      CHAR_HYPHEN_MINUS: 45,
      /* - */
      CHAR_LEFT_ANGLE_BRACKET: 60,
      /* < */
      CHAR_LEFT_CURLY_BRACE: 123,
      /* { */
      CHAR_LEFT_SQUARE_BRACKET: 91,
      /* [ */
      CHAR_LINE_FEED: 10,
      /* \n */
      CHAR_NO_BREAK_SPACE: 160,
      /* \u00A0 */
      CHAR_PERCENT: 37,
      /* % */
      CHAR_PLUS: 43,
      /* + */
      CHAR_QUESTION_MARK: 63,
      /* ? */
      CHAR_RIGHT_ANGLE_BRACKET: 62,
      /* > */
      CHAR_RIGHT_CURLY_BRACE: 125,
      /* } */
      CHAR_RIGHT_SQUARE_BRACKET: 93,
      /* ] */
      CHAR_SEMICOLON: 59,
      /* ; */
      CHAR_SINGLE_QUOTE: 39,
      /* ' */
      CHAR_SPACE: 32,
      /*   */
      CHAR_TAB: 9,
      /* \t */
      CHAR_UNDERSCORE: 95,
      /* _ */
      CHAR_VERTICAL_LINE: 124,
      /* | */
      CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
      /* \uFEFF */
      /**
       * Create EXTGLOB_CHARS
       */
      extglobChars(chars) {
        return {
          "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars.STAR})` },
          "?": { type: "qmark", open: "(?:", close: ")?" },
          "+": { type: "plus", open: "(?:", close: ")+" },
          "*": { type: "star", open: "(?:", close: ")*" },
          "@": { type: "at", open: "(?:", close: ")" }
        };
      },
      /**
       * Create GLOB_CHARS
       */
      globChars(win32) {
        return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
      }
    };
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/utils.js
var require_utils = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/utils.js"(exports) {
    "use strict";
    var {
      REGEX_BACKSLASH,
      REGEX_REMOVE_BACKSLASH,
      REGEX_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_GLOBAL
    } = require_constants();
    exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    exports.hasRegexChars = (str2) => REGEX_SPECIAL_CHARS.test(str2);
    exports.isRegexChar = (str2) => str2.length === 1 && exports.hasRegexChars(str2);
    exports.escapeRegex = (str2) => str2.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
    exports.toPosixSlashes = (str2) => str2.replace(REGEX_BACKSLASH, "/");
    exports.isWindows = () => {
      if (typeof navigator !== "undefined" && navigator.platform) {
        const platform = navigator.platform.toLowerCase();
        return platform === "win32" || platform === "windows";
      }
      if (typeof process !== "undefined" && process.platform) {
        return process.platform === "win32";
      }
      return false;
    };
    exports.removeBackslashes = (str2) => {
      return str2.replace(REGEX_REMOVE_BACKSLASH, (match2) => {
        return match2 === "\\" ? "" : match2;
      });
    };
    exports.escapeLast = (input, char, lastIdx) => {
      const idx = input.lastIndexOf(char, lastIdx);
      if (idx === -1) return input;
      if (input[idx - 1] === "\\") return exports.escapeLast(input, char, idx - 1);
      return `${input.slice(0, idx)}\\${input.slice(idx)}`;
    };
    exports.removePrefix = (input, state = {}) => {
      let output3 = input;
      if (output3.startsWith("./")) {
        output3 = output3.slice(2);
        state.prefix = "./";
      }
      return output3;
    };
    exports.wrapOutput = (input, state = {}, options = {}) => {
      const prepend = options.contains ? "" : "^";
      const append = options.contains ? "" : "$";
      let output3 = `${prepend}(?:${input})${append}`;
      if (state.negated === true) {
        output3 = `(?:^(?!${output3}).*$)`;
      }
      return output3;
    };
    exports.basename = (path10, { windows } = {}) => {
      const segs = path10.split(windows ? /[\\/]/ : "/");
      const last = segs[segs.length - 1];
      if (last === "") {
        return segs[segs.length - 2];
      }
      return last;
    };
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/scan.js
var require_scan = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/scan.js"(exports, module) {
    "use strict";
    var utils = require_utils();
    var {
      CHAR_ASTERISK: CHAR_ASTERISK2,
      /* * */
      CHAR_AT,
      /* @ */
      CHAR_BACKWARD_SLASH,
      /* \ */
      CHAR_COMMA: CHAR_COMMA2,
      /* , */
      CHAR_DOT,
      /* . */
      CHAR_EXCLAMATION_MARK,
      /* ! */
      CHAR_FORWARD_SLASH,
      /* / */
      CHAR_LEFT_CURLY_BRACE,
      /* { */
      CHAR_LEFT_PARENTHESES,
      /* ( */
      CHAR_LEFT_SQUARE_BRACKET: CHAR_LEFT_SQUARE_BRACKET2,
      /* [ */
      CHAR_PLUS,
      /* + */
      CHAR_QUESTION_MARK,
      /* ? */
      CHAR_RIGHT_CURLY_BRACE,
      /* } */
      CHAR_RIGHT_PARENTHESES,
      /* ) */
      CHAR_RIGHT_SQUARE_BRACKET: CHAR_RIGHT_SQUARE_BRACKET2
      /* ] */
    } = require_constants();
    var isPathSeparator = (code) => {
      return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
    };
    var depth = (token) => {
      if (token.isPrefix !== true) {
        token.depth = token.isGlobstar ? Infinity : 1;
      }
    };
    var scan = (input, options) => {
      const opts = options || {};
      const length = input.length - 1;
      const scanToEnd = opts.parts === true || opts.scanToEnd === true;
      const slashes = [];
      const tokens = [];
      const parts = [];
      let str2 = input;
      let index = -1;
      let start = 0;
      let lastIndex = 0;
      let isBrace = false;
      let isBracket = false;
      let isGlob = false;
      let isExtglob = false;
      let isGlobstar = false;
      let braceEscaped = false;
      let backslashes = false;
      let negated = false;
      let negatedExtglob = false;
      let finished = false;
      let braces = 0;
      let prev;
      let code;
      let token = { value: "", depth: 0, isGlob: false };
      const eos = () => index >= length;
      const peek = () => str2.charCodeAt(index + 1);
      const advance = () => {
        prev = code;
        return str2.charCodeAt(++index);
      };
      while (index < length) {
        code = advance();
        let next;
        if (code === CHAR_BACKWARD_SLASH) {
          backslashes = token.backslashes = true;
          code = advance();
          if (code === CHAR_LEFT_CURLY_BRACE) {
            braceEscaped = true;
          }
          continue;
        }
        if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
          braces++;
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (code === CHAR_LEFT_CURLY_BRACE) {
              braces++;
              continue;
            }
            if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (braceEscaped !== true && code === CHAR_COMMA2) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (code === CHAR_RIGHT_CURLY_BRACE) {
              braces--;
              if (braces === 0) {
                braceEscaped = false;
                isBrace = token.isBrace = true;
                finished = true;
                break;
              }
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_FORWARD_SLASH) {
          slashes.push(index);
          tokens.push(token);
          token = { value: "", depth: 0, isGlob: false };
          if (finished === true) continue;
          if (prev === CHAR_DOT && index === start + 1) {
            start += 2;
            continue;
          }
          lastIndex = index + 1;
          continue;
        }
        if (opts.noext !== true) {
          const isExtglobChar = code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK2 || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK;
          if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
            isGlob = token.isGlob = true;
            isExtglob = token.isExtglob = true;
            finished = true;
            if (code === CHAR_EXCLAMATION_MARK && index === start) {
              negatedExtglob = true;
            }
            if (scanToEnd === true) {
              while (eos() !== true && (code = advance())) {
                if (code === CHAR_BACKWARD_SLASH) {
                  backslashes = token.backslashes = true;
                  code = advance();
                  continue;
                }
                if (code === CHAR_RIGHT_PARENTHESES) {
                  isGlob = token.isGlob = true;
                  finished = true;
                  break;
                }
              }
              continue;
            }
            break;
          }
        }
        if (code === CHAR_ASTERISK2) {
          if (prev === CHAR_ASTERISK2) isGlobstar = token.isGlobstar = true;
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_QUESTION_MARK) {
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_LEFT_SQUARE_BRACKET2) {
          while (eos() !== true && (next = advance())) {
            if (next === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (next === CHAR_RIGHT_SQUARE_BRACKET2) {
              isBracket = token.isBracket = true;
              isGlob = token.isGlob = true;
              finished = true;
              break;
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
          negated = token.negated = true;
          start++;
          continue;
        }
        if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          if (scanToEnd === true) {
            while (eos() !== true && (code = advance())) {
              if (code === CHAR_LEFT_PARENTHESES) {
                backslashes = token.backslashes = true;
                code = advance();
                continue;
              }
              if (code === CHAR_RIGHT_PARENTHESES) {
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
        if (isGlob === true) {
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
      }
      if (opts.noext === true) {
        isExtglob = false;
        isGlob = false;
      }
      let base = str2;
      let prefix = "";
      let glob2 = "";
      if (start > 0) {
        prefix = str2.slice(0, start);
        str2 = str2.slice(start);
        lastIndex -= start;
      }
      if (base && isGlob === true && lastIndex > 0) {
        base = str2.slice(0, lastIndex);
        glob2 = str2.slice(lastIndex);
      } else if (isGlob === true) {
        base = "";
        glob2 = str2;
      } else {
        base = str2;
      }
      if (base && base !== "" && base !== "/" && base !== str2) {
        if (isPathSeparator(base.charCodeAt(base.length - 1))) {
          base = base.slice(0, -1);
        }
      }
      if (opts.unescape === true) {
        if (glob2) glob2 = utils.removeBackslashes(glob2);
        if (base && backslashes === true) {
          base = utils.removeBackslashes(base);
        }
      }
      const state = {
        prefix,
        input,
        start,
        base,
        glob: glob2,
        isBrace,
        isBracket,
        isGlob,
        isExtglob,
        isGlobstar,
        negated,
        negatedExtglob
      };
      if (opts.tokens === true) {
        state.maxDepth = 0;
        if (!isPathSeparator(code)) {
          tokens.push(token);
        }
        state.tokens = tokens;
      }
      if (opts.parts === true || opts.tokens === true) {
        let prevIndex;
        for (let idx = 0; idx < slashes.length; idx++) {
          const n = prevIndex ? prevIndex + 1 : start;
          const i = slashes[idx];
          const value = input.slice(n, i);
          if (opts.tokens) {
            if (idx === 0 && start !== 0) {
              tokens[idx].isPrefix = true;
              tokens[idx].value = prefix;
            } else {
              tokens[idx].value = value;
            }
            depth(tokens[idx]);
            state.maxDepth += tokens[idx].depth;
          }
          if (idx !== 0 || value !== "") {
            parts.push(value);
          }
          prevIndex = i;
        }
        if (prevIndex && prevIndex + 1 < input.length) {
          const value = input.slice(prevIndex + 1);
          parts.push(value);
          if (opts.tokens) {
            tokens[tokens.length - 1].value = value;
            depth(tokens[tokens.length - 1]);
            state.maxDepth += tokens[tokens.length - 1].depth;
          }
        }
        state.slashes = slashes;
        state.parts = parts;
      }
      return state;
    };
    module.exports = scan;
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/parse.js
var require_parse = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/parse.js"(exports, module) {
    "use strict";
    var constants = require_constants();
    var utils = require_utils();
    var {
      MAX_LENGTH,
      POSIX_REGEX_SOURCE,
      REGEX_NON_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_BACKREF,
      REPLACEMENTS
    } = constants;
    var expandRange = (args, options) => {
      if (typeof options.expandRange === "function") {
        return options.expandRange(...args, options);
      }
      args.sort();
      const value = `[${args.join("-")}]`;
      try {
        new RegExp(value);
      } catch (ex) {
        return args.map((v) => utils.escapeRegex(v)).join("..");
      }
      return value;
    };
    var syntaxError = (type2, char) => {
      return `Missing ${type2}: "${char}" - use "\\\\${char}" to match literal characters`;
    };
    var splitTopLevel = (input) => {
      const parts = [];
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let value = "";
      let escaped = false;
      for (const ch of input) {
        if (escaped === true) {
          value += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          value += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          value += ch;
          continue;
        }
        if (quote === 0) {
          if (ch === "[") {
            bracket++;
          } else if (ch === "]" && bracket > 0) {
            bracket--;
          } else if (bracket === 0) {
            if (ch === "(") {
              paren++;
            } else if (ch === ")" && paren > 0) {
              paren--;
            } else if (ch === "|" && paren === 0) {
              parts.push(value);
              value = "";
              continue;
            }
          }
        }
        value += ch;
      }
      parts.push(value);
      return parts;
    };
    var isPlainBranch = (branch) => {
      let escaped = false;
      for (const ch of branch) {
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (/[?*+@!()[\]{}]/.test(ch)) {
          return false;
        }
      }
      return true;
    };
    var normalizeSimpleBranch = (branch) => {
      let value = branch.trim();
      let changed = true;
      while (changed === true) {
        changed = false;
        if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
          value = value.slice(2, -1);
          changed = true;
        }
      }
      if (!isPlainBranch(value)) {
        return;
      }
      return value.replace(/\\(.)/g, "$1");
    };
    var hasRepeatedCharPrefixOverlap = (branches) => {
      const values = branches.map(normalizeSimpleBranch).filter(Boolean);
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = values[i];
          const b = values[j];
          const char = a[0];
          if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
            continue;
          }
          if (a === b || a.startsWith(b) || b.startsWith(a)) {
            return true;
          }
        }
      }
      return false;
    };
    var parseRepeatedExtglob = (pattern, requireEnd = true) => {
      if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
        return;
      }
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let escaped = false;
      for (let i = 1; i < pattern.length; i++) {
        const ch = pattern[i];
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          continue;
        }
        if (quote === 1) {
          continue;
        }
        if (ch === "[") {
          bracket++;
          continue;
        }
        if (ch === "]" && bracket > 0) {
          bracket--;
          continue;
        }
        if (bracket > 0) {
          continue;
        }
        if (ch === "(") {
          paren++;
          continue;
        }
        if (ch === ")") {
          paren--;
          if (paren === 0) {
            if (requireEnd === true && i !== pattern.length - 1) {
              return;
            }
            return {
              type: pattern[0],
              body: pattern.slice(2, i),
              end: i
            };
          }
        }
      }
    };
    var getStarExtglobSequenceOutput = (pattern) => {
      let index = 0;
      const chars = [];
      while (index < pattern.length) {
        const match2 = parseRepeatedExtglob(pattern.slice(index), false);
        if (!match2 || match2.type !== "*") {
          return;
        }
        const branches = splitTopLevel(match2.body).map((branch2) => branch2.trim());
        if (branches.length !== 1) {
          return;
        }
        const branch = normalizeSimpleBranch(branches[0]);
        if (!branch || branch.length !== 1) {
          return;
        }
        chars.push(branch);
        index += match2.end + 1;
      }
      if (chars.length < 1) {
        return;
      }
      const source = chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`;
      return `${source}*`;
    };
    var repeatedExtglobRecursion = (pattern) => {
      let depth = 0;
      let value = pattern.trim();
      let match2 = parseRepeatedExtglob(value);
      while (match2) {
        depth++;
        value = match2.body.trim();
        match2 = parseRepeatedExtglob(value);
      }
      return depth;
    };
    var analyzeRepeatedExtglob = (body, options) => {
      if (options.maxExtglobRecursion === false) {
        return { risky: false };
      }
      const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
      const branches = splitTopLevel(body).map((branch) => branch.trim());
      if (branches.length > 1) {
        if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
          return { risky: true };
        }
      }
      for (const branch of branches) {
        const safeOutput = getStarExtglobSequenceOutput(branch);
        if (safeOutput) {
          return { risky: true, safeOutput };
        }
        if (repeatedExtglobRecursion(branch) > max) {
          return { risky: true };
        }
      }
      return { risky: false };
    };
    var parse2 = (input, options) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected a string");
      }
      input = REPLACEMENTS[input] || input;
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      let len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      const bos = { type: "bos", value: "", output: opts.prepend || "" };
      const tokens = [bos];
      const capture = opts.capture ? "" : "?:";
      const PLATFORM_CHARS = constants.globChars(opts.windows);
      const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
      const {
        DOT_LITERAL,
        PLUS_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOT_SLASH,
        NO_DOTS_SLASH,
        QMARK,
        QMARK_NO_DOT,
        STAR,
        START_ANCHOR
      } = PLATFORM_CHARS;
      const globstar = (opts2) => {
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const nodot = opts.dot ? "" : NO_DOT;
      const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
      let star3 = opts.bash === true ? globstar(opts) : STAR;
      if (opts.capture) {
        star3 = `(${star3})`;
      }
      if (typeof opts.noext === "boolean") {
        opts.noextglob = opts.noext;
      }
      const state = {
        input,
        index: -1,
        start: 0,
        dot: opts.dot === true,
        consumed: "",
        output: "",
        prefix: "",
        backtrack: false,
        negated: false,
        brackets: 0,
        braces: 0,
        parens: 0,
        quotes: 0,
        globstar: false,
        tokens
      };
      input = utils.removePrefix(input, state);
      len = input.length;
      const extglobs = [];
      const braces = [];
      const stack = [];
      let prev = bos;
      let value;
      const eos = () => state.index === len - 1;
      const peek = state.peek = (n = 1) => input[state.index + n];
      const advance = state.advance = () => input[++state.index] || "";
      const remaining = () => input.slice(state.index + 1);
      const consume = (value2 = "", num = 0) => {
        state.consumed += value2;
        state.index += num;
      };
      const append = (token) => {
        state.output += token.output != null ? token.output : token.value;
        consume(token.value);
      };
      const negate = () => {
        let count = 1;
        while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
          advance();
          state.start++;
          count++;
        }
        if (count % 2 === 0) {
          return false;
        }
        state.negated = true;
        state.start++;
        return true;
      };
      const increment = (type2) => {
        state[type2]++;
        stack.push(type2);
      };
      const decrement = (type2) => {
        state[type2]--;
        stack.pop();
      };
      const push = (tok) => {
        if (prev.type === "globstar") {
          const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
          const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
          if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
            state.output = state.output.slice(0, -prev.output.length);
            prev.type = "star";
            prev.value = "*";
            prev.output = star3;
            state.output += prev.output;
          }
        }
        if (extglobs.length && tok.type !== "paren") {
          extglobs[extglobs.length - 1].inner += tok.value;
        }
        if (tok.value || tok.output) append(tok);
        if (prev && prev.type === "text" && tok.type === "text") {
          prev.output = (prev.output || prev.value) + tok.value;
          prev.value += tok.value;
          return;
        }
        tok.prev = prev;
        tokens.push(tok);
        prev = tok;
      };
      const extglobOpen = (type2, value2) => {
        const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
        token.prev = prev;
        token.parens = state.parens;
        token.output = state.output;
        token.startIndex = state.index;
        token.tokensIndex = tokens.length;
        const output3 = (opts.capture ? "(" : "") + token.open;
        increment("parens");
        push({ type: type2, value: value2, output: state.output ? "" : ONE_CHAR });
        push({ type: "paren", extglob: true, value: advance(), output: output3 });
        extglobs.push(token);
      };
      const extglobClose = (token) => {
        const literal = input.slice(token.startIndex, state.index + 1);
        const body = input.slice(token.startIndex + 2, state.index);
        const analysis = analyzeRepeatedExtglob(body, opts);
        if ((token.type === "plus" || token.type === "star") && analysis.risky) {
          const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
          const open = tokens[token.tokensIndex];
          open.type = "text";
          open.value = literal;
          open.output = safeOutput || utils.escapeRegex(literal);
          for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
            tokens[i].value = "";
            tokens[i].output = "";
            delete tokens[i].suffix;
          }
          state.output = token.output + open.output;
          state.backtrack = true;
          push({ type: "paren", extglob: true, value, output: "" });
          decrement("parens");
          return;
        }
        let output3 = token.close + (opts.capture ? ")" : "");
        let rest;
        if (token.type === "negate") {
          let extglobStar = star3;
          if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
            extglobStar = globstar(opts);
          }
          if (extglobStar !== star3 || eos() || /^\)+$/.test(remaining())) {
            output3 = token.close = `)$))${extglobStar}`;
          }
          if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
            const expression = parse2(rest, { ...options, fastpaths: false }).output;
            output3 = token.close = `)${expression})${extglobStar})`;
          }
          if (token.prev.type === "bos") {
            state.negatedExtglob = true;
          }
        }
        push({ type: "paren", extglob: true, value, output: output3 });
        decrement("parens");
      };
      if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
        let backslashes = false;
        let output3 = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
          if (first === "\\") {
            backslashes = true;
            return m;
          }
          if (first === "?") {
            if (esc) {
              return esc + first + (rest ? QMARK.repeat(rest.length) : "");
            }
            if (index === 0) {
              return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
            }
            return QMARK.repeat(chars.length);
          }
          if (first === ".") {
            return DOT_LITERAL.repeat(chars.length);
          }
          if (first === "*") {
            if (esc) {
              return esc + first + (rest ? star3 : "");
            }
            return star3;
          }
          return esc ? m : `\\${m}`;
        });
        if (backslashes === true) {
          if (opts.unescape === true) {
            output3 = output3.replace(/\\/g, "");
          } else {
            output3 = output3.replace(/\\+/g, (m) => {
              return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
            });
          }
        }
        if (output3 === input && opts.contains === true) {
          state.output = input;
          return state;
        }
        state.output = utils.wrapOutput(output3, state, options);
        return state;
      }
      while (!eos()) {
        value = advance();
        if (value === "\0") {
          continue;
        }
        if (value === "\\") {
          const next = peek();
          if (next === "/" && opts.bash !== true) {
            continue;
          }
          if (next === "." || next === ";") {
            continue;
          }
          if (!next) {
            value += "\\";
            push({ type: "text", value });
            continue;
          }
          const match2 = /^\\+/.exec(remaining());
          let slashes = 0;
          if (match2 && match2[0].length > 2) {
            slashes = match2[0].length;
            state.index += slashes;
            if (slashes % 2 !== 0) {
              value += "\\";
            }
          }
          if (opts.unescape === true) {
            value = advance();
          } else {
            value += advance();
          }
          if (state.brackets === 0) {
            push({ type: "text", value });
            continue;
          }
        }
        if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
          if (opts.posix !== false && value === ":") {
            const inner = prev.value.slice(1);
            if (inner.includes("[")) {
              prev.posix = true;
              if (inner.includes(":")) {
                const idx = prev.value.lastIndexOf("[");
                const pre = prev.value.slice(0, idx);
                const rest2 = prev.value.slice(idx + 2);
                const posix2 = POSIX_REGEX_SOURCE[rest2];
                if (posix2) {
                  prev.value = pre + posix2;
                  state.backtrack = true;
                  advance();
                  if (!bos.output && tokens.indexOf(prev) === 1) {
                    bos.output = ONE_CHAR;
                  }
                  continue;
                }
              }
            }
          }
          if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
            value = `\\${value}`;
          }
          if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
            value = `\\${value}`;
          }
          if (opts.posix === true && value === "!" && prev.value === "[") {
            value = "^";
          }
          prev.value += value;
          append({ value });
          continue;
        }
        if (state.quotes === 1 && value !== '"') {
          value = utils.escapeRegex(value);
          prev.value += value;
          append({ value });
          continue;
        }
        if (value === '"') {
          state.quotes = state.quotes === 1 ? 0 : 1;
          if (opts.keepQuotes === true) {
            push({ type: "text", value });
          }
          continue;
        }
        if (value === "(") {
          increment("parens");
          push({ type: "paren", value });
          continue;
        }
        if (value === ")") {
          if (state.parens === 0 && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "("));
          }
          const extglob = extglobs[extglobs.length - 1];
          if (extglob && state.parens === extglob.parens + 1) {
            extglobClose(extglobs.pop());
            continue;
          }
          push({ type: "paren", value, output: state.parens ? ")" : "\\)" });
          decrement("parens");
          continue;
        }
        if (value === "[") {
          if (opts.nobracket === true || !remaining().includes("]")) {
            if (opts.nobracket !== true && opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("closing", "]"));
            }
            value = `\\${value}`;
          } else {
            increment("brackets");
          }
          push({ type: "bracket", value });
          continue;
        }
        if (value === "]") {
          if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          if (state.brackets === 0) {
            if (opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("opening", "["));
            }
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          decrement("brackets");
          const prevValue = prev.value.slice(1);
          if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
            value = `/${value}`;
          }
          prev.value += value;
          append({ value });
          if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
            continue;
          }
          const escaped = utils.escapeRegex(prev.value);
          state.output = state.output.slice(0, -prev.value.length);
          if (opts.literalBrackets === true) {
            state.output += escaped;
            prev.value = escaped;
            continue;
          }
          prev.value = `(${capture}${escaped}|${prev.value})`;
          state.output += prev.value;
          continue;
        }
        if (value === "{" && opts.nobrace !== true) {
          increment("braces");
          const open = {
            type: "brace",
            value,
            output: "(",
            outputIndex: state.output.length,
            tokensIndex: state.tokens.length
          };
          braces.push(open);
          push(open);
          continue;
        }
        if (value === "}") {
          const brace = braces[braces.length - 1];
          if (opts.nobrace === true || !brace) {
            push({ type: "text", value, output: value });
            continue;
          }
          let output3 = ")";
          if (brace.dots === true) {
            const arr = tokens.slice();
            const range2 = [];
            for (let i = arr.length - 1; i >= 0; i--) {
              tokens.pop();
              if (arr[i].type === "brace") {
                break;
              }
              if (arr[i].type !== "dots") {
                range2.unshift(arr[i].value);
              }
            }
            output3 = expandRange(range2, opts);
            state.backtrack = true;
          }
          if (brace.comma !== true && brace.dots !== true) {
            const out = state.output.slice(0, brace.outputIndex);
            const toks = state.tokens.slice(brace.tokensIndex);
            brace.value = brace.output = "\\{";
            value = output3 = "\\}";
            state.output = out;
            for (const t of toks) {
              state.output += t.output || t.value;
            }
          }
          push({ type: "brace", value, output: output3 });
          decrement("braces");
          braces.pop();
          continue;
        }
        if (value === "|") {
          if (extglobs.length > 0) {
            extglobs[extglobs.length - 1].conditions++;
          }
          push({ type: "text", value });
          continue;
        }
        if (value === ",") {
          let output3 = value;
          const brace = braces[braces.length - 1];
          if (brace && stack[stack.length - 1] === "braces") {
            brace.comma = true;
            output3 = "|";
          }
          push({ type: "comma", value, output: output3 });
          continue;
        }
        if (value === "/") {
          if (prev.type === "dot" && state.index === state.start + 1) {
            state.start = state.index + 1;
            state.consumed = "";
            state.output = "";
            tokens.pop();
            prev = bos;
            continue;
          }
          push({ type: "slash", value, output: SLASH_LITERAL });
          continue;
        }
        if (value === ".") {
          if (state.braces > 0 && prev.type === "dot") {
            if (prev.value === ".") prev.output = DOT_LITERAL;
            const brace = braces[braces.length - 1];
            prev.type = "dots";
            prev.output += value;
            prev.value += value;
            brace.dots = true;
            continue;
          }
          if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
            push({ type: "text", value, output: DOT_LITERAL });
            continue;
          }
          push({ type: "dot", value, output: DOT_LITERAL });
          continue;
        }
        if (value === "?") {
          const isGroup = prev && prev.value === "(";
          if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("qmark", value);
            continue;
          }
          if (prev && prev.type === "paren") {
            const next = peek();
            let output3 = value;
            if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
              output3 = `\\${value}`;
            }
            push({ type: "text", value, output: output3 });
            continue;
          }
          if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
            push({ type: "qmark", value, output: QMARK_NO_DOT });
            continue;
          }
          push({ type: "qmark", value, output: QMARK });
          continue;
        }
        if (value === "!") {
          if (opts.noextglob !== true && peek() === "(") {
            if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
              extglobOpen("negate", value);
              continue;
            }
          }
          if (opts.nonegate !== true && state.index === 0) {
            negate();
            continue;
          }
        }
        if (value === "+") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("plus", value);
            continue;
          }
          if (prev && prev.value === "(" || opts.regex === false) {
            push({ type: "plus", value, output: PLUS_LITERAL });
            continue;
          }
          if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
            push({ type: "plus", value });
            continue;
          }
          push({ type: "plus", value: PLUS_LITERAL });
          continue;
        }
        if (value === "@") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            push({ type: "at", extglob: true, value, output: "" });
            continue;
          }
          push({ type: "text", value });
          continue;
        }
        if (value !== "*") {
          if (value === "$" || value === "^") {
            value = `\\${value}`;
          }
          const match2 = REGEX_NON_SPECIAL_CHARS.exec(remaining());
          if (match2) {
            value += match2[0];
            state.index += match2[0].length;
          }
          push({ type: "text", value });
          continue;
        }
        if (prev && (prev.type === "globstar" || prev.star === true)) {
          prev.type = "star";
          prev.star = true;
          prev.value += value;
          prev.output = star3;
          state.backtrack = true;
          state.globstar = true;
          consume(value);
          continue;
        }
        let rest = remaining();
        if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
          extglobOpen("star", value);
          continue;
        }
        if (prev.type === "star") {
          if (opts.noglobstar === true) {
            consume(value);
            continue;
          }
          const prior = prev.prev;
          const before = prior.prev;
          const isStart = prior.type === "slash" || prior.type === "bos";
          const afterStar = before && (before.type === "star" || before.type === "globstar");
          if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
            push({ type: "star", value, output: "" });
            continue;
          }
          const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
          const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
          if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
            push({ type: "star", value, output: "" });
            continue;
          }
          while (rest.slice(0, 3) === "/**") {
            const after = input[state.index + 4];
            if (after && after !== "/") {
              break;
            }
            rest = rest.slice(3);
            consume("/**", 3);
          }
          if (prior.type === "bos" && eos()) {
            prev.type = "globstar";
            prev.value += value;
            prev.output = globstar(opts);
            state.output = prev.output;
            state.globstar = true;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && eos()) {
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
            prev.value += value;
            state.globstar = true;
            state.output += prior.output + prev.output;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
            const end = rest[1] !== void 0 ? "|$" : "";
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
            prev.value += value;
            state.output += prior.output + prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          if (prior.type === "bos" && rest[0] === "/") {
            prev.type = "globstar";
            prev.value += value;
            prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
            state.output = prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = "globstar";
          prev.output = globstar(opts);
          prev.value += value;
          state.output += prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        const token = { type: "star", value, output: star3 };
        if (opts.bash === true) {
          token.output = ".*?";
          if (prev.type === "bos" || prev.type === "slash") {
            token.output = nodot + token.output;
          }
          push(token);
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
          token.output = value;
          push(token);
          continue;
        }
        if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
          if (prev.type === "dot") {
            state.output += NO_DOT_SLASH;
            prev.output += NO_DOT_SLASH;
          } else if (opts.dot === true) {
            state.output += NO_DOTS_SLASH;
            prev.output += NO_DOTS_SLASH;
          } else {
            state.output += nodot;
            prev.output += nodot;
          }
          if (peek() !== "*") {
            state.output += ONE_CHAR;
            prev.output += ONE_CHAR;
          }
        }
        push(token);
      }
      while (state.brackets > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
        state.output = utils.escapeLast(state.output, "[");
        decrement("brackets");
      }
      while (state.parens > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
        state.output = utils.escapeLast(state.output, "(");
        decrement("parens");
      }
      while (state.braces > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
        state.output = utils.escapeLast(state.output, "{");
        decrement("braces");
      }
      if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
        push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
      }
      if (state.backtrack === true) {
        state.output = "";
        for (const token of state.tokens) {
          state.output += token.output != null ? token.output : token.value;
          if (token.suffix) {
            state.output += token.suffix;
          }
        }
      }
      return state;
    };
    parse2.fastpaths = (input, options) => {
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      const len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      input = REPLACEMENTS[input] || input;
      const {
        DOT_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOTS,
        NO_DOTS_SLASH,
        STAR,
        START_ANCHOR
      } = constants.globChars(opts.windows);
      const nodot = opts.dot ? NO_DOTS : NO_DOT;
      const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
      const capture = opts.capture ? "" : "?:";
      const state = { negated: false, prefix: "" };
      let star3 = opts.bash === true ? ".*?" : STAR;
      if (opts.capture) {
        star3 = `(${star3})`;
      }
      const globstar = (opts2) => {
        if (opts2.noglobstar === true) return star3;
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const create = (str2) => {
        switch (str2) {
          case "*":
            return `${nodot}${ONE_CHAR}${star3}`;
          case ".*":
            return `${DOT_LITERAL}${ONE_CHAR}${star3}`;
          case "*.*":
            return `${nodot}${star3}${DOT_LITERAL}${ONE_CHAR}${star3}`;
          case "*/*":
            return `${nodot}${star3}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star3}`;
          case "**":
            return nodot + globstar(opts);
          case "**/*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star3}`;
          case "**/*.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star3}${DOT_LITERAL}${ONE_CHAR}${star3}`;
          case "**/.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star3}`;
          default: {
            const match2 = /^(.*?)\.(\w+)$/.exec(str2);
            if (!match2) return;
            const source2 = create(match2[1]);
            if (!source2) return;
            return source2 + DOT_LITERAL + match2[2];
          }
        }
      };
      const output3 = utils.removePrefix(input, state);
      let source = create(output3);
      if (source && opts.strictSlashes !== true) {
        source += `${SLASH_LITERAL}?`;
      }
      return source;
    };
    module.exports = parse2;
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/picomatch.js
var require_picomatch = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/picomatch.js"(exports, module) {
    "use strict";
    var scan = require_scan();
    var parse2 = require_parse();
    var utils = require_utils();
    var constants = require_constants();
    var isObject2 = (val) => val && typeof val === "object" && !Array.isArray(val);
    var picomatch2 = (glob2, options, returnState = false) => {
      if (Array.isArray(glob2)) {
        const fns = glob2.map((input) => picomatch2(input, options, returnState));
        const arrayMatcher = (str2) => {
          for (const isMatch of fns) {
            const state2 = isMatch(str2);
            if (state2) return state2;
          }
          return false;
        };
        return arrayMatcher;
      }
      const isState = isObject2(glob2) && glob2.tokens && glob2.input;
      if (glob2 === "" || typeof glob2 !== "string" && !isState) {
        throw new TypeError("Expected pattern to be a non-empty string");
      }
      const opts = options || {};
      const posix2 = opts.windows;
      const regex = isState ? picomatch2.compileRe(glob2, options) : picomatch2.makeRe(glob2, options, false, true);
      const state = regex.state;
      delete regex.state;
      let isIgnored = () => false;
      if (opts.ignore) {
        const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
        isIgnored = picomatch2(opts.ignore, ignoreOpts, returnState);
      }
      const matcher = (input, returnObject = false) => {
        const { isMatch, match: match2, output: output3 } = picomatch2.test(input, regex, options, { glob: glob2, posix: posix2 });
        const result = { glob: glob2, state, regex, posix: posix2, input, output: output3, match: match2, isMatch };
        if (typeof opts.onResult === "function") {
          opts.onResult(result);
        }
        if (isMatch === false) {
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (isIgnored(input)) {
          if (typeof opts.onIgnore === "function") {
            opts.onIgnore(result);
          }
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (typeof opts.onMatch === "function") {
          opts.onMatch(result);
        }
        return returnObject ? result : true;
      };
      if (returnState) {
        matcher.state = state;
      }
      return matcher;
    };
    picomatch2.test = (input, regex, options, { glob: glob2, posix: posix2 } = {}) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected input to be a string");
      }
      if (input === "") {
        return { isMatch: false, output: "" };
      }
      const opts = options || {};
      const format = opts.format || (posix2 ? utils.toPosixSlashes : null);
      let match2 = input === glob2;
      let output3 = match2 && format ? format(input) : input;
      if (match2 === false) {
        output3 = format ? format(input) : input;
        match2 = output3 === glob2;
      }
      if (match2 === false || opts.capture === true) {
        if (opts.matchBase === true || opts.basename === true) {
          match2 = picomatch2.matchBase(input, regex, options, posix2);
        } else {
          match2 = regex.exec(output3);
        }
      }
      return { isMatch: Boolean(match2), match: match2, output: output3 };
    };
    picomatch2.matchBase = (input, glob2, options) => {
      const regex = glob2 instanceof RegExp ? glob2 : picomatch2.makeRe(glob2, options);
      return regex.test(utils.basename(input));
    };
    picomatch2.isMatch = (str2, patterns, options) => picomatch2(patterns, options)(str2);
    picomatch2.parse = (pattern, options) => {
      if (Array.isArray(pattern)) return pattern.map((p) => picomatch2.parse(p, options));
      return parse2(pattern, { ...options, fastpaths: false });
    };
    picomatch2.scan = (input, options) => scan(input, options);
    picomatch2.compileRe = (state, options, returnOutput = false, returnState = false) => {
      if (returnOutput === true) {
        return state.output;
      }
      const opts = options || {};
      const prepend = opts.contains ? "" : "^";
      const append = opts.contains ? "" : "$";
      let source = `${prepend}(?:${state.output})${append}`;
      if (state && state.negated === true) {
        source = `^(?!${source}).*$`;
      }
      const regex = picomatch2.toRegex(source, options);
      if (returnState === true) {
        regex.state = state;
      }
      return regex;
    };
    picomatch2.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
      if (!input || typeof input !== "string") {
        throw new TypeError("Expected a non-empty string");
      }
      let parsed = { negated: false, fastpaths: true };
      if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
        parsed.output = parse2.fastpaths(input, options);
      }
      if (!parsed.output) {
        parsed = parse2(input, options);
      }
      return picomatch2.compileRe(parsed, options, returnOutput, returnState);
    };
    picomatch2.toRegex = (source, options) => {
      try {
        const opts = options || {};
        return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
      } catch (err) {
        if (options && options.debug === true) throw err;
        return /$^/;
      }
    };
    picomatch2.constants = constants;
    module.exports = picomatch2;
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/index.js
var require_picomatch2 = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/index.js"(exports, module) {
    "use strict";
    var pico = require_picomatch();
    var utils = require_utils();
    function picomatch2(glob2, options, returnState = false) {
      if (options && (options.windows === null || options.windows === void 0)) {
        options = { ...options, windows: utils.isWindows() };
      }
      return pico(glob2, options, returnState);
    }
    Object.assign(picomatch2, pico);
    module.exports = picomatch2;
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/unicode.js
var require_unicode = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/unicode.js"(exports, module) {
    "use strict";
    var Uni = module.exports;
    module.exports.isWhiteSpace = function isWhiteSpace(x) {
      return x === " " || x === "\xA0" || x === "\uFEFF" || x >= "	" && x <= "\r" || x === "\u1680" || x >= "\u2000" && x <= "\u200A" || x === "\u2028" || x === "\u2029" || x === "\u202F" || x === "\u205F" || x === "\u3000";
    };
    module.exports.isWhiteSpaceJSON = function isWhiteSpaceJSON(x) {
      return x === " " || x === "	" || x === "\n" || x === "\r";
    };
    module.exports.isLineTerminator = function isLineTerminator(x) {
      return x === "\n" || x === "\r" || x === "\u2028" || x === "\u2029";
    };
    module.exports.isLineTerminatorJSON = function isLineTerminatorJSON(x) {
      return x === "\n" || x === "\r";
    };
    module.exports.isIdentifierStart = function isIdentifierStart(x) {
      return x === "$" || x === "_" || x >= "A" && x <= "Z" || x >= "a" && x <= "z" || x >= "\x80" && Uni.NonAsciiIdentifierStart.test(x);
    };
    module.exports.isIdentifierPart = function isIdentifierPart(x) {
      return x === "$" || x === "_" || x >= "A" && x <= "Z" || x >= "a" && x <= "z" || x >= "0" && x <= "9" || x >= "\x80" && Uni.NonAsciiIdentifierPart.test(x);
    };
    module.exports.NonAsciiIdentifierStart = /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/;
    module.exports.NonAsciiIdentifierPart = /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/;
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/parse.js
var require_parse2 = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/parse.js"(exports, module) {
    "use strict";
    var Uni = require_unicode();
    function isHexDigit(x) {
      return x >= "0" && x <= "9" || x >= "A" && x <= "F" || x >= "a" && x <= "f";
    }
    function isOctDigit(x) {
      return x >= "0" && x <= "7";
    }
    function isDecDigit(x) {
      return x >= "0" && x <= "9";
    }
    var unescapeMap = {
      "'": "'",
      '"': '"',
      "\\": "\\",
      "b": "\b",
      "f": "\f",
      "n": "\n",
      "r": "\r",
      "t": "	",
      "v": "\v",
      "/": "/"
    };
    function formatError2(input, msg, position, lineno, column, json5) {
      var result = msg + " at " + (lineno + 1) + ":" + (column + 1), tmppos = position - column - 1, srcline = "", underline = "";
      var isLineTerminator = json5 ? Uni.isLineTerminator : Uni.isLineTerminatorJSON;
      if (tmppos < position - 70) {
        tmppos = position - 70;
      }
      while (1) {
        var chr = input[++tmppos];
        if (isLineTerminator(chr) || tmppos === input.length) {
          if (position >= tmppos) {
            underline += "^";
          }
          break;
        }
        srcline += chr;
        if (position === tmppos) {
          underline += "^";
        } else if (position > tmppos) {
          underline += input[tmppos] === "	" ? "	" : " ";
        }
        if (srcline.length > 78) break;
      }
      return result + "\n" + srcline + "\n" + underline;
    }
    function parse2(input, options) {
      var json5 = false;
      var cjson = false;
      if (options.legacy || options.mode === "json") {
      } else if (options.mode === "cjson") {
        cjson = true;
      } else if (options.mode === "json5") {
        json5 = true;
      } else {
        json5 = true;
      }
      var isLineTerminator = json5 ? Uni.isLineTerminator : Uni.isLineTerminatorJSON;
      var isWhiteSpace = json5 ? Uni.isWhiteSpace : Uni.isWhiteSpaceJSON;
      var length = input.length, lineno = 0, linestart = 0, position = 0, stack = [];
      var tokenStart = function() {
      };
      var tokenEnd = function(v) {
        return v;
      };
      if (options._tokenize) {
        ;
        (function() {
          var start = null;
          tokenStart = function() {
            if (start !== null) throw Error("internal error, token overlap");
            start = position;
          };
          tokenEnd = function(v, type2) {
            if (start != position) {
              var hash = {
                raw: input.substr(start, position - start),
                type: type2,
                stack: stack.slice(0)
              };
              if (v !== void 0) hash.value = v;
              options._tokenize.call(null, hash);
            }
            start = null;
            return v;
          };
        })();
      }
      function fail(msg) {
        var column = position - linestart;
        if (!msg) {
          if (position < length) {
            var token = "'" + JSON.stringify(input[position]).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
            if (!msg) msg = "Unexpected token " + token;
          } else {
            if (!msg) msg = "Unexpected end of input";
          }
        }
        var error = SyntaxError(formatError2(input, msg, position, lineno, column, json5));
        error.row = lineno + 1;
        error.column = column + 1;
        throw error;
      }
      function newline(chr) {
        if (chr === "\r" && input[position] === "\n") position++;
        linestart = position;
        lineno++;
      }
      function parseGeneric() {
        var result;
        while (position < length) {
          tokenStart();
          var chr = input[position++];
          if (chr === '"' || chr === "'" && json5) {
            return tokenEnd(parseString(chr), "literal");
          } else if (chr === "{") {
            tokenEnd(void 0, "separator");
            return parseObject();
          } else if (chr === "[") {
            tokenEnd(void 0, "separator");
            return parseArray();
          } else if (chr === "-" || chr === "." || isDecDigit(chr) || json5 && (chr === "+" || chr === "I" || chr === "N")) {
            return tokenEnd(parseNumber(), "literal");
          } else if (chr === "n") {
            parseKeyword("null");
            return tokenEnd(null, "literal");
          } else if (chr === "t") {
            parseKeyword("true");
            return tokenEnd(true, "literal");
          } else if (chr === "f") {
            parseKeyword("false");
            return tokenEnd(false, "literal");
          } else {
            position--;
            return tokenEnd(void 0);
          }
        }
      }
      function parseKey() {
        var result;
        while (position < length) {
          tokenStart();
          var chr = input[position++];
          if (chr === '"' || chr === "'" && json5) {
            return tokenEnd(parseString(chr), "key");
          } else if (chr === "{") {
            tokenEnd(void 0, "separator");
            return parseObject();
          } else if (chr === "[") {
            tokenEnd(void 0, "separator");
            return parseArray();
          } else if (chr === "." || isDecDigit(chr)) {
            return tokenEnd(parseNumber(true), "key");
          } else if (json5 && Uni.isIdentifierStart(chr) || chr === "\\" && input[position] === "u") {
            var rollback = position - 1;
            var result = parseIdentifier();
            if (result === void 0) {
              position = rollback;
              return tokenEnd(void 0);
            } else {
              return tokenEnd(result, "key");
            }
          } else {
            position--;
            return tokenEnd(void 0);
          }
        }
      }
      function skipWhiteSpace() {
        tokenStart();
        while (position < length) {
          var chr = input[position++];
          if (isLineTerminator(chr)) {
            position--;
            tokenEnd(void 0, "whitespace");
            tokenStart();
            position++;
            newline(chr);
            tokenEnd(void 0, "newline");
            tokenStart();
          } else if (isWhiteSpace(chr)) {
          } else if (chr === "/" && (json5 || cjson) && (input[position] === "/" || input[position] === "*")) {
            position--;
            tokenEnd(void 0, "whitespace");
            tokenStart();
            position++;
            skipComment(input[position++] === "*");
            tokenEnd(void 0, "comment");
            tokenStart();
          } else {
            position--;
            break;
          }
        }
        return tokenEnd(void 0, "whitespace");
      }
      function skipComment(multi) {
        while (position < length) {
          var chr = input[position++];
          if (isLineTerminator(chr)) {
            if (!multi) {
              position--;
              return;
            }
            newline(chr);
          } else if (chr === "*" && multi) {
            if (input[position] === "/") {
              position++;
              return;
            }
          } else {
          }
        }
        if (multi) {
          fail("Unclosed multiline comment");
        }
      }
      function parseKeyword(keyword) {
        var _pos = position;
        var len = keyword.length;
        for (var i = 1; i < len; i++) {
          if (position >= length || keyword[i] != input[position]) {
            position = _pos - 1;
            fail();
          }
          position++;
        }
      }
      function parseObject() {
        var result = options.null_prototype ? /* @__PURE__ */ Object.create(null) : {}, empty_object = {}, is_non_empty = false;
        while (position < length) {
          skipWhiteSpace();
          var item1 = parseKey();
          skipWhiteSpace();
          tokenStart();
          var chr = input[position++];
          tokenEnd(void 0, "separator");
          if (chr === "}" && item1 === void 0) {
            if (!json5 && is_non_empty) {
              position--;
              fail("Trailing comma in object");
            }
            return result;
          } else if (chr === ":" && item1 !== void 0) {
            skipWhiteSpace();
            stack.push(item1);
            var item2 = parseGeneric();
            stack.pop();
            if (item2 === void 0) fail("No value found for key " + item1);
            if (typeof item1 !== "string") {
              if (!json5 || typeof item1 !== "number") {
                fail("Wrong key type: " + item1);
              }
            }
            if ((item1 in empty_object || empty_object[item1] != null) && options.reserved_keys !== "replace") {
              if (options.reserved_keys === "throw") {
                fail("Reserved key: " + item1);
              } else {
              }
            } else {
              if (typeof options.reviver === "function") {
                item2 = options.reviver.call(null, item1, item2);
              }
              if (item2 !== void 0) {
                is_non_empty = true;
                Object.defineProperty(result, item1, {
                  value: item2,
                  enumerable: true,
                  configurable: true,
                  writable: true
                });
              }
            }
            skipWhiteSpace();
            tokenStart();
            var chr = input[position++];
            tokenEnd(void 0, "separator");
            if (chr === ",") {
              continue;
            } else if (chr === "}") {
              return result;
            } else {
              fail();
            }
          } else {
            position--;
            fail();
          }
        }
        fail();
      }
      function parseArray() {
        var result = [];
        while (position < length) {
          skipWhiteSpace();
          stack.push(result.length);
          var item = parseGeneric();
          stack.pop();
          skipWhiteSpace();
          tokenStart();
          var chr = input[position++];
          tokenEnd(void 0, "separator");
          if (item !== void 0) {
            if (typeof options.reviver === "function") {
              item = options.reviver.call(null, String(result.length), item);
            }
            if (item === void 0) {
              result.length++;
              item = true;
            } else {
              result.push(item);
            }
          }
          if (chr === ",") {
            if (item === void 0) {
              fail("Elisions are not supported");
            }
          } else if (chr === "]") {
            if (!json5 && item === void 0 && result.length) {
              position--;
              fail("Trailing comma in array");
            }
            return result;
          } else {
            position--;
            fail();
          }
        }
      }
      function parseNumber() {
        position--;
        var start = position, chr = input[position++], t;
        var to_num = function(is_octal2) {
          var str2 = input.substr(start, position - start);
          if (is_octal2) {
            var result = parseInt(str2.replace(/^0o?/, ""), 8);
          } else {
            var result = Number(str2);
          }
          if (Number.isNaN(result)) {
            position--;
            fail('Bad numeric literal - "' + input.substr(start, position - start + 1) + '"');
          } else if (!json5 && !str2.match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?(e[+-]?[0-9]+)?$/i)) {
            position--;
            fail('Non-json numeric literal - "' + input.substr(start, position - start + 1) + '"');
          } else {
            return result;
          }
        };
        if (chr === "-" || chr === "+" && json5) chr = input[position++];
        if (chr === "N" && json5) {
          parseKeyword("NaN");
          return NaN;
        }
        if (chr === "I" && json5) {
          parseKeyword("Infinity");
          return to_num();
        }
        if (chr >= "1" && chr <= "9") {
          while (position < length && isDecDigit(input[position])) position++;
          chr = input[position++];
        }
        if (chr === "0") {
          chr = input[position++];
          var is_octal = chr === "o" || chr === "O" || isOctDigit(chr);
          var is_hex = chr === "x" || chr === "X";
          if (json5 && (is_octal || is_hex)) {
            while (position < length && (is_hex ? isHexDigit : isOctDigit)(input[position])) position++;
            var sign = 1;
            if (input[start] === "-") {
              sign = -1;
              start++;
            } else if (input[start] === "+") {
              start++;
            }
            return sign * to_num(is_octal);
          }
        }
        if (chr === ".") {
          while (position < length && isDecDigit(input[position])) position++;
          chr = input[position++];
        }
        if (chr === "e" || chr === "E") {
          chr = input[position++];
          if (chr === "-" || chr === "+") position++;
          while (position < length && isDecDigit(input[position])) position++;
          chr = input[position++];
        }
        position--;
        return to_num();
      }
      function parseIdentifier() {
        position--;
        var result = "";
        while (position < length) {
          var chr = input[position++];
          if (chr === "\\" && input[position] === "u" && isHexDigit(input[position + 1]) && isHexDigit(input[position + 2]) && isHexDigit(input[position + 3]) && isHexDigit(input[position + 4])) {
            chr = String.fromCharCode(parseInt(input.substr(position + 1, 4), 16));
            position += 5;
          }
          if (result.length) {
            if (Uni.isIdentifierPart(chr)) {
              result += chr;
            } else {
              position--;
              return result;
            }
          } else {
            if (Uni.isIdentifierStart(chr)) {
              result += chr;
            } else {
              return void 0;
            }
          }
        }
        fail();
      }
      function parseString(endChar) {
        var result = "";
        while (position < length) {
          var chr = input[position++];
          if (chr === endChar) {
            return result;
          } else if (chr === "\\") {
            if (position >= length) fail();
            chr = input[position++];
            if (unescapeMap[chr] && (json5 || chr != "v" && chr != "'")) {
              result += unescapeMap[chr];
            } else if (json5 && isLineTerminator(chr)) {
              newline(chr);
            } else if (chr === "u" || chr === "x" && json5) {
              var off = chr === "u" ? 4 : 2;
              for (var i = 0; i < off; i++) {
                if (position >= length) fail();
                if (!isHexDigit(input[position])) fail("Bad escape sequence");
                position++;
              }
              result += String.fromCharCode(parseInt(input.substr(position - off, off), 16));
            } else if (json5 && isOctDigit(chr)) {
              if (chr < "4" && isOctDigit(input[position]) && isOctDigit(input[position + 1])) {
                var digits = 3;
              } else if (isOctDigit(input[position])) {
                var digits = 2;
              } else {
                var digits = 1;
              }
              position += digits - 1;
              result += String.fromCharCode(parseInt(input.substr(position - digits, digits), 8));
            } else if (json5) {
              result += chr;
            } else {
              position--;
              fail();
            }
          } else if (isLineTerminator(chr)) {
            fail();
          } else {
            if (!json5 && chr.charCodeAt(0) < 32) {
              position--;
              fail("Unexpected control character");
            }
            result += chr;
          }
        }
        fail();
      }
      skipWhiteSpace();
      var return_value = parseGeneric();
      if (return_value !== void 0 || position < length) {
        skipWhiteSpace();
        if (position >= length) {
          if (typeof options.reviver === "function") {
            return_value = options.reviver.call(null, "", return_value);
          }
          return return_value;
        } else {
          fail();
        }
      } else {
        if (position) {
          fail("No data, only a whitespace");
        } else {
          fail("No data, empty input");
        }
      }
    }
    module.exports.parse = function parseJSON(input, options) {
      if (typeof options === "function") {
        options = {
          reviver: options
        };
      }
      if (input === void 0) {
        return void 0;
      }
      if (typeof input !== "string") input = String(input);
      if (options == null) options = {};
      if (options.reserved_keys == null) options.reserved_keys = "ignore";
      if (options.reserved_keys === "throw" || options.reserved_keys === "ignore") {
        if (options.null_prototype == null) {
          options.null_prototype = true;
        }
      }
      try {
        return parse2(input, options);
      } catch (err) {
        if (err instanceof SyntaxError && err.row != null && err.column != null) {
          var old_err = err;
          err = SyntaxError(old_err.message);
          err.column = old_err.column;
          err.row = old_err.row;
        }
        throw err;
      }
    };
    module.exports.tokenize = function tokenizeJSON(input, options) {
      if (options == null) options = {};
      options._tokenize = function(smth) {
        if (options._addstack) smth.stack.unshift.apply(smth.stack, options._addstack);
        tokens.push(smth);
      };
      var tokens = [];
      tokens.data = module.exports.parse(input, options);
      return tokens;
    };
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/stringify.js
var require_stringify = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/stringify.js"(exports, module) {
    "use strict";
    var Uni = require_unicode();
    if (!(function f() {
    }).name) {
      Object.defineProperty((function() {
      }).constructor.prototype, "name", {
        get: function() {
          var name = this.toString().match(/^\s*function\s*(\S*)\s*\(/)[1];
          Object.defineProperty(this, "name", { value: name });
          return name;
        }
      });
    }
    var special_chars = {
      0: "\\0",
      // this is not an octal literal
      8: "\\b",
      9: "\\t",
      10: "\\n",
      11: "\\v",
      12: "\\f",
      13: "\\r",
      92: "\\\\"
    };
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    var escapable = /[\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/;
    function _stringify(object, options, recursiveLvl, currentKey) {
      var json5 = options.mode === "json5" || !options.mode;
      function indent(str3, add) {
        var prefix = options._prefix ? options._prefix : "";
        if (!options.indent) return prefix + str3;
        var result = "";
        var count = recursiveLvl + (add || 0);
        for (var i = 0; i < count; i++) result += options.indent;
        return prefix + result + str3 + (add ? "\n" : "");
      }
      function _stringify_key(key) {
        if (options.quote_keys) return _stringify_str(key);
        if (String(Number(key)) == key && key[0] != "-") return key;
        if (key == "") return _stringify_str(key);
        var result = "";
        for (var i = 0; i < key.length; i++) {
          if (i > 0) {
            if (!Uni.isIdentifierPart(key[i]))
              return _stringify_str(key);
          } else {
            if (!Uni.isIdentifierStart(key[i]))
              return _stringify_str(key);
          }
          var chr = key.charCodeAt(i);
          if (options.ascii) {
            if (chr < 128) {
              result += key[i];
            } else {
              result += "\\u" + ("0000" + chr.toString(16)).slice(-4);
            }
          } else {
            if (escapable.exec(key[i])) {
              result += "\\u" + ("0000" + chr.toString(16)).slice(-4);
            } else {
              result += key[i];
            }
          }
        }
        return result;
      }
      function _stringify_str(key) {
        var quote = options.quote;
        var quoteChr = quote.charCodeAt(0);
        var result = "";
        for (var i = 0; i < key.length; i++) {
          var chr = key.charCodeAt(i);
          if (chr < 16) {
            if (chr === 0 && json5) {
              result += "\\0";
            } else if (chr >= 8 && chr <= 13 && (json5 || chr !== 11)) {
              result += special_chars[chr];
            } else if (json5) {
              result += "\\x0" + chr.toString(16);
            } else {
              result += "\\u000" + chr.toString(16);
            }
          } else if (chr < 32) {
            if (json5) {
              result += "\\x" + chr.toString(16);
            } else {
              result += "\\u00" + chr.toString(16);
            }
          } else if (chr >= 32 && chr < 128) {
            if (chr === 47 && i && key[i - 1] === "<") {
              result += "\\" + key[i];
            } else if (chr === 92) {
              result += "\\\\";
            } else if (chr === quoteChr) {
              result += "\\" + quote;
            } else {
              result += key[i];
            }
          } else if (options.ascii || Uni.isLineTerminator(key[i]) || escapable.exec(key[i])) {
            if (chr < 256) {
              if (json5) {
                result += "\\x" + chr.toString(16);
              } else {
                result += "\\u00" + chr.toString(16);
              }
            } else if (chr < 4096) {
              result += "\\u0" + chr.toString(16);
            } else if (chr < 65536) {
              result += "\\u" + chr.toString(16);
            } else {
              throw Error("weird codepoint");
            }
          } else {
            result += key[i];
          }
        }
        return quote + result + quote;
      }
      function _stringify_object() {
        if (object === null) return "null";
        var result = [], len = 0, braces;
        if (Array.isArray(object)) {
          braces = "[]";
          for (var i = 0; i < object.length; i++) {
            var s = _stringify(object[i], options, recursiveLvl + 1, String(i));
            if (s === void 0) s = "null";
            len += s.length + 2;
            result.push(s + ",");
          }
        } else {
          braces = "{}";
          var fn = function(key) {
            var t = _stringify(object[key], options, recursiveLvl + 1, key);
            if (t !== void 0) {
              t = _stringify_key(key) + ":" + (options.indent ? " " : "") + t + ",";
              len += t.length + 1;
              result.push(t);
            }
          };
          if (Array.isArray(options.replacer)) {
            for (var i = 0; i < options.replacer.length; i++)
              if (hasOwnProperty.call(object, options.replacer[i]))
                fn(options.replacer[i]);
          } else {
            var keys = Object.keys(object);
            if (options.sort_keys)
              keys = keys.sort(typeof options.sort_keys === "function" ? options.sort_keys : void 0);
            keys.forEach(fn);
          }
        }
        len -= 2;
        if (options.indent && (len > options._splitMax - recursiveLvl * options.indent.length || len > options._splitMin)) {
          if (options.no_trailing_comma && result.length) {
            result[result.length - 1] = result[result.length - 1].substring(0, result[result.length - 1].length - 1);
          }
          var innerStuff = result.map(function(x) {
            return indent(x, 1);
          }).join("");
          return braces[0] + (options.indent ? "\n" : "") + innerStuff + indent(braces[1]);
        } else {
          if (result.length) {
            result[result.length - 1] = result[result.length - 1].substring(0, result[result.length - 1].length - 1);
          }
          var innerStuff = result.join(options.indent ? " " : "");
          return braces[0] + innerStuff + braces[1];
        }
      }
      function _stringify_nonobject(object2) {
        if (typeof options.replacer === "function") {
          object2 = options.replacer.call(null, currentKey, object2);
        }
        switch (typeof object2) {
          case "string":
            return _stringify_str(object2);
          case "number":
            if (object2 === 0 && 1 / object2 < 0) {
              return "-0";
            }
            if (!json5 && !Number.isFinite(object2)) {
              return "null";
            }
            return object2.toString();
          case "boolean":
            return object2.toString();
          case "undefined":
            return void 0;
          case "function":
          //        return custom_type()
          default:
            return JSON.stringify(object2);
        }
      }
      if (options._stringify_key) {
        return _stringify_key(object);
      }
      if (typeof object === "object") {
        if (object === null) return "null";
        var str2;
        if (typeof (str2 = object.toJSON5) === "function" && options.mode !== "json") {
          object = str2.call(object, currentKey);
        } else if (typeof (str2 = object.toJSON) === "function") {
          object = str2.call(object, currentKey);
        }
        if (object === null) return "null";
        if (typeof object !== "object") return _stringify_nonobject(object);
        if (object.constructor === Number || object.constructor === Boolean || object.constructor === String) {
          object = object.valueOf();
          return _stringify_nonobject(object);
        } else if (object.constructor === Date) {
          return _stringify_nonobject(object.toISOString());
        } else {
          if (typeof options.replacer === "function") {
            object = options.replacer.call(null, currentKey, object);
            if (typeof object !== "object") return _stringify_nonobject(object);
          }
          return _stringify_object(object);
        }
      } else {
        return _stringify_nonobject(object);
      }
    }
    module.exports.stringify = function stringifyJSON(object, options, _space) {
      if (typeof options === "function" || Array.isArray(options)) {
        options = {
          replacer: options
        };
      } else if (typeof options === "object" && options !== null) {
      } else {
        options = {};
      }
      if (_space != null) options.indent = _space;
      if (options.indent == null) options.indent = "	";
      if (options.quote == null) options.quote = "'";
      if (options.ascii == null) options.ascii = false;
      if (options.mode == null) options.mode = "json5";
      if (options.mode === "json" || options.mode === "cjson") {
        options.quote = '"';
        options.no_trailing_comma = true;
        options.quote_keys = true;
      }
      if (typeof options.indent === "object") {
        if (options.indent.constructor === Number || options.indent.constructor === Boolean || options.indent.constructor === String)
          options.indent = options.indent.valueOf();
      }
      if (typeof options.indent === "number") {
        if (options.indent >= 0) {
          options.indent = Array(Math.min(~~options.indent, 10) + 1).join(" ");
        } else {
          options.indent = false;
        }
      } else if (typeof options.indent === "string") {
        options.indent = options.indent.substr(0, 10);
      }
      if (options._splitMin == null) options._splitMin = 50;
      if (options._splitMax == null) options._splitMax = 70;
      return _stringify(object, options, 0, "");
    };
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/analyze.js
var require_analyze = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/analyze.js"(exports, module) {
    "use strict";
    var tokenize = require_parse2().tokenize;
    module.exports.analyze = function analyzeJSON(input, options) {
      if (options == null) options = {};
      if (!Array.isArray(input)) {
        input = tokenize(input, options);
      }
      var result = {
        has_whitespace: false,
        has_comments: false,
        has_newlines: false,
        has_trailing_comma: false,
        indent: "",
        newline: "\n",
        quote: '"',
        quote_keys: true
      };
      var stats = {
        indent: {},
        newline: {},
        quote: {}
      };
      for (var i = 0; i < input.length; i++) {
        if (input[i].type === "newline") {
          if (input[i + 1] && input[i + 1].type === "whitespace") {
            if (input[i + 1].raw[0] === "	") {
              stats.indent["	"] = (stats.indent["	"] || 0) + 1;
            }
            if (input[i + 1].raw.match(/^\x20+$/)) {
              var ws_len = input[i + 1].raw.length;
              var indent_len = input[i + 1].stack.length + 1;
              if (ws_len % indent_len === 0) {
                var t = Array(ws_len / indent_len + 1).join(" ");
                stats.indent[t] = (stats.indent[t] || 0) + 1;
              }
            }
          }
          stats.newline[input[i].raw] = (stats.newline[input[i].raw] || 0) + 1;
        }
        if (input[i].type === "newline") {
          result.has_newlines = true;
        }
        if (input[i].type === "whitespace") {
          result.has_whitespace = true;
        }
        if (input[i].type === "comment") {
          result.has_comments = true;
        }
        if (input[i].type === "key") {
          if (input[i].raw[0] !== '"' && input[i].raw[0] !== "'") result.quote_keys = false;
        }
        if (input[i].type === "key" || input[i].type === "literal") {
          if (input[i].raw[0] === '"' || input[i].raw[0] === "'") {
            stats.quote[input[i].raw[0]] = (stats.quote[input[i].raw[0]] || 0) + 1;
          }
        }
        if (input[i].type === "separator" && input[i].raw === ",") {
          for (var j = i + 1; j < input.length; j++) {
            if (input[j].type === "literal" || input[j].type === "key") break;
            if (input[j].type === "separator") result.has_trailing_comma = true;
          }
        }
      }
      for (var k in stats) {
        if (Object.keys(stats[k]).length) {
          result[k] = Object.keys(stats[k]).reduce(function(a, b) {
            return stats[k][a] > stats[k][b] ? a : b;
          });
        }
      }
      return result;
    };
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/document.js
var require_document = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/document.js"(exports, module) {
    "use strict";
    var assert = __require("assert");
    var tokenize = require_parse2().tokenize;
    var stringify2 = require_stringify().stringify;
    var analyze = require_analyze().analyze;
    function isObject2(x) {
      return typeof x === "object" && x !== null;
    }
    function value_to_tokenlist(value, stack, options, is_key, indent) {
      options = Object.create(options);
      options._stringify_key = !!is_key;
      if (indent) {
        options._prefix = indent.prefix.map(function(x) {
          return x.raw;
        }).join("");
      }
      if (options._splitMin == null) options._splitMin = 0;
      if (options._splitMax == null) options._splitMax = 0;
      var stringified = stringify2(value, options);
      if (is_key) {
        return [{ raw: stringified, type: "key", stack, value }];
      }
      options._addstack = stack;
      var result = tokenize(stringified, {
        _addstack: stack
      });
      result.data = null;
      return result;
    }
    function arg_to_path(path10) {
      if (typeof path10 === "number") path10 = String(path10);
      if (path10 === "") path10 = [];
      if (typeof path10 === "string") path10 = path10.split(".");
      if (!Array.isArray(path10)) throw Error("Invalid path type, string or array expected");
      return path10;
    }
    function find_element_in_tokenlist(element, lvl, tokens, begin, end) {
      while (tokens[begin].stack[lvl] != element) {
        if (begin++ >= end) return false;
      }
      while (tokens[end].stack[lvl] != element) {
        if (end-- < begin) return false;
      }
      return [begin, end];
    }
    function is_whitespace(token_type) {
      return token_type === "whitespace" || token_type === "newline" || token_type === "comment";
    }
    function find_first_non_ws_token(tokens, begin, end) {
      while (is_whitespace(tokens[begin].type)) {
        if (begin++ >= end) return false;
      }
      return begin;
    }
    function find_last_non_ws_token(tokens, begin, end) {
      while (is_whitespace(tokens[end].type)) {
        if (end-- < begin) return false;
      }
      return end;
    }
    function detect_indent_style(tokens, is_array, begin, end, level) {
      var result = {
        sep1: [],
        sep2: [],
        suffix: [],
        prefix: [],
        newline: []
      };
      if (tokens[end].type === "separator" && tokens[end].stack.length !== level + 1 && tokens[end].raw !== ",") {
        return result;
      }
      if (tokens[end].type === "separator")
        end = find_last_non_ws_token(tokens, begin, end - 1);
      if (end === false) return result;
      while (tokens[end].stack.length > level) end--;
      if (!is_array) {
        while (is_whitespace(tokens[end].type)) {
          if (end < begin) return result;
          if (tokens[end].type === "whitespace") {
            result.sep2.unshift(tokens[end]);
          } else {
            return result;
          }
          end--;
        }
        assert.equal(tokens[end].type, "separator");
        assert.equal(tokens[end].raw, ":");
        while (is_whitespace(tokens[--end].type)) {
          if (end < begin) return result;
          if (tokens[end].type === "whitespace") {
            result.sep1.unshift(tokens[end]);
          } else {
            return result;
          }
        }
        assert.equal(tokens[end].type, "key");
        end--;
      }
      while (is_whitespace(tokens[end].type)) {
        if (end < begin) return result;
        if (tokens[end].type === "whitespace") {
          result.prefix.unshift(tokens[end]);
        } else if (tokens[end].type === "newline") {
          result.newline.unshift(tokens[end]);
          return result;
        } else {
          return result;
        }
        end--;
      }
      return result;
    }
    function Document(text, options) {
      var self = Object.create(Document.prototype);
      if (options == null) options = {};
      var tokens = self._tokens = tokenize(text, options);
      self._data = tokens.data;
      tokens.data = null;
      self._options = options;
      var stats = analyze(text, options);
      if (options.indent == null) {
        options.indent = stats.indent;
      }
      if (options.quote == null) {
        options.quote = stats.quote;
      }
      if (options.quote_keys == null) {
        options.quote_keys = stats.quote_keys;
      }
      if (options.no_trailing_comma == null) {
        options.no_trailing_comma = !stats.has_trailing_comma;
      }
      return self;
    }
    function check_if_can_be_placed(key, object, is_unset) {
      function error(add) {
        return Error("You can't " + (is_unset ? "unset" : "set") + " key '" + key + "'" + add);
      }
      if (!isObject2(object)) {
        throw error(" of an non-object");
      }
      if (Array.isArray(object)) {
        if (String(key).match(/^\d+$/)) {
          key = Number(String(key));
          if (object.length < key || is_unset && object.length === key) {
            throw error(", out of bounds");
          } else if (is_unset && object.length !== key + 1) {
            throw error(" in the middle of an array");
          } else {
            return true;
          }
        } else {
          throw error(" of an array");
        }
      } else {
        return true;
      }
    }
    Document.prototype.set = function(path10, value) {
      path10 = arg_to_path(path10);
      if (path10.length === 0) {
        if (value === void 0) throw Error("can't remove root document");
        this._data = value;
        var new_key = false;
      } else {
        var data = this._data;
        for (var i = 0; i < path10.length - 1; i++) {
          check_if_can_be_placed(path10[i], data, false);
          data = data[path10[i]];
        }
        if (i === path10.length - 1) {
          check_if_can_be_placed(path10[i], data, value === void 0);
        }
        var new_key = !(path10[i] in data);
        if (value === void 0) {
          if (Array.isArray(data)) {
            data.pop();
          } else {
            delete data[path10[i]];
          }
        } else {
          data[path10[i]] = value;
        }
      }
      if (!this._tokens.length)
        this._tokens = [{ raw: "", type: "literal", stack: [], value: void 0 }];
      var position = [
        find_first_non_ws_token(this._tokens, 0, this._tokens.length - 1),
        find_last_non_ws_token(this._tokens, 0, this._tokens.length - 1)
      ];
      for (var i = 0; i < path10.length - 1; i++) {
        position = find_element_in_tokenlist(path10[i], i, this._tokens, position[0], position[1]);
        if (position == false) throw Error("internal error, please report this");
      }
      if (path10.length === 0) {
        var newtokens = value_to_tokenlist(value, path10, this._options);
      } else if (!new_key) {
        var pos_old = position;
        position = find_element_in_tokenlist(path10[i], i, this._tokens, position[0], position[1]);
        if (value === void 0 && position !== false) {
          var newtokens = [];
          if (!Array.isArray(data)) {
            var pos2 = find_last_non_ws_token(this._tokens, pos_old[0], position[0] - 1);
            assert.equal(this._tokens[pos2].type, "separator");
            assert.equal(this._tokens[pos2].raw, ":");
            position[0] = pos2;
            var pos2 = find_last_non_ws_token(this._tokens, pos_old[0], position[0] - 1);
            assert.equal(this._tokens[pos2].type, "key");
            assert.equal(this._tokens[pos2].value, path10[path10.length - 1]);
            position[0] = pos2;
          }
          var pos2 = find_last_non_ws_token(this._tokens, pos_old[0], position[0] - 1);
          assert.equal(this._tokens[pos2].type, "separator");
          if (this._tokens[pos2].raw === ",") {
            position[0] = pos2;
          } else {
            pos2 = find_first_non_ws_token(this._tokens, position[1] + 1, pos_old[1]);
            assert.equal(this._tokens[pos2].type, "separator");
            if (this._tokens[pos2].raw === ",") {
              position[1] = pos2;
            }
          }
        } else {
          var indent = pos2 !== false ? detect_indent_style(this._tokens, Array.isArray(data), pos_old[0], position[1] - 1, i) : {};
          var newtokens = value_to_tokenlist(value, path10, this._options, false, indent);
        }
      } else {
        var path_1 = path10.slice(0, i);
        var pos2 = find_last_non_ws_token(this._tokens, position[0] + 1, position[1] - 1);
        assert(pos2 !== false);
        var indent = pos2 !== false ? detect_indent_style(this._tokens, Array.isArray(data), position[0] + 1, pos2, i) : {};
        var newtokens = value_to_tokenlist(value, path10, this._options, false, indent);
        var prefix = [];
        if (indent.newline && indent.newline.length)
          prefix = prefix.concat(indent.newline);
        if (indent.prefix && indent.prefix.length)
          prefix = prefix.concat(indent.prefix);
        if (!Array.isArray(data)) {
          prefix = prefix.concat(value_to_tokenlist(path10[path10.length - 1], path_1, this._options, true));
          if (indent.sep1 && indent.sep1.length)
            prefix = prefix.concat(indent.sep1);
          prefix.push({ raw: ":", type: "separator", stack: path_1 });
          if (indent.sep2 && indent.sep2.length)
            prefix = prefix.concat(indent.sep2);
        }
        newtokens.unshift.apply(newtokens, prefix);
        if (this._tokens[pos2].type === "separator" && this._tokens[pos2].stack.length === path10.length - 1) {
          if (this._tokens[pos2].raw === ",") {
            newtokens.push({ raw: ",", type: "separator", stack: path_1 });
          }
        } else {
          newtokens.unshift({ raw: ",", type: "separator", stack: path_1 });
        }
        if (indent.suffix && indent.suffix.length)
          newtokens.push.apply(newtokens, indent.suffix);
        assert.equal(this._tokens[position[1]].type, "separator");
        position[0] = pos2 + 1;
        position[1] = pos2;
      }
      newtokens.unshift(position[1] - position[0] + 1);
      newtokens.unshift(position[0]);
      this._tokens.splice.apply(this._tokens, newtokens);
      return this;
    };
    Document.prototype.unset = function(path10) {
      return this.set(path10, void 0);
    };
    Document.prototype.get = function(path10) {
      path10 = arg_to_path(path10);
      var data = this._data;
      for (var i = 0; i < path10.length; i++) {
        if (!isObject2(data)) return void 0;
        data = data[path10[i]];
      }
      return data;
    };
    Document.prototype.has = function(path10) {
      path10 = arg_to_path(path10);
      var data = this._data;
      for (var i = 0; i < path10.length; i++) {
        if (!isObject2(data)) return false;
        data = data[path10[i]];
      }
      return data !== void 0;
    };
    Document.prototype.update = function(value) {
      var self = this;
      change([], self._data, value);
      return self;
      function change(path10, old_data, new_data) {
        if (!isObject2(new_data) || !isObject2(old_data)) {
          if (new_data !== old_data)
            self.set(path10, new_data);
        } else if (Array.isArray(new_data) != Array.isArray(old_data)) {
          self.set(path10, new_data);
        } else if (Array.isArray(new_data)) {
          if (new_data.length > old_data.length) {
            for (var i = 0; i < new_data.length; i++) {
              path10.push(String(i));
              change(path10, old_data[i], new_data[i]);
              path10.pop();
            }
          } else {
            for (var i = old_data.length - 1; i >= 0; i--) {
              path10.push(String(i));
              change(path10, old_data[i], new_data[i]);
              path10.pop();
            }
          }
        } else {
          for (var i in new_data) {
            path10.push(String(i));
            change(path10, old_data[i], new_data[i]);
            path10.pop();
          }
          for (var i in old_data) {
            if (i in new_data) continue;
            path10.push(String(i));
            change(path10, old_data[i], new_data[i]);
            path10.pop();
          }
        }
      }
    };
    Document.prototype.toString = function() {
      return this._tokens.map(function(x) {
        return x.raw;
      }).join("");
    };
    module.exports.Document = Document;
    module.exports.update = function updateJSON(source, new_value, options) {
      return Document(source, options).update(new_value).toString();
    };
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/utils.js
var require_utils2 = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/lib/utils.js"(exports, module) {
    "use strict";
    var FS = __require("fs");
    var jju2 = require_jju();
    module.exports.register = function() {
      var r = __require, e = "extensions";
      r[e][".json5"] = function(m, f) {
        m.exports = jju2.parse(FS.readFileSync(f, "utf8"));
      };
    };
    module.exports.patch_JSON_parse = function() {
      var _parse = JSON.parse;
      JSON.parse = function(text, rev) {
        try {
          return _parse(text, rev);
        } catch (err) {
          require_jju().parse(text, {
            mode: "json",
            legacy: true,
            reviver: rev,
            reserved_keys: "replace",
            null_prototype: false
          });
          throw err;
        }
      };
    };
    module.exports.middleware = function() {
      return function(req, res, next) {
        throw Error("this function is removed, use express-json5 instead");
      };
    };
  }
});

// ../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/index.js
var require_jju = __commonJS({
  "../../node_modules/.pnpm/jju@1.4.0/node_modules/jju/index.js"(exports, module) {
    "use strict";
    module.exports.__defineGetter__("parse", function() {
      return require_parse2().parse;
    });
    module.exports.__defineGetter__("stringify", function() {
      return require_stringify().stringify;
    });
    module.exports.__defineGetter__("tokenize", function() {
      return require_parse2().tokenize;
    });
    module.exports.__defineGetter__("update", function() {
      return require_document().update;
    });
    module.exports.__defineGetter__("analyze", function() {
      return require_analyze().analyze;
    });
    module.exports.__defineGetter__("utils", function() {
      return require_utils2();
    });
  }
});

// ../version/dist/chunk-UBCKZYTO.js
import * as fs4 from "fs";
import * as path8 from "path";
import * as TOML from "smol-toml";
import * as fs32 from "fs";
import * as path32 from "path";
import { z as z2 } from "zod";
import { z } from "zod";
import * as fs22 from "fs";
import * as os from "os";
import * as path22 from "path";
import fs42 from "fs";
import { cwd } from "process";

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.5.1_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/utils.js
function formatArgs(...args) {
  return args.reduce((finalArgs, arg) => {
    if (arg) {
      finalArgs.push(String(arg));
    }
    return finalArgs;
  }, []);
}
function toArray(value) {
  return Array.isArray(value) ? value : [value];
}

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.5.1_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/GitClient.js
import { spawn } from "child_process";

// ../../node_modules/.pnpm/@simple-libs+stream-utils@1.1.0/node_modules/@simple-libs/stream-utils/dist/index.js
async function toArray2(iterable) {
  const result = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}
async function concatBufferStream(iterable) {
  return Buffer.concat(await toArray2(iterable));
}
async function firstFromStream(stream) {
  for await (const tag of stream) {
    return tag;
  }
  return null;
}
async function* splitStream(stream, separator) {
  let chunk;
  let payload;
  let buffer = "";
  for await (chunk of stream) {
    buffer += chunk.toString();
    if (buffer.includes(separator)) {
      payload = buffer.split(separator);
      buffer = payload.pop() || "";
      yield* payload;
    }
  }
  if (buffer) {
    yield buffer;
  }
}

// ../../node_modules/.pnpm/@simple-libs+child-process-utils@1.0.1/node_modules/@simple-libs/child-process-utils/dist/index.js
async function exitCode(process2) {
  if (process2.exitCode !== null) {
    return process2.exitCode;
  }
  return new Promise((resolve4) => process2.once("close", resolve4));
}
async function catchProcessError(process2) {
  let error = new Error("Process exited with non-zero code");
  let stderr = "";
  process2.on("error", (err) => {
    error = err;
  });
  if (process2.stderr) {
    let chunk;
    for await (chunk of process2.stderr) {
      stderr += chunk.toString();
    }
  }
  const code = await exitCode(process2);
  if (stderr) {
    error = new Error(stderr);
  }
  return code ? error : null;
}
async function* outputStream(process2) {
  const { stdout } = process2;
  const errorPromise = catchProcessError(process2);
  if (stdout) {
    stdout.on("error", (err) => {
      if (err.name === "AbortError" && process2.exitCode === null) {
        process2.kill("SIGKILL");
      }
    });
    yield* stdout;
  }
  const error = await errorPromise;
  if (error) {
    throw error;
  }
}
function output(process2) {
  return concatBufferStream(outputStream(process2));
}

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.5.1_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/GitClient.js
var SCISSOR = "------------------------ >8 ------------------------";
var GitClient = class {
  cwd;
  debug;
  constructor(cwd3, debug) {
    this.cwd = cwd3;
    this.debug = debug;
  }
  formatArgs(...args) {
    const finalArgs = formatArgs(...args);
    if (this.debug) {
      this.debug(finalArgs);
    }
    return finalArgs;
  }
  /**
   * Raw exec method to run git commands.
   * @param args
   * @returns Stdout string output of the command.
   */
  async exec(...args) {
    return (await output(spawn("git", this.formatArgs(...args), {
      cwd: this.cwd
    }))).toString().trim();
  }
  /**
   * Raw exec method to run git commands with stream output.
   * @param args
   * @returns Stdout stream of the command.
   */
  execStream(...args) {
    return outputStream(spawn("git", this.formatArgs(...args), {
      cwd: this.cwd
    }));
  }
  /**
   * Initialize a new git repository.
   * @returns Boolean result.
   */
  async init() {
    try {
      await this.exec("init");
      return true;
    } catch (err) {
      return false;
    }
  }
  /**
   * Get raw commits stream.
   * @param params
   * @param params.path - Read commits from specific path.
   * @param params.from - Start commits range.
   * @param params.to - End commits range.
   * @param params.format - Commits format.
   * @yields Raw commits data.
   */
  async *getRawCommits(params = {}) {
    const { path: path10, from = "", to = "HEAD", format = "%B", ignore, reverse, merges, since } = params;
    const shouldNotIgnore = ignore ? (chunk2) => !ignore.test(chunk2) : () => true;
    const stdout = this.execStream("log", `--format=${format}%n${SCISSOR}`, since && `--since=${since instanceof Date ? since.toISOString() : since}`, reverse && "--reverse", merges && "--merges", merges === false && "--no-merges", [from, to].filter(Boolean).join(".."), ...path10 ? ["--", ...toArray(path10)] : []);
    const commitsStream = splitStream(stdout, `${SCISSOR}
`);
    let chunk;
    for await (chunk of commitsStream) {
      if (shouldNotIgnore(chunk)) {
        yield chunk;
      }
    }
  }
  /**
   * Get tags stream.
   * @param params
   * @yields Tags
   */
  async *getTags(params = {}) {
    const { path: path10, from = "", to = "HEAD", since } = params;
    const tagRegex = /tag:\s*(.+?)[,)]/gi;
    const stdout = this.execStream("log", "--decorate", "--no-color", "--date-order", since && `--since=${since instanceof Date ? since.toISOString() : since}`, [from, to].filter(Boolean).join(".."), ...path10 ? ["--", ...toArray(path10)] : []);
    let chunk;
    let matches;
    let tag;
    for await (chunk of stdout) {
      matches = chunk.toString().trim().matchAll(tagRegex);
      for ([, tag] of matches) {
        yield tag;
      }
    }
  }
  /**
   * Get last tag.
   * @param params
   * @returns Last tag, `null` if not found.
   */
  async getLastTag(params) {
    return firstFromStream(this.getTags(params));
  }
  /**
   * Check file is ignored via .gitignore.
   * @param file - Path to target file.
   * @returns Boolean value.
   */
  async checkIgnore(file) {
    try {
      await this.exec("check-ignore", "--", file);
      return true;
    } catch (err) {
      return false;
    }
  }
  /**
   * Add files to git index.
   * @param files - Files to stage.
   */
  async add(files) {
    await this.exec("add", "--", ...toArray(files));
  }
  /**
   * Commit changes.
   * @param params
   * @param params.verify
   * @param params.sign
   * @param params.files
   * @param params.allowEmpty
   * @param params.message
   */
  async commit(params) {
    const { verify = true, sign = false, files = [], allowEmpty = false, message } = params;
    await this.exec("commit", !verify && "--no-verify", sign && "-S", allowEmpty && "--allow-empty", "-m", message, "--", ...files);
  }
  /**
   * Create a tag for the current commit.
   * @param params
   * @param params.sign
   * @param params.name
   * @param params.message
   */
  async tag(params) {
    let { sign = false, name, message } = params;
    if (sign) {
      message = "";
    }
    await this.exec("tag", sign && "-s", message && "-a", ...message ? ["-m", message] : [], "--", name);
  }
  /**
   * Get current branch name.
   * @returns Current branch name.
   */
  async getCurrentBranch() {
    const branch = await this.exec("rev-parse", "--abbrev-ref", "HEAD");
    return branch;
  }
  /**
   * Get default branch name.
   * @returns Default branch name.
   */
  async getDefaultBranch() {
    const branch = (await this.exec("rev-parse", "--abbrev-ref", "origin/HEAD")).replace(/^origin\//, "");
    return branch;
  }
  /**
   * Push changes to remote.
   * @param branch
   * @param params
   * @param params.verify
   */
  async push(branch, params = {}) {
    const { verify = true, tags = false, followTags = false, force = false } = params;
    await this.exec("push", followTags && "--follow-tags", tags && "--tags", !verify && "--no-verify", force && "--force", "origin", "--", branch);
  }
  /**
   * Verify rev exists.
   * @param rev
   * @param safe - If `true`, will not throw error if rev not found.
   * @returns Target hash.
   */
  async verify(rev, safe) {
    let git = this.exec("rev-parse", "--verify", rev);
    if (safe) {
      git = git.catch(() => "");
    }
    return await git;
  }
  /**
   * Get config value by key.
   * @param key - Config key.
   * @returns Config value.
   */
  async getConfig(key) {
    return await this.exec("config", "--get", "--", key);
  }
  /**
   * Set config value by key.
   * @param key - Config key.
   * @param value - Config value.
   */
  async setConfig(key, value) {
    await this.exec("config", "--", key, value);
  }
  /**
   * Fetch changes from remote.
   * @param params
   */
  async fetch(params = {}) {
    const { prune = false, unshallow = false, tags = false, all = false, remote, branch } = params;
    await this.exec("fetch", prune && "--prune", unshallow && "--unshallow", tags && "--tags", all && "--all", ...remote && branch ? [
      "--",
      remote,
      branch
    ] : []);
  }
  /**
   * Create a new branch.
   * @param branch - Branch name.
   */
  async createBranch(branch) {
    await this.exec("checkout", "-b", branch);
  }
  /**
   * Delete a branch.
   * @param branch - Branch name.
   */
  async deleteBranch(branch) {
    await this.exec("branch", "-D", "--", branch);
  }
  /**
   * Checkout a branch.
   * @param branch - Branch name.
   */
  async checkout(branch) {
    await this.exec("checkout", branch);
  }
};

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.5.1_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/ConventionalGitClient.js
var import_semver = __toESM(require_semver(), 1);
var ConventionalGitClient = class extends GitClient {
  deps = null;
  loadDeps() {
    if (this.deps) {
      return this.deps;
    }
    this.deps = Promise.all([
      import("./dist-WN32E32Z.js").then(({ parseCommits }) => parseCommits),
      import("./dist-J7662OKQ.js").then(({ filterRevertedCommits }) => filterRevertedCommits)
    ]);
    return this.deps;
  }
  /**
   * Get parsed commits stream.
   * @param params
   * @param params.path - Read commits from specific path.
   * @param params.from - Start commits range.
   * @param params.to - End commits range.
   * @param params.format - Commits format.
   * @param parserOptions - Commit parser options.
   * @yields Raw commits data.
   */
  async *getCommits(params = {}, parserOptions = {}) {
    const { filterReverts, ...gitLogParams } = params;
    const [parseCommits, filterRevertedCommits] = await this.loadDeps();
    if (filterReverts) {
      yield* filterRevertedCommits(this.getCommits(gitLogParams, parserOptions));
      return;
    }
    const parse2 = parseCommits(parserOptions);
    const commitsStream = this.getRawCommits(gitLogParams);
    yield* parse2(commitsStream);
  }
  /**
   * Get semver tags stream.
   * @param params
   * @param params.prefix - Get semver tags with specific prefix.
   * @param params.skipUnstable - Skip semver tags with unstable versions.
   * @param params.clean - Clean version from prefix and trash.
   * @yields Semver tags.
   */
  async *getSemverTags(params = {}) {
    const { prefix, skipUnstable, clean } = params;
    const tagsStream = this.getTags();
    const unstableTagRegex = /\d+\.\d+\.\d+-.+/;
    const cleanTag = clean ? (tag2, unprefixed2) => import_semver.default.clean(unprefixed2 || tag2) : (tag2) => tag2;
    let unprefixed;
    let tag;
    for await (tag of tagsStream) {
      if (skipUnstable && unstableTagRegex.test(tag)) {
        continue;
      }
      if (prefix) {
        const isPrefixed = typeof prefix === "string" ? tag.startsWith(prefix) : prefix.test(tag);
        if (isPrefixed) {
          unprefixed = tag.replace(prefix, "");
          if (import_semver.default.valid(unprefixed)) {
            tag = cleanTag(tag, unprefixed);
            if (tag) {
              yield tag;
            }
          }
        }
      } else if (import_semver.default.valid(tag)) {
        tag = cleanTag(tag);
        if (tag) {
          yield tag;
        }
      }
    }
  }
  /**
   * Get last semver tag.
   * @param params - getSemverTags params.
   * @returns Last semver tag, `null` if not found.
   */
  async getLastSemverTag(params = {}) {
    return firstFromStream(this.getSemverTags(params));
  }
  /**
   * Get current sematic version from git tags.
   * @param params - Additional git params.
   * @returns Current sematic version, `null` if not found.
   */
  async getVersionFromTags(params = {}) {
    const semverTagsStream = this.getSemverTags({
      clean: true,
      ...params
    });
    const semverTags = [];
    for await (const tag of semverTagsStream) {
      semverTags.push(tag);
    }
    if (!semverTags.length) {
      return null;
    }
    return semverTags.sort(import_semver.default.rcompare)[0] || null;
  }
};

// ../../node_modules/.pnpm/conventional-changelog-preset-loader@5.0.0/node_modules/conventional-changelog-preset-loader/dist/presetLoader.js
import path from "path";
function resolvePresetNameVariants(preset) {
  if (path.isAbsolute(preset)) {
    return [preset];
  }
  let scope = "";
  let name = preset.toLocaleLowerCase();
  if (preset.startsWith("@")) {
    const parts = preset.split("/");
    scope = `${parts.shift()}/`;
    if (scope === "@conventional-changelog/") {
      return [preset];
    }
    name = parts.join("/");
  }
  if (!name.startsWith("conventional-changelog-")) {
    name = `conventional-changelog-${name}`;
  }
  const altPreset = `${scope}${name}`;
  if (altPreset !== preset) {
    return [altPreset, preset];
  }
  return [preset];
}
function getModuleDefaultExport(module) {
  if (("__esModule" in module || Object.getPrototypeOf(module) === null) && "default" in module) {
    return module.default;
  }
  return module;
}
async function loadWithFallbacks(moduleLoader, variants) {
  let error = null;
  for (const variant of variants) {
    try {
      return getModuleDefaultExport(await moduleLoader(variant));
    } catch (err) {
      if (!error) {
        error = err;
      }
    }
  }
  throw error;
}
function createPresetLoader(moduleLoader) {
  return async function loadPreset2(presetOrParams) {
    let preset = "";
    let params = null;
    if (typeof presetOrParams === "string") {
      preset = presetOrParams;
    } else if (typeof presetOrParams === "object" && typeof presetOrParams.name === "string") {
      preset = presetOrParams.name;
      params = presetOrParams;
    } else {
      throw Error("Preset must be string or object with property `name`");
    }
    const presetNameVariants = resolvePresetNameVariants(preset);
    let createPreset = null;
    try {
      createPreset = await loadWithFallbacks(moduleLoader, presetNameVariants);
    } catch (err) {
      throw new Error(`Unable to load the "${preset}" preset. Please make sure it's installed.`, {
        cause: err
      });
    }
    if (typeof createPreset !== "function") {
      throw new Error(`The "${preset}" preset does not export a function. Maybe you are using an old version of the preset. Please upgrade.`);
    }
    return params ? await createPreset(params) : await createPreset();
  };
}
var loadPreset = createPresetLoader((preset) => import(preset));

// ../../node_modules/.pnpm/conventional-recommended-bump@11.2.0/node_modules/conventional-recommended-bump/dist/utils.js
function isIterable(value) {
  return value !== null && (typeof value[Symbol.iterator] === "function" || typeof value[Symbol.asyncIterator] === "function");
}
function bindLogNamespace(namespace, logger) {
  return (messages) => logger(namespace, messages);
}

// ../../node_modules/.pnpm/conventional-recommended-bump@11.2.0/node_modules/conventional-recommended-bump/dist/bumper.js
var VERSIONS = [
  "major",
  "minor",
  "patch"
];
var Bumper = class {
  gitClient;
  params;
  whatBump;
  tagGetter;
  commitsGetter;
  constructor(cwdOrGitClient = process.cwd()) {
    this.gitClient = typeof cwdOrGitClient === "string" ? new ConventionalGitClient(cwdOrGitClient) : cwdOrGitClient;
    this.whatBump = null;
    this.params = Promise.resolve({
      commits: {
        format: "%B%n-hash-%n%H",
        filterReverts: true
      }
    });
    this.tagGetter = () => this.getLastSemverTag();
    this.commitsGetter = () => this.getCommits();
  }
  composeParams(params) {
    this.params = Promise.all([params, this.params]).then(([params2, prevParams]) => ({
      options: {
        ...prevParams.options,
        ...params2.options
      },
      tags: {
        ...prevParams.tags,
        ...params2.tags
      },
      commits: {
        ...prevParams.commits,
        ...params2.commits
      },
      parser: {
        ...prevParams.parser,
        ...params2.parser
      }
    }));
  }
  async getLastSemverTag() {
    const { tags } = await this.params;
    return await this.gitClient.getLastSemverTag(tags);
  }
  async *getCommits() {
    const { options, commits, parser } = await this.params;
    const parserParams = {
      ...parser
    };
    if (!parserParams.warn && options?.warn) {
      parserParams.warn = bindLogNamespace("parser", options.warn);
    }
    yield* this.gitClient.getCommits({
      from: await this.tagGetter() || "",
      ...commits
    }, parserParams);
  }
  /**
   * Load configs from a preset
   * @param preset
   * @param loader - Preset module loader, if not provided, will use default loader
   * @returns this
   */
  loadPreset(preset, loader2) {
    const loadPreset2 = loader2 ? createPresetLoader(loader2) : loadPreset;
    const config = loadPreset2(preset).then((config2) => {
      if (!config2) {
        throw Error("Preset is not loaded or have incorrect exports");
      }
      return config2;
    });
    this.whatBump = async (commits) => {
      const { whatBump } = await config;
      return whatBump(commits);
    };
    this.composeParams(config);
    return this;
  }
  /**
   * Set config directly
   * @param config - Config object
   * @returns this
   */
  config(config) {
    this.composeParams(config);
    return this;
  }
  /**
   * Set bumper options
   * @param options - Bumper options
   * @returns this
   */
  options(options) {
    this.composeParams({
      options
    });
    return this;
  }
  /**
   * Set params to get the last semver tag
   * @param paramsOrTag - Params to get the last semver tag or a tag name
   * @returns this
   */
  tag(paramsOrTag) {
    if (typeof paramsOrTag === "string") {
      this.tagGetter = () => paramsOrTag;
    } else {
      this.tagGetter = () => this.getLastSemverTag();
      this.composeParams({
        tags: paramsOrTag
      });
    }
    return this;
  }
  commits(paramsOrCommits, parserOptions) {
    if (isIterable(paramsOrCommits)) {
      this.commitsGetter = () => paramsOrCommits;
    } else {
      this.commitsGetter = () => this.getCommits();
      this.composeParams({
        commits: paramsOrCommits,
        parser: parserOptions
      });
    }
    return this;
  }
  /**
   * Recommend a bump by `whatBump` function
   * @param whatBump - Function to recommend a bump from commits
   * @returns Bump recommendation
   */
  async bump(whatBump = this.whatBump) {
    if (typeof whatBump !== "function") {
      throw Error("`whatBump` must be a function");
    }
    const { gitClient } = this;
    const { options } = await this.params;
    if (!gitClient.debug && options?.debug) {
      gitClient.debug = bindLogNamespace("git-client", options.debug);
    }
    const commitsStream = this.commitsGetter();
    const commits = [];
    let commit;
    for await (commit of commitsStream) {
      commits.push(commit);
    }
    const result = await whatBump(commits);
    if (result && "level" in result) {
      return {
        ...result,
        releaseType: VERSIONS[result.level],
        commits
      };
    }
    return {
      commits
    };
  }
};

// ../version/dist/chunk-UBCKZYTO.js
var import_semver3 = __toESM(require_semver(), 1);

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.6.0_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/utils.js
function formatArgs2(...args) {
  return args.reduce((finalArgs, arg) => {
    if (arg) {
      finalArgs.push(String(arg));
    }
    return finalArgs;
  }, []);
}
function toArray3(value) {
  return Array.isArray(value) ? value : [value];
}

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.6.0_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/GitClient.js
import { spawn as spawn2 } from "child_process";

// ../../node_modules/.pnpm/@simple-libs+stream-utils@1.2.0/node_modules/@simple-libs/stream-utils/dist/index.js
async function toArray4(iterable) {
  const result = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}
async function concatBufferStream2(iterable) {
  return Buffer.concat(await toArray4(iterable));
}
async function firstFromStream2(stream) {
  for await (const tag of stream) {
    return tag;
  }
  return null;
}
async function* splitStream2(stream, separator) {
  let chunk;
  let payload;
  let buffer = "";
  for await (chunk of stream) {
    buffer += chunk.toString();
    if (buffer.includes(separator)) {
      payload = buffer.split(separator);
      buffer = payload.pop() || "";
      yield* payload;
    }
  }
  if (buffer) {
    yield buffer;
  }
}

// ../../node_modules/.pnpm/@simple-libs+child-process-utils@1.0.2/node_modules/@simple-libs/child-process-utils/dist/index.js
async function exitCode2(process2) {
  if (process2.exitCode !== null) {
    return process2.exitCode;
  }
  return new Promise((resolve4) => process2.once("close", resolve4));
}
async function catchProcessError2(process2) {
  let error = new Error("Process exited with non-zero code");
  let stderr = "";
  process2.on("error", (err) => {
    error = err;
  });
  if (process2.stderr) {
    let chunk;
    for await (chunk of process2.stderr) {
      stderr += chunk.toString();
    }
  }
  const code = await exitCode2(process2);
  if (stderr) {
    error = new Error(stderr);
  }
  return code ? error : null;
}
async function* outputStream2(process2) {
  const { stdout } = process2;
  const errorPromise = catchProcessError2(process2);
  if (stdout) {
    stdout.on("error", (err) => {
      if (err.name === "AbortError" && process2.exitCode === null) {
        process2.kill("SIGKILL");
      }
    });
    yield* stdout;
  }
  const error = await errorPromise;
  if (error) {
    throw error;
  }
}
function output2(process2) {
  return concatBufferStream2(outputStream2(process2));
}

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.6.0_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/GitClient.js
var SCISSOR2 = "------------------------ >8 ------------------------";
var GitClient2 = class {
  cwd;
  debug;
  constructor(cwd3, debug) {
    this.cwd = cwd3;
    this.debug = debug;
  }
  formatArgs(...args) {
    const finalArgs = formatArgs2(...args);
    if (this.debug) {
      this.debug(finalArgs);
    }
    return finalArgs;
  }
  /**
   * Raw exec method to run git commands.
   * @param args
   * @returns Stdout string output of the command.
   */
  async exec(...args) {
    return (await output2(spawn2("git", this.formatArgs(...args), {
      cwd: this.cwd
    }))).toString().trim();
  }
  /**
   * Raw exec method to run git commands with stream output.
   * @param args
   * @returns Stdout stream of the command.
   */
  execStream(...args) {
    return outputStream2(spawn2("git", this.formatArgs(...args), {
      cwd: this.cwd
    }));
  }
  /**
   * Initialize a new git repository.
   * @returns Boolean result.
   */
  async init() {
    try {
      await this.exec("init");
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Get raw commits stream.
   * @param params
   * @param params.path - Read commits from specific path.
   * @param params.from - Start commits range.
   * @param params.to - End commits range.
   * @param params.format - Commits format.
   * @yields Raw commits data.
   */
  async *getRawCommits(params = {}) {
    const { path: path10, from = "", to = "HEAD", format = "%B", ignore, reverse, merges, since } = params;
    const shouldNotIgnore = ignore ? (chunk2) => !ignore.test(chunk2) : () => true;
    const stdout = this.execStream("log", `--format=${format}%n${SCISSOR2}`, since && `--since=${since instanceof Date ? since.toISOString() : since}`, reverse && "--reverse", merges && "--merges", merges === false && "--no-merges", [from, to].filter(Boolean).join(".."), ...path10 ? ["--", ...toArray3(path10)] : []);
    const commitsStream = splitStream2(stdout, `${SCISSOR2}
`);
    let chunk;
    for await (chunk of commitsStream) {
      if (shouldNotIgnore(chunk)) {
        yield chunk;
      }
    }
  }
  /**
   * Get tags stream.
   * @param params
   * @yields Tags
   */
  async *getTags(params = {}) {
    const { path: path10, from = "", to = "HEAD", since } = params;
    const tagRegex = /tag:\s*(.+?)[,)]/gi;
    const stdout = this.execStream("log", "--decorate", "--no-color", "--date-order", since && `--since=${since instanceof Date ? since.toISOString() : since}`, [from, to].filter(Boolean).join(".."), ...path10 ? ["--", ...toArray3(path10)] : []);
    let chunk;
    let matches;
    let tag;
    for await (chunk of stdout) {
      matches = chunk.toString().trim().matchAll(tagRegex);
      for ([, tag] of matches) {
        yield tag;
      }
    }
  }
  /**
   * Get last tag.
   * @param params
   * @returns Last tag, `null` if not found.
   */
  async getLastTag(params) {
    return firstFromStream2(this.getTags(params));
  }
  /**
   * Check file is ignored via .gitignore.
   * @param file - Path to target file.
   * @returns Boolean value.
   */
  async checkIgnore(file) {
    try {
      await this.exec("check-ignore", "--", file);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Add files to git index.
   * @param files - Files to stage.
   */
  async add(files) {
    await this.exec("add", "--", ...toArray3(files));
  }
  /**
   * Commit changes.
   * @param params
   * @param params.verify
   * @param params.sign
   * @param params.files
   * @param params.allowEmpty
   * @param params.message
   */
  async commit(params) {
    const { verify = true, sign = false, files = [], allowEmpty = false, message } = params;
    await this.exec("commit", !verify && "--no-verify", sign && "-S", allowEmpty && "--allow-empty", "-m", message, "--", ...files);
  }
  /**
   * Create a tag for the current commit.
   * @param params
   * @param params.sign
   * @param params.name
   * @param params.message
   */
  async tag(params) {
    let { sign = false, name, message } = params;
    if (sign) {
      message = "";
    }
    await this.exec("tag", sign && "-s", message && "-a", ...message ? ["-m", message] : [], "--", name);
  }
  /**
   * Get current branch name.
   * @returns Current branch name.
   */
  async getCurrentBranch() {
    const branch = await this.exec("rev-parse", "--abbrev-ref", "HEAD");
    return branch;
  }
  /**
   * Get default branch name.
   * @returns Default branch name.
   */
  async getDefaultBranch() {
    const branch = (await this.exec("rev-parse", "--abbrev-ref", "origin/HEAD")).replace(/^origin\//, "");
    return branch;
  }
  /**
   * Push changes to remote.
   * @param branch
   * @param params
   * @param params.verify
   */
  async push(branch, params = {}) {
    const { verify = true, tags = false, followTags = false, force = false } = params;
    await this.exec("push", followTags && "--follow-tags", tags && "--tags", !verify && "--no-verify", force && "--force", "origin", "--", branch);
  }
  /**
   * Verify rev exists.
   * @param rev
   * @param safe - If `true`, will not throw error if rev not found.
   * @returns Target hash.
   */
  async verify(rev, safe) {
    let git = this.exec("rev-parse", "--verify", rev);
    if (safe) {
      git = git.catch(() => "");
    }
    return await git;
  }
  /**
   * Get config value by key.
   * @param key - Config key.
   * @returns Config value.
   */
  async getConfig(key) {
    return await this.exec("config", "--get", "--", key);
  }
  /**
   * Set config value by key.
   * @param key - Config key.
   * @param value - Config value.
   */
  async setConfig(key, value) {
    await this.exec("config", "--", key, value);
  }
  /**
   * Fetch changes from remote.
   * @param params
   */
  async fetch(params = {}) {
    const { prune = false, unshallow = false, tags = false, all = false, remote, branch } = params;
    await this.exec("fetch", prune && "--prune", unshallow && "--unshallow", tags && "--tags", all && "--all", ...remote && branch ? [
      "--",
      remote,
      branch
    ] : []);
  }
  /**
   * Create a new branch.
   * @param branch - Branch name.
   */
  async createBranch(branch) {
    await this.exec("checkout", "-b", branch);
  }
  /**
   * Delete a branch.
   * @param branch - Branch name.
   */
  async deleteBranch(branch) {
    await this.exec("branch", "-D", "--", branch);
  }
  /**
   * Checkout a branch.
   * @param branch - Branch name.
   */
  async checkout(branch) {
    await this.exec("checkout", branch);
  }
};

// ../../node_modules/.pnpm/@conventional-changelog+git-client@2.6.0_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/@conventional-changelog/git-client/dist/ConventionalGitClient.js
var import_semver2 = __toESM(require_semver(), 1);
function packagePrefix2(packageName) {
  if (!packageName) {
    return /^.+@/;
  }
  return `${packageName}@`;
}
var ConventionalGitClient2 = class extends GitClient2 {
  deps = null;
  loadDeps() {
    if (this.deps) {
      return this.deps;
    }
    this.deps = Promise.all([
      import("./dist-WN32E32Z.js").then(({ parseCommits }) => parseCommits),
      import("./dist-J7662OKQ.js").then(({ filterRevertedCommits }) => filterRevertedCommits)
    ]);
    return this.deps;
  }
  /**
   * Get parsed commits stream.
   * @param params
   * @param params.path - Read commits from specific path.
   * @param params.from - Start commits range.
   * @param params.to - End commits range.
   * @param params.format - Commits format.
   * @param parserOptions - Commit parser options.
   * @yields Raw commits data.
   */
  async *getCommits(params = {}, parserOptions = {}) {
    const { filterReverts, ...gitLogParams } = params;
    const [parseCommits, filterRevertedCommits] = await this.loadDeps();
    if (filterReverts) {
      yield* filterRevertedCommits(this.getCommits(gitLogParams, parserOptions));
      return;
    }
    const parse2 = parseCommits(parserOptions);
    const commitsStream = this.getRawCommits(gitLogParams);
    yield* parse2(commitsStream);
  }
  /**
   * Get semver tags stream.
   * @param params
   * @param params.prefix - Get semver tags with specific prefix.
   * @param params.skipUnstable - Skip semver tags with unstable versions.
   * @param params.clean - Clean version from prefix and trash.
   * @yields Semver tags.
   */
  async *getSemverTags(params = {}) {
    const { prefix, skipUnstable, clean } = params;
    const tagsStream = this.getTags();
    const unstableTagRegex = /\d+\.\d+\.\d+-.+/;
    const cleanTag = clean ? (tag2, unprefixed2) => import_semver2.default.clean(unprefixed2 || tag2) : (tag2) => tag2;
    let unprefixed;
    let tag;
    for await (tag of tagsStream) {
      if (skipUnstable && unstableTagRegex.test(tag)) {
        continue;
      }
      if (prefix) {
        const isPrefixed = typeof prefix === "string" ? tag.startsWith(prefix) : prefix.test(tag);
        if (isPrefixed) {
          unprefixed = tag.replace(prefix, "");
          if (import_semver2.default.valid(unprefixed)) {
            tag = cleanTag(tag, unprefixed);
            if (tag) {
              yield tag;
            }
          }
        }
      } else if (import_semver2.default.valid(tag)) {
        tag = cleanTag(tag);
        if (tag) {
          yield tag;
        }
      }
    }
  }
  /**
   * Get last semver tag.
   * @param params - getSemverTags params.
   * @returns Last semver tag, `null` if not found.
   */
  async getLastSemverTag(params = {}) {
    return firstFromStream2(this.getSemverTags(params));
  }
  /**
   * Get current sematic version from git tags.
   * @param params - Additional git params.
   * @returns Current sematic version, `null` if not found.
   */
  async getVersionFromTags(params = {}) {
    const semverTagsStream = this.getSemverTags({
      clean: true,
      ...params
    });
    const semverTags = [];
    for await (const tag of semverTagsStream) {
      semverTags.push(tag);
    }
    if (!semverTags.length) {
      return null;
    }
    return semverTags.sort(import_semver2.default.rcompare)[0] || null;
  }
};

// ../../node_modules/.pnpm/git-semver-tags@8.0.1_conventional-commits-filter@5.0.0_conventional-commits-parser@6.2.1/node_modules/git-semver-tags/src/index.js
function getFinalOptions(options = {}) {
  if (options.package && !options.lernaTags) {
    throw new Error("opts.package should only be used when running in lerna mode");
  }
  const finalOptions = {
    cwd: options.cwd || process.cwd(),
    prefix: options.lernaTags ? packagePrefix2(options.package) : options.tagPrefix,
    skipUnstable: options.skipUnstable
  };
  return finalOptions;
}
async function getSemverTags(options = {}) {
  const {
    cwd: cwd3,
    ...finalOptions
  } = getFinalOptions(options);
  const client = new ConventionalGitClient2(cwd3);
  const tags = [];
  for await (const tag of client.getSemverTags(finalOptions)) {
    tags.push(tag);
  }
  return tags;
}

// ../version/dist/chunk-UBCKZYTO.js
var import_semver4 = __toESM(require_semver(), 1);
import chalk from "chalk";

// ../../node_modules/.pnpm/figlet@1.11.0/node_modules/figlet/dist/node-figlet.mjs
import * as fs from "fs";
import * as path2 from "path";

// ../../node_modules/.pnpm/figlet@1.11.0/node_modules/figlet/dist/figlet-C8Ns3Vyn.js
var LAYOUT = {
  FULL_WIDTH: 0,
  FITTING: 1,
  SMUSHING: 2,
  CONTROLLED_SMUSHING: 3
};
var FigletFont = class {
  constructor() {
    this.comment = "";
    this.numChars = 0;
    this.options = {};
  }
};
var fontList = [
  "1Row",
  "3-D",
  "3D Diagonal",
  "3D-ASCII",
  "3x5",
  "4Max",
  "5 Line Oblique",
  "AMC 3 Line",
  "AMC 3 Liv1",
  "AMC AAA01",
  "AMC Neko",
  "AMC Razor",
  "AMC Razor2",
  "AMC Slash",
  "AMC Slider",
  "AMC Thin",
  "AMC Tubes",
  "AMC Untitled",
  "ANSI Compact",
  "ANSI Regular",
  "ANSI Shadow",
  "ASCII 12",
  "ASCII 9",
  "ASCII New Roman",
  "Acrobatic",
  "Alligator",
  "Alligator2",
  "Alpha",
  "Alphabet",
  "Arrows",
  "Avatar",
  "B1FF",
  "Babyface Lame",
  "Babyface Leet",
  "Banner",
  "Banner3-D",
  "Banner3",
  "Banner4",
  "Barbwire",
  "Basic",
  "Bear",
  "Bell",
  "Benjamin",
  "Big ASCII 12",
  "Big ASCII 9",
  "Big Chief",
  "Big Money-ne",
  "Big Money-nw",
  "Big Money-se",
  "Big Money-sw",
  "Big Mono 12",
  "Big Mono 9",
  "Big",
  "Bigfig",
  "Binary",
  "Block",
  "Blocks",
  "Bloody",
  "BlurVision ASCII",
  "Bolger",
  "Braced",
  "Bright",
  "Broadway KB",
  "Broadway",
  "Bubble",
  "Bulbhead",
  "Caligraphy",
  "Caligraphy2",
  "Calvin S",
  "Cards",
  "Catwalk",
  "Chiseled",
  "Chunky",
  "Circle",
  "Classy",
  "Coder Mini",
  "Coinstak",
  "Cola",
  "Colossal",
  "Computer",
  "Contessa",
  "Contrast",
  "Cosmike",
  "Cosmike2",
  "Crawford",
  "Crawford2",
  "Crazy",
  "Cricket",
  "Cursive",
  "Cyberlarge",
  "Cybermedium",
  "Cybersmall",
  "Cygnet",
  "DANC4",
  "DOS Rebel",
  "DWhistled",
  "Dancing Font",
  "Decimal",
  "Def Leppard",
  "Delta Corps Priest 1",
  "DiamFont",
  "Diamond",
  "Diet Cola",
  "Digital",
  "Doh",
  "Doom",
  "Dot Matrix",
  "Double Shorts",
  "Double",
  "Dr Pepper",
  "Efti Chess",
  "Efti Font",
  "Efti Italic",
  "Efti Piti",
  "Efti Robot",
  "Efti Wall",
  "Efti Water",
  "Electronic",
  "Elite",
  "Emboss 2",
  "Emboss",
  "Epic",
  "Fender",
  "Filter",
  "Fire Font-k",
  "Fire Font-s",
  "Flipped",
  "Flower Power",
  "Font Font",
  "Four Tops",
  "Fraktur",
  "Fun Face",
  "Fun Faces",
  "Future Smooth",
  "Future Thin",
  "Future",
  "Fuzzy",
  "Georgi16",
  "Georgia11",
  "Ghost",
  "Ghoulish",
  "Glenyn",
  "Goofy",
  "Gothic",
  "Graceful",
  "Gradient",
  "Graffiti",
  "Greek",
  "Heart Left",
  "Heart Right",
  "Henry 3D",
  "Hex",
  "Hieroglyphs",
  "Hollywood",
  "Horizontal Left",
  "Horizontal Right",
  "ICL-1900",
  "Impossible",
  "Invita",
  "Isometric1",
  "Isometric2",
  "Isometric3",
  "Isometric4",
  "Italic",
  "Ivrit",
  "JS Block Letters",
  "JS Bracket Letters",
  "JS Capital Curves",
  "JS Cursive",
  "JS Stick Letters",
  "Jacky",
  "Jazmine",
  "Jerusalem",
  "Katakana",
  "Kban",
  "Keyboard",
  "Knob",
  "Konto Slant",
  "Konto",
  "LCD",
  "Larry 3D 2",
  "Larry 3D",
  "Lean",
  "Letter",
  "Letters",
  "Lil Devil",
  "Line Blocks",
  "Linux",
  "Lockergnome",
  "Madrid",
  "Marquee",
  "Maxfour",
  "Merlin1",
  "Merlin2",
  "Mike",
  "Mini",
  "Mirror",
  "Mnemonic",
  "Modular",
  "Mono 12",
  "Mono 9",
  "Morse",
  "Morse2",
  "Moscow",
  "Mshebrew210",
  "Muzzle",
  "NScript",
  "NT Greek",
  "NV Script",
  "Nancyj-Fancy",
  "Nancyj-Improved",
  "Nancyj-Underlined",
  "Nancyj",
  "Nipples",
  "O8",
  "OS2",
  "Octal",
  "Ogre",
  "Old Banner",
  "Pagga",
  "Patorjk's Cheese",
  "Patorjk-HeX",
  "Pawp",
  "Peaks Slant",
  "Peaks",
  "Pebbles",
  "Pepper",
  "Poison",
  "Puffy",
  "Puzzle",
  "Pyramid",
  "Rammstein",
  "Rebel",
  "Rectangles",
  "Red Phoenix",
  "Relief",
  "Relief2",
  "Reverse",
  "Roman",
  "Rot13",
  "Rotated",
  "Rounded",
  "Rowan Cap",
  "Rozzo",
  "RubiFont",
  "Runic",
  "Runyc",
  "S Blood",
  "SL Script",
  "Santa Clara",
  "Script",
  "Serifcap",
  "Shaded Blocky",
  "Shadow",
  "Shimrod",
  "Short",
  "Slant Relief",
  "Slant",
  "Slide",
  "Small ASCII 12",
  "Small ASCII 9",
  "Small Block",
  "Small Braille",
  "Small Caps",
  "Small Isometric1",
  "Small Keyboard",
  "Small Mono 12",
  "Small Mono 9",
  "Small Poison",
  "Small Script",
  "Small Shadow",
  "Small Slant",
  "Small Tengwar",
  "Small",
  "Soft",
  "Speed",
  "Spliff",
  "Stacey",
  "Stampate",
  "Stampatello",
  "Standard",
  "Star Strips",
  "Star Wars",
  "Stellar",
  "Stforek",
  "Stick Letters",
  "Stop",
  "Straight",
  "Stronger Than All",
  "Sub-Zero",
  "Swamp Land",
  "Swan",
  "Sweet",
  "THIS",
  "Tanja",
  "Tengwar",
  "Term",
  "Terrace",
  "Test1",
  "The Edge",
  "Thick",
  "Thin",
  "Thorned",
  "Three Point",
  "Ticks Slant",
  "Ticks",
  "Tiles",
  "Tinker-Toy",
  "Tmplr",
  "Tombstone",
  "Train",
  "Trek",
  "Tsalagi",
  "Tubular",
  "Twisted",
  "Two Point",
  "USA Flag",
  "Univers",
  "Upside Down Text",
  "Varsity",
  "Wavescape",
  "Wavy",
  "Weird",
  "Wet Letter",
  "Whimsy",
  "WideTerm",
  "Wow",
  "miniwi"
];
var renamedFonts = {
  "ANSI-Compact": "ANSI Compact"
};
var getFontName = (name) => {
  return renamedFonts[name] ? renamedFonts[name] : name;
};
function escapeRegExpChar(char) {
  const specialChars = /[.*+?^${}()|[\]\\]/;
  return specialChars.test(char) ? "\\" + char : char;
}
var figlet = (() => {
  const { FULL_WIDTH = 0, FITTING, SMUSHING, CONTROLLED_SMUSHING } = LAYOUT;
  const figFonts = {};
  const figDefaults = {
    font: "Standard",
    fontPath: "./fonts",
    fetchFontIfMissing: true
  };
  function removeEndChar(line, lineNum, fontHeight) {
    const endChar = escapeRegExpChar(line.trim().slice(-1)) || "@";
    const endCharRegEx = lineNum === fontHeight - 1 ? new RegExp(endChar + endChar + "?\\s*$") : new RegExp(endChar + "\\s*$");
    return line.replace(endCharRegEx, "");
  }
  function getSmushingRules(oldLayout = -1, newLayout = null) {
    let rules = {};
    let val;
    let codes = [
      [16384, "vLayout", SMUSHING],
      [8192, "vLayout", FITTING],
      [4096, "vRule5", true],
      [2048, "vRule4", true],
      [1024, "vRule3", true],
      [512, "vRule2", true],
      [256, "vRule1", true],
      [128, "hLayout", SMUSHING],
      [64, "hLayout", FITTING],
      [32, "hRule6", true],
      [16, "hRule5", true],
      [8, "hRule4", true],
      [4, "hRule3", true],
      [2, "hRule2", true],
      [1, "hRule1", true]
    ];
    val = newLayout !== null ? newLayout : oldLayout;
    for (const [code, rule, value] of codes) {
      if (val >= code) {
        val -= code;
        if (rules[rule] === void 0) {
          rules[rule] = value;
        }
      } else if (rule !== "vLayout" && rule !== "hLayout") {
        rules[rule] = false;
      }
    }
    if (typeof rules["hLayout"] === "undefined") {
      if (oldLayout === 0) {
        rules["hLayout"] = FITTING;
      } else if (oldLayout === -1) {
        rules["hLayout"] = FULL_WIDTH;
      } else {
        if (rules["hRule1"] || rules["hRule2"] || rules["hRule3"] || rules["hRule4"] || rules["hRule5"] || rules["hRule6"]) {
          rules["hLayout"] = CONTROLLED_SMUSHING;
        } else {
          rules["hLayout"] = SMUSHING;
        }
      }
    } else if (rules["hLayout"] === SMUSHING) {
      if (rules["hRule1"] || rules["hRule2"] || rules["hRule3"] || rules["hRule4"] || rules["hRule5"] || rules["hRule6"]) {
        rules["hLayout"] = CONTROLLED_SMUSHING;
      }
    }
    if (typeof rules["vLayout"] === "undefined") {
      if (rules["vRule1"] || rules["vRule2"] || rules["vRule3"] || rules["vRule4"] || rules["vRule5"]) {
        rules["vLayout"] = CONTROLLED_SMUSHING;
      } else {
        rules["vLayout"] = FULL_WIDTH;
      }
    } else if (rules["vLayout"] === SMUSHING) {
      if (rules["vRule1"] || rules["vRule2"] || rules["vRule3"] || rules["vRule4"] || rules["vRule5"]) {
        rules["vLayout"] = CONTROLLED_SMUSHING;
      }
    }
    return rules;
  }
  function hRule1_Smush(ch1, ch2, hardBlank = "") {
    if (ch1 === ch2 && ch1 !== hardBlank) {
      return ch1;
    }
    return false;
  }
  function hRule2_Smush(ch1, ch2) {
    let rule2Str = "|/\\[]{}()<>";
    if (ch1 === "_") {
      if (rule2Str.indexOf(ch2) !== -1) {
        return ch2;
      }
    } else if (ch2 === "_") {
      if (rule2Str.indexOf(ch1) !== -1) {
        return ch1;
      }
    }
    return false;
  }
  function hRule3_Smush(ch1, ch2) {
    let rule3Classes = "| /\\ [] {} () <>";
    let r3_pos1 = rule3Classes.indexOf(ch1);
    let r3_pos2 = rule3Classes.indexOf(ch2);
    if (r3_pos1 !== -1 && r3_pos2 !== -1) {
      if (r3_pos1 !== r3_pos2 && Math.abs(r3_pos1 - r3_pos2) !== 1) {
        const startPos = Math.max(r3_pos1, r3_pos2);
        const endPos = startPos + 1;
        return rule3Classes.substring(startPos, endPos);
      }
    }
    return false;
  }
  function hRule4_Smush(ch1, ch2) {
    let rule4Str = "[] {} ()";
    let r4_pos1 = rule4Str.indexOf(ch1);
    let r4_pos2 = rule4Str.indexOf(ch2);
    if (r4_pos1 !== -1 && r4_pos2 !== -1) {
      if (Math.abs(r4_pos1 - r4_pos2) <= 1) {
        return "|";
      }
    }
    return false;
  }
  function hRule5_Smush(ch1, ch2) {
    const patterns = {
      "/\\": "|",
      "\\/": "Y",
      "><": "X"
    };
    return patterns[ch1 + ch2] || false;
  }
  function hRule6_Smush(ch1, ch2, hardBlank = "") {
    if (ch1 === hardBlank && ch2 === hardBlank) {
      return hardBlank;
    }
    return false;
  }
  function vRule1_Smush(ch1, ch2) {
    if (ch1 === ch2) {
      return ch1;
    }
    return false;
  }
  function vRule2_Smush(ch1, ch2) {
    return hRule2_Smush(ch1, ch2);
  }
  function vRule3_Smush(ch1, ch2) {
    return hRule3_Smush(ch1, ch2);
  }
  function vRule4_Smush(ch1, ch2) {
    if (ch1 === "-" && ch2 === "_" || ch1 === "_" && ch2 === "-") {
      return "=";
    }
    return false;
  }
  function vRule5_Smush(ch1, ch2) {
    if (ch1 === "|" && ch2 === "|") {
      return "|";
    }
    return false;
  }
  function uni_Smush(ch1, ch2, hardBlank) {
    if (ch2 === " " || ch2 === "") {
      return ch1;
    } else if (ch2 === hardBlank && ch1 !== " ") {
      return ch1;
    } else {
      return ch2;
    }
  }
  function canVerticalSmush(txt1, txt2, opts) {
    if (opts.fittingRules && opts.fittingRules.vLayout === FULL_WIDTH) {
      return "invalid";
    }
    let ii, len = Math.min(txt1.length, txt2.length), ch1, ch2, endSmush = false, validSmush;
    if (len === 0) {
      return "invalid";
    }
    for (ii = 0; ii < len; ii++) {
      ch1 = txt1.substring(ii, ii + 1);
      ch2 = txt2.substring(ii, ii + 1);
      if (ch1 !== " " && ch2 !== " ") {
        if (opts.fittingRules && opts.fittingRules.vLayout === FITTING) {
          return "invalid";
        } else if (opts.fittingRules && opts.fittingRules.vLayout === SMUSHING) {
          return "end";
        } else {
          if (vRule5_Smush(ch1, ch2)) {
            endSmush = endSmush || false;
            continue;
          }
          validSmush = false;
          validSmush = opts.fittingRules && opts.fittingRules.vRule1 ? vRule1_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && opts.fittingRules && opts.fittingRules.vRule2 ? vRule2_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && opts.fittingRules && opts.fittingRules.vRule3 ? vRule3_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && opts.fittingRules && opts.fittingRules.vRule4 ? vRule4_Smush(ch1, ch2) : validSmush;
          endSmush = true;
          if (!validSmush) {
            return "invalid";
          }
        }
      }
    }
    if (endSmush) {
      return "end";
    } else {
      return "valid";
    }
  }
  function getVerticalSmushDist(lines1, lines2, opts) {
    let maxDist = lines1.length;
    let len1 = lines1.length;
    let subLines1, subLines2, slen;
    let curDist = 1;
    let ii, ret, result;
    while (curDist <= maxDist) {
      subLines1 = lines1.slice(Math.max(0, len1 - curDist), len1);
      subLines2 = lines2.slice(0, Math.min(maxDist, curDist));
      slen = subLines2.length;
      result = "";
      for (ii = 0; ii < slen; ii++) {
        ret = canVerticalSmush(subLines1[ii], subLines2[ii], opts);
        if (ret === "end") {
          result = ret;
        } else if (ret === "invalid") {
          result = ret;
          break;
        } else {
          if (result === "") {
            result = "valid";
          }
        }
      }
      if (result === "invalid") {
        curDist--;
        break;
      }
      if (result === "end") {
        break;
      }
      if (result === "valid") {
        curDist++;
      }
    }
    return Math.min(maxDist, curDist);
  }
  function verticallySmushLines(line1, line2, opts) {
    let ii, len = Math.min(line1.length, line2.length);
    let ch1, ch2, result = "", validSmush;
    const fittingRules = opts.fittingRules || {};
    for (ii = 0; ii < len; ii++) {
      ch1 = line1.substring(ii, ii + 1);
      ch2 = line2.substring(ii, ii + 1);
      if (ch1 !== " " && ch2 !== " ") {
        if (fittingRules.vLayout === FITTING) {
          result += uni_Smush(ch1, ch2);
        } else if (fittingRules.vLayout === SMUSHING) {
          result += uni_Smush(ch1, ch2);
        } else {
          validSmush = false;
          validSmush = fittingRules.vRule5 ? vRule5_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && fittingRules.vRule1 ? vRule1_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && fittingRules.vRule2 ? vRule2_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && fittingRules.vRule3 ? vRule3_Smush(ch1, ch2) : validSmush;
          validSmush = !validSmush && fittingRules.vRule4 ? vRule4_Smush(ch1, ch2) : validSmush;
          result += validSmush;
        }
      } else {
        result += uni_Smush(ch1, ch2);
      }
    }
    return result;
  }
  function verticalSmush(lines1, lines2, overlap, opts) {
    let len1 = lines1.length;
    let len2 = lines2.length;
    let piece1 = lines1.slice(0, Math.max(0, len1 - overlap));
    let piece2_1 = lines1.slice(Math.max(0, len1 - overlap), len1);
    let piece2_2 = lines2.slice(0, Math.min(overlap, len2));
    let ii, len, line, piece2 = [], piece3;
    len = piece2_1.length;
    for (ii = 0; ii < len; ii++) {
      if (ii >= len2) {
        line = piece2_1[ii];
      } else {
        line = verticallySmushLines(piece2_1[ii], piece2_2[ii], opts);
      }
      piece2.push(line);
    }
    piece3 = lines2.slice(Math.min(overlap, len2), len2);
    return [...piece1, ...piece2, ...piece3];
  }
  function padLines(lines, numSpaces) {
    const padding = " ".repeat(numSpaces);
    return lines.map((line) => line + padding);
  }
  function smushVerticalFigLines(output3, lines, opts) {
    let len1 = output3[0].length;
    let len2 = lines[0].length;
    let overlap;
    if (len1 > len2) {
      lines = padLines(lines, len1 - len2);
    } else if (len2 > len1) {
      output3 = padLines(output3, len2 - len1);
    }
    overlap = getVerticalSmushDist(output3, lines, opts);
    return verticalSmush(output3, lines, overlap, opts);
  }
  function getHorizontalSmushLength(txt1, txt2, opts) {
    const fittingRules = opts.fittingRules || {};
    if (fittingRules.hLayout === FULL_WIDTH) {
      return 0;
    }
    let ii, len1 = txt1.length, len2 = txt2.length;
    let maxDist = len1;
    let curDist = 1;
    let breakAfter = false;
    let seg1, seg2, ch1, ch2;
    if (len1 === 0) {
      return 0;
    }
    distCal: while (curDist <= maxDist) {
      const seg1StartPos = len1 - curDist;
      seg1 = txt1.substring(seg1StartPos, seg1StartPos + curDist);
      seg2 = txt2.substring(0, Math.min(curDist, len2));
      for (ii = 0; ii < Math.min(curDist, len2); ii++) {
        ch1 = seg1.substring(ii, ii + 1);
        ch2 = seg2.substring(ii, ii + 1);
        if (ch1 !== " " && ch2 !== " ") {
          if (fittingRules.hLayout === FITTING) {
            curDist = curDist - 1;
            break distCal;
          } else if (fittingRules.hLayout === SMUSHING) {
            if (ch1 === opts.hardBlank || ch2 === opts.hardBlank) {
              curDist = curDist - 1;
            }
            break distCal;
          } else {
            breakAfter = true;
            const validSmush = fittingRules.hRule1 && hRule1_Smush(ch1, ch2, opts.hardBlank) || fittingRules.hRule2 && hRule2_Smush(ch1, ch2) || fittingRules.hRule3 && hRule3_Smush(ch1, ch2) || fittingRules.hRule4 && hRule4_Smush(ch1, ch2) || fittingRules.hRule5 && hRule5_Smush(ch1, ch2) || fittingRules.hRule6 && hRule6_Smush(ch1, ch2, opts.hardBlank);
            if (!validSmush) {
              curDist = curDist - 1;
              break distCal;
            }
          }
        }
      }
      if (breakAfter) {
        break;
      }
      curDist++;
    }
    return Math.min(maxDist, curDist);
  }
  function horizontalSmush(textBlock1, textBlock2, overlap, opts) {
    let ii, jj, outputFig = [], overlapStart, piece1, piece2, piece3, len1, len2, txt1, txt2;
    const fittingRules = opts.fittingRules || {};
    if (typeof opts.height !== "number") {
      throw new Error("height is not defined.");
    }
    for (ii = 0; ii < opts.height; ii++) {
      txt1 = textBlock1[ii];
      txt2 = textBlock2[ii];
      len1 = txt1.length;
      len2 = txt2.length;
      overlapStart = len1 - overlap;
      piece1 = txt1.slice(0, Math.max(0, overlapStart));
      piece2 = "";
      const seg1StartPos = Math.max(0, len1 - overlap);
      let seg1 = txt1.substring(seg1StartPos, seg1StartPos + overlap);
      let seg2 = txt2.substring(0, Math.min(overlap, len2));
      for (jj = 0; jj < overlap; jj++) {
        let ch1 = jj < len1 ? seg1.substring(jj, jj + 1) : " ";
        let ch2 = jj < len2 ? seg2.substring(jj, jj + 1) : " ";
        if (ch1 !== " " && ch2 !== " ") {
          if (fittingRules.hLayout === FITTING || fittingRules.hLayout === SMUSHING) {
            piece2 += uni_Smush(ch1, ch2, opts.hardBlank);
          } else {
            const nextCh = fittingRules.hRule1 && hRule1_Smush(ch1, ch2, opts.hardBlank) || fittingRules.hRule2 && hRule2_Smush(ch1, ch2) || fittingRules.hRule3 && hRule3_Smush(ch1, ch2) || fittingRules.hRule4 && hRule4_Smush(ch1, ch2) || fittingRules.hRule5 && hRule5_Smush(ch1, ch2) || fittingRules.hRule6 && hRule6_Smush(ch1, ch2, opts.hardBlank) || uni_Smush(ch1, ch2, opts.hardBlank);
            piece2 += nextCh;
          }
        } else {
          piece2 += uni_Smush(ch1, ch2, opts.hardBlank);
        }
      }
      if (overlap >= len2) {
        piece3 = "";
      } else {
        piece3 = txt2.substring(overlap, overlap + Math.max(0, len2 - overlap));
      }
      outputFig[ii] = piece1 + piece2 + piece3;
    }
    return outputFig;
  }
  function newFigChar(len) {
    return new Array(len).fill("");
  }
  const figLinesWidth = function(textLines) {
    return Math.max(...textLines.map((line) => line.length));
  };
  function joinFigArray(array, len, opts) {
    return array.reduce(function(acc, data) {
      return horizontalSmush(acc, data.fig, data.overlap || 0, opts);
    }, newFigChar(len));
  }
  function breakWord(figChars, len, opts) {
    for (let i = figChars.length - 1; i > 0; i--) {
      const w = joinFigArray(figChars.slice(0, i), len, opts);
      if (figLinesWidth(w) <= opts.width) {
        return {
          outputFigText: w,
          chars: figChars.slice(i)
        };
      }
    }
    return { outputFigText: newFigChar(len), chars: figChars };
  }
  function generateFigTextLines(txt, figChars, opts) {
    let charIndex, figChar, overlap = 0, row, outputFigText, len, height = opts.height, outputFigLines = [], maxWidth, nextFigChars = {
      chars: [],
      // list of characters is used to break in the middle of the word when word is longer
      overlap
      // chars is array of characters with {fig, overlap} and overlap is for whole word
    }, figWords = [], char, isSpace, textFigWord, textFigLine, tmpBreak;
    if (typeof height !== "number") {
      throw new Error("height is not defined.");
    }
    outputFigText = newFigChar(height);
    const fittingRules = opts.fittingRules || {};
    if (opts.printDirection === 1) {
      txt = txt.split("").reverse().join("");
    }
    len = txt.length;
    for (charIndex = 0; charIndex < len; charIndex++) {
      char = txt.substring(charIndex, charIndex + 1);
      isSpace = char.match(/\s/);
      figChar = figChars[char.charCodeAt(0)];
      textFigLine = null;
      if (figChar) {
        if (fittingRules.hLayout !== FULL_WIDTH) {
          overlap = 1e4;
          for (row = 0; row < height; row++) {
            overlap = Math.min(
              overlap,
              getHorizontalSmushLength(outputFigText[row], figChar[row], opts)
            );
          }
          overlap = overlap === 1e4 ? 0 : overlap;
        }
        if (opts.width > 0) {
          if (opts.whitespaceBreak) {
            textFigWord = joinFigArray(
              nextFigChars.chars.concat([
                {
                  fig: figChar,
                  overlap
                }
              ]),
              height,
              opts
            );
            textFigLine = joinFigArray(
              figWords.concat([
                {
                  fig: textFigWord,
                  overlap: nextFigChars.overlap
                }
              ]),
              height,
              opts
            );
            maxWidth = figLinesWidth(textFigLine);
          } else {
            textFigLine = horizontalSmush(
              outputFigText,
              figChar,
              overlap,
              opts
            );
            maxWidth = figLinesWidth(textFigLine);
          }
          if (maxWidth >= opts.width && charIndex > 0) {
            if (opts.whitespaceBreak) {
              outputFigText = joinFigArray(figWords.slice(0, -1), height, opts);
              if (figWords.length > 1) {
                outputFigLines.push(outputFigText);
                outputFigText = newFigChar(height);
              }
              figWords = [];
            } else {
              outputFigLines.push(outputFigText);
              outputFigText = newFigChar(height);
            }
          }
        }
        if (opts.width > 0 && opts.whitespaceBreak) {
          if (!isSpace || charIndex === len - 1) {
            nextFigChars.chars.push({ fig: figChar, overlap });
          }
          if (isSpace || charIndex === len - 1) {
            tmpBreak = null;
            while (true) {
              textFigLine = joinFigArray(nextFigChars.chars, height, opts);
              maxWidth = figLinesWidth(textFigLine);
              if (maxWidth >= opts.width) {
                tmpBreak = breakWord(nextFigChars.chars, height, opts);
                nextFigChars = { chars: tmpBreak.chars };
                outputFigLines.push(tmpBreak.outputFigText);
              } else {
                break;
              }
            }
            if (maxWidth > 0) {
              if (tmpBreak) {
                figWords.push({ fig: textFigLine, overlap: 1 });
              } else {
                figWords.push({
                  fig: textFigLine,
                  overlap: nextFigChars.overlap
                });
              }
            }
            if (isSpace) {
              figWords.push({ fig: figChar, overlap });
              outputFigText = newFigChar(height);
            }
            if (charIndex === len - 1) {
              outputFigText = joinFigArray(figWords, height, opts);
            }
            nextFigChars = {
              chars: [],
              overlap
            };
            continue;
          }
        }
        outputFigText = horizontalSmush(outputFigText, figChar, overlap, opts);
      }
    }
    if (figLinesWidth(outputFigText) > 0) {
      outputFigLines.push(outputFigText);
    }
    if (!opts.showHardBlanks) {
      outputFigLines.forEach(function(outputFigText2) {
        len = outputFigText2.length;
        for (row = 0; row < len; row++) {
          outputFigText2[row] = outputFigText2[row].replace(
            new RegExp("\\" + opts.hardBlank, "g"),
            " "
          );
        }
      });
    }
    if (txt === "" && outputFigLines.length === 0) {
      outputFigLines.push(new Array(height).fill(""));
    }
    return outputFigLines;
  }
  const getHorizontalFittingRules = function(layout, options) {
    let params;
    const fittingRules = options.fittingRules || {};
    if (layout === "default") {
      params = {
        hLayout: fittingRules.hLayout,
        hRule1: fittingRules.hRule1,
        hRule2: fittingRules.hRule2,
        hRule3: fittingRules.hRule3,
        hRule4: fittingRules.hRule4,
        hRule5: fittingRules.hRule5,
        hRule6: fittingRules.hRule6
      };
    } else if (layout === "full") {
      params = {
        hLayout: FULL_WIDTH,
        hRule1: false,
        hRule2: false,
        hRule3: false,
        hRule4: false,
        hRule5: false,
        hRule6: false
      };
    } else if (layout === "fitted") {
      params = {
        hLayout: FITTING,
        hRule1: false,
        hRule2: false,
        hRule3: false,
        hRule4: false,
        hRule5: false,
        hRule6: false
      };
    } else if (layout === "controlled smushing") {
      params = {
        hLayout: CONTROLLED_SMUSHING,
        hRule1: true,
        hRule2: true,
        hRule3: true,
        hRule4: true,
        hRule5: true,
        hRule6: true
      };
    } else if (layout === "universal smushing") {
      params = {
        hLayout: SMUSHING,
        hRule1: false,
        hRule2: false,
        hRule3: false,
        hRule4: false,
        hRule5: false,
        hRule6: false
      };
    } else {
      return;
    }
    return params;
  };
  const getVerticalFittingRules = function(layout, options) {
    let params = {};
    const fittingRules = options.fittingRules || {};
    if (layout === "default") {
      params = {
        vLayout: fittingRules.vLayout,
        vRule1: fittingRules.vRule1,
        vRule2: fittingRules.vRule2,
        vRule3: fittingRules.vRule3,
        vRule4: fittingRules.vRule4,
        vRule5: fittingRules.vRule5
      };
    } else if (layout === "full") {
      params = {
        vLayout: FULL_WIDTH,
        vRule1: false,
        vRule2: false,
        vRule3: false,
        vRule4: false,
        vRule5: false
      };
    } else if (layout === "fitted") {
      params = {
        vLayout: FITTING,
        vRule1: false,
        vRule2: false,
        vRule3: false,
        vRule4: false,
        vRule5: false
      };
    } else if (layout === "controlled smushing") {
      params = {
        vLayout: CONTROLLED_SMUSHING,
        vRule1: true,
        vRule2: true,
        vRule3: true,
        vRule4: true,
        vRule5: true
      };
    } else if (layout === "universal smushing") {
      params = {
        vLayout: SMUSHING,
        vRule1: false,
        vRule2: false,
        vRule3: false,
        vRule4: false,
        vRule5: false
      };
    } else {
      return;
    }
    return params;
  };
  const generateText = function(fontName, options, txt) {
    txt = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const actualFontName = getFontName(fontName);
    let lines = txt.split("\n");
    let figLines = [];
    let ii, len, output3;
    len = lines.length;
    for (ii = 0; ii < len; ii++) {
      figLines = figLines.concat(
        generateFigTextLines(lines[ii], figFonts[actualFontName], options)
      );
    }
    len = figLines.length;
    output3 = figLines[0];
    for (ii = 1; ii < len; ii++) {
      output3 = smushVerticalFigLines(output3, figLines[ii], options);
    }
    return output3 ? output3.join("\n") : "";
  };
  function _reworkFontOpts(fontMeta, options) {
    let myOpts;
    if (typeof structuredClone !== "undefined") {
      myOpts = structuredClone(fontMeta);
    } else {
      myOpts = JSON.parse(JSON.stringify(fontMeta));
    }
    myOpts.showHardBlanks = options.showHardBlanks || false;
    myOpts.width = options.width || -1;
    myOpts.whitespaceBreak = options.whitespaceBreak || false;
    if (options.horizontalLayout) {
      const params = getHorizontalFittingRules(
        options.horizontalLayout,
        fontMeta
      );
      if (params) {
        Object.assign(myOpts.fittingRules, params);
      }
    }
    if (options.verticalLayout) {
      const params = getVerticalFittingRules(options.verticalLayout, fontMeta);
      if (params) {
        Object.assign(myOpts.fittingRules, params);
      }
    }
    myOpts.printDirection = options.printDirection !== null && options.printDirection !== void 0 ? options.printDirection : fontMeta.printDirection;
    return myOpts;
  }
  const me = async function(txt, optionsOrFontOrCallback, callback2) {
    return me.text(txt, optionsOrFontOrCallback, callback2);
  };
  me.text = async function(txt, optionsOrFontOrCallback, callback2) {
    txt = txt + "";
    let options, next;
    if (typeof optionsOrFontOrCallback === "function") {
      next = optionsOrFontOrCallback;
      options = { font: figDefaults.font };
    } else if (typeof optionsOrFontOrCallback === "string") {
      options = { font: optionsOrFontOrCallback };
      next = callback2;
    } else if (optionsOrFontOrCallback) {
      options = optionsOrFontOrCallback;
      next = callback2;
    } else {
      options = { font: figDefaults.font };
      next = callback2;
    }
    const fontName = options.font || figDefaults.font;
    try {
      const fontOpts = await me.loadFont(fontName);
      const generatedTxt = fontOpts ? generateText(fontName, _reworkFontOpts(fontOpts, options), txt) : "";
      if (next) {
        next(null, generatedTxt);
      }
      return generatedTxt;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (next) {
        next(error);
        return "";
      }
      throw error;
    }
  };
  me.textSync = function(txt, options) {
    txt = txt + "";
    if (typeof options === "string") {
      options = { font: options };
    } else {
      options = options || {};
    }
    const fontName = options.font || figDefaults.font;
    let fontOpts = _reworkFontOpts(me.loadFontSync(fontName), options);
    return generateText(fontName, fontOpts, txt);
  };
  me.metadata = async function(fontName, callback2) {
    fontName = fontName + "";
    try {
      const fontOpts = await me.loadFont(fontName);
      if (!fontOpts) {
        throw new Error("Error loading font.");
      }
      const actualFontName = getFontName(fontName);
      const font = figFonts[actualFontName] || {};
      const result = [fontOpts, font.comment || ""];
      if (callback2) {
        callback2(null, fontOpts, font.comment);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (callback2) {
        callback2(error);
        return null;
      }
      throw error;
    }
  };
  me.defaults = function(opts) {
    if (opts && typeof opts === "object") {
      Object.assign(figDefaults, opts);
    }
    if (typeof structuredClone !== "undefined") {
      return structuredClone(figDefaults);
    } else {
      return JSON.parse(JSON.stringify(figDefaults));
    }
  };
  me.parseFont = function(fontName, data, override = true) {
    if (figFonts[fontName] && !override) {
      return figFonts[fontName].options;
    }
    data = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const font = new FigletFont();
    const lines = data.split("\n");
    const headerLine = lines.shift();
    if (!headerLine) {
      throw new Error("Invalid font file: missing header");
    }
    const headerData = headerLine.split(" ");
    const opts = {
      hardBlank: headerData[0].substring(5, 6),
      height: parseInt(headerData[1], 10),
      baseline: parseInt(headerData[2], 10),
      maxLength: parseInt(headerData[3], 10),
      oldLayout: parseInt(headerData[4], 10),
      numCommentLines: parseInt(headerData[5], 10),
      printDirection: headerData[6] ? parseInt(headerData[6], 10) : 0,
      fullLayout: headerData[7] ? parseInt(headerData[7], 10) : null,
      codeTagCount: headerData[8] ? parseInt(headerData[8], 10) : null
    };
    const hardBlank = opts.hardBlank || "";
    if (hardBlank.length !== 1 || [
      opts.height,
      opts.baseline,
      opts.maxLength,
      opts.oldLayout,
      opts.numCommentLines
    ].some((val) => val === null || val === void 0 || isNaN(val))) {
      throw new Error("FIGlet header contains invalid values.");
    }
    if (opts.height == null || opts.numCommentLines == null) {
      throw new Error("FIGlet header contains invalid values.");
    }
    opts.fittingRules = getSmushingRules(opts.oldLayout, opts.fullLayout);
    font.options = opts;
    const charNums = [];
    for (let i = 32; i <= 126; i++) {
      charNums.push(i);
    }
    charNums.push(196, 214, 220, 228, 246, 252, 223);
    if (lines.length < opts.numCommentLines + opts.height * charNums.length) {
      throw new Error(
        `FIGlet file is missing data. Line length: ${lines.length}. Comment lines: ${opts.numCommentLines}. Height: ${opts.height}. Num chars: ${charNums.length}.`
      );
    }
    font.comment = lines.splice(0, opts.numCommentLines).join("\n");
    font.numChars = 0;
    while (lines.length > 0 && font.numChars < charNums.length) {
      const cNum = charNums[font.numChars];
      font[cNum] = lines.splice(0, opts.height);
      for (let i = 0; i < opts.height; i++) {
        if (typeof font[cNum][i] === "undefined") {
          font[cNum][i] = "";
        } else {
          font[cNum][i] = removeEndChar(font[cNum][i], i, opts.height);
        }
      }
      font.numChars++;
    }
    while (lines.length > 0) {
      const cNumLine = lines.shift();
      if (!cNumLine || cNumLine.trim() === "") break;
      let cNum = cNumLine.split(" ")[0];
      let parsedNum;
      if (/^-?0[xX][0-9a-fA-F]+$/.test(cNum)) {
        parsedNum = parseInt(cNum, 16);
      } else if (/^-?0[0-7]+$/.test(cNum)) {
        parsedNum = parseInt(cNum, 8);
      } else if (/^-?[0-9]+$/.test(cNum)) {
        parsedNum = parseInt(cNum, 10);
      } else {
        throw new Error(`Error parsing data. Invalid data: ${cNum}`);
      }
      if (parsedNum === -1 || parsedNum < -2147483648 || parsedNum > 2147483647) {
        const msg = parsedNum === -1 ? "The char code -1 is not permitted." : `The char code cannot be ${parsedNum < -2147483648 ? "less than -2147483648" : "greater than 2147483647"}.`;
        throw new Error(`Error parsing data. ${msg}`);
      }
      font[parsedNum] = lines.splice(0, opts.height);
      for (let i = 0; i < opts.height; i++) {
        if (typeof font[parsedNum][i] === "undefined") {
          font[parsedNum][i] = "";
        } else {
          font[parsedNum][i] = removeEndChar(
            font[parsedNum][i],
            i,
            opts.height
          );
        }
      }
      font.numChars++;
    }
    figFonts[fontName] = font;
    return opts;
  };
  me.loadedFonts = () => {
    return Object.keys(figFonts);
  };
  me.clearLoadedFonts = () => {
    Object.keys(figFonts).forEach((key) => {
      delete figFonts[key];
    });
  };
  me.loadFont = async function(fontName, callback2) {
    const actualFontName = getFontName(fontName);
    if (figFonts[actualFontName]) {
      const result = figFonts[actualFontName].options;
      if (callback2) {
        callback2(null, result);
      }
      return Promise.resolve(result);
    }
    try {
      if (!figDefaults.fetchFontIfMissing) {
        throw new Error(`Font is not loaded: ${actualFontName}`);
      }
      const response = await fetch(
        `${figDefaults.fontPath}/${actualFontName}.flf`
      );
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.status}`);
      }
      const text = await response.text();
      const result = me.parseFont(actualFontName, text);
      if (callback2) {
        callback2(null, result);
      }
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (callback2) {
        callback2(err);
        return null;
      }
      throw err;
    }
  };
  me.loadFontSync = function(name) {
    const actualFontName = getFontName(name);
    if (figFonts[actualFontName]) {
      return figFonts[actualFontName].options;
    }
    throw new Error(
      "Synchronous font loading is not implemented for the browser, it will only work for fonts already loaded."
    );
  };
  me.preloadFonts = async function(fonts, callback2) {
    try {
      for (const name of fonts) {
        const actualFontName = getFontName(name);
        const response = await fetch(
          `${figDefaults.fontPath}/${actualFontName}.flf`
        );
        if (!response.ok) {
          throw new Error(
            `Failed to preload fonts. Error fetching font: ${actualFontName}, status code: ${response.statusText}`
          );
        }
        const data = await response.text();
        me.parseFont(actualFontName, data);
      }
      if (callback2) {
        callback2();
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (callback2) {
        callback2(err);
        return;
      }
      throw error;
    }
  };
  me.fonts = function(callback2) {
    return new Promise(function(resolve4, reject) {
      resolve4(fontList);
      if (callback2) {
        callback2(null, fontList);
      }
    });
  };
  me.fontsSync = function() {
    return fontList;
  };
  me.figFonts = figFonts;
  return me;
})();

// ../../node_modules/.pnpm/figlet@1.11.0/node_modules/figlet/dist/node-figlet.mjs
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
var fontPath = path2.join(__dirname, "/../fonts/");
var nodeFiglet = figlet;
nodeFiglet.defaults({ fontPath });
nodeFiglet.loadFont = function(name, callback2) {
  const actualFontName = getFontName(name);
  return new Promise((resolve4, reject) => {
    if (nodeFiglet.figFonts[actualFontName]) {
      if (callback2) {
        callback2(null, nodeFiglet.figFonts[actualFontName].options);
      }
      resolve4(nodeFiglet.figFonts[actualFontName].options);
      return;
    }
    fs.readFile(
      path2.join(nodeFiglet.defaults().fontPath, actualFontName + ".flf"),
      { encoding: "utf-8" },
      (err, fontData) => {
        if (err) {
          if (callback2) {
            callback2(err);
          }
          reject(err);
          return;
        }
        fontData = fontData + "";
        try {
          const font = nodeFiglet.parseFont(
            actualFontName,
            fontData
          );
          if (callback2) {
            callback2(null, font);
          }
          resolve4(font);
        } catch (error) {
          const typedError = error instanceof Error ? error : new Error(String(error));
          if (callback2) {
            callback2(typedError);
          }
          reject(typedError);
        }
      }
    );
  });
};
nodeFiglet.loadFontSync = function(font) {
  const actualFontName = getFontName(font);
  if (nodeFiglet.figFonts[actualFontName]) {
    return nodeFiglet.figFonts[actualFontName].options;
  }
  const fontData = fs.readFileSync(
    path2.join(nodeFiglet.defaults().fontPath, actualFontName + ".flf"),
    {
      encoding: "utf-8"
    }
  ) + "";
  return nodeFiglet.parseFont(actualFontName, fontData);
};
nodeFiglet.fonts = function(next) {
  return new Promise((resolve4, reject) => {
    const fontList2 = [];
    fs.readdir(
      nodeFiglet.defaults().fontPath,
      (err, files) => {
        if (err) {
          next && next(err);
          reject(err);
          return;
        }
        files.forEach((file) => {
          if (/\.flf$/.test(file)) {
            fontList2.push(file.replace(/\.flf$/, ""));
          }
        });
        next && next(null, fontList2);
        resolve4(fontList2);
      }
    );
  });
};
nodeFiglet.fontsSync = function() {
  const fontList2 = [];
  fs.readdirSync(nodeFiglet.defaults().fontPath).forEach((file) => {
    if (/\.flf$/.test(file)) {
      fontList2.push(file.replace(/\.flf$/, ""));
    }
  });
  return fontList2;
};

// ../version/dist/chunk-UBCKZYTO.js
import fs6 from "fs";
import path52 from "path";
import fs5 from "fs";
import path42 from "path";
import * as TOML2 from "smol-toml";
var import_semver5 = __toESM(require_semver(), 1);
import * as fs9 from "fs";
import path72 from "path";

// ../../node_modules/.pnpm/balanced-match@4.0.4/node_modules/balanced-match/dist/esm/index.js
var balanced = (a, b, str2) => {
  const ma = a instanceof RegExp ? maybeMatch(a, str2) : a;
  const mb = b instanceof RegExp ? maybeMatch(b, str2) : b;
  const r = ma !== null && mb != null && range(ma, mb, str2);
  return r && {
    start: r[0],
    end: r[1],
    pre: str2.slice(0, r[0]),
    body: str2.slice(r[0] + ma.length, r[1]),
    post: str2.slice(r[1] + mb.length)
  };
};
var maybeMatch = (reg, str2) => {
  const m = str2.match(reg);
  return m ? m[0] : null;
};
var range = (a, b, str2) => {
  let begs, beg, left, right = void 0, result;
  let ai = str2.indexOf(a);
  let bi = str2.indexOf(b, ai + 1);
  let i = ai;
  if (ai >= 0 && bi > 0) {
    if (a === b) {
      return [ai, bi];
    }
    begs = [];
    left = str2.length;
    while (i >= 0 && !result) {
      if (i === ai) {
        begs.push(i);
        ai = str2.indexOf(a, i + 1);
      } else if (begs.length === 1) {
        const r = begs.pop();
        if (r !== void 0)
          result = [r, bi];
      } else {
        beg = begs.pop();
        if (beg !== void 0 && beg < left) {
          left = beg;
          right = bi;
        }
        bi = str2.indexOf(b, i + 1);
      }
      i = ai < bi && ai >= 0 ? ai : bi;
    }
    if (begs.length && right !== void 0) {
      result = [left, right];
    }
  }
  return result;
};

// ../../node_modules/.pnpm/brace-expansion@5.0.5/node_modules/brace-expansion/dist/esm/index.js
var escSlash = "\0SLASH" + Math.random() + "\0";
var escOpen = "\0OPEN" + Math.random() + "\0";
var escClose = "\0CLOSE" + Math.random() + "\0";
var escComma = "\0COMMA" + Math.random() + "\0";
var escPeriod = "\0PERIOD" + Math.random() + "\0";
var escSlashPattern = new RegExp(escSlash, "g");
var escOpenPattern = new RegExp(escOpen, "g");
var escClosePattern = new RegExp(escClose, "g");
var escCommaPattern = new RegExp(escComma, "g");
var escPeriodPattern = new RegExp(escPeriod, "g");
var slashPattern = /\\\\/g;
var openPattern = /\\{/g;
var closePattern = /\\}/g;
var commaPattern = /\\,/g;
var periodPattern = /\\\./g;
var EXPANSION_MAX = 1e5;
function numeric(str2) {
  return !isNaN(str2) ? parseInt(str2, 10) : str2.charCodeAt(0);
}
function escapeBraces(str2) {
  return str2.replace(slashPattern, escSlash).replace(openPattern, escOpen).replace(closePattern, escClose).replace(commaPattern, escComma).replace(periodPattern, escPeriod);
}
function unescapeBraces(str2) {
  return str2.replace(escSlashPattern, "\\").replace(escOpenPattern, "{").replace(escClosePattern, "}").replace(escCommaPattern, ",").replace(escPeriodPattern, ".");
}
function parseCommaParts(str2) {
  if (!str2) {
    return [""];
  }
  const parts = [];
  const m = balanced("{", "}", str2);
  if (!m) {
    return str2.split(",");
  }
  const { pre, body, post } = m;
  const p = pre.split(",");
  p[p.length - 1] += "{" + body + "}";
  const postParts = parseCommaParts(post);
  if (post.length) {
    ;
    p[p.length - 1] += postParts.shift();
    p.push.apply(p, postParts);
  }
  parts.push.apply(parts, p);
  return parts;
}
function expand(str2, options = {}) {
  if (!str2) {
    return [];
  }
  const { max = EXPANSION_MAX } = options;
  if (str2.slice(0, 2) === "{}") {
    str2 = "\\{\\}" + str2.slice(2);
  }
  return expand_(escapeBraces(str2), max, true).map(unescapeBraces);
}
function embrace(str2) {
  return "{" + str2 + "}";
}
function isPadded(el) {
  return /^-?0\d/.test(el);
}
function lte(i, y) {
  return i <= y;
}
function gte(i, y) {
  return i >= y;
}
function expand_(str2, max, isTop) {
  const expansions = [];
  const m = balanced("{", "}", str2);
  if (!m)
    return [str2];
  const pre = m.pre;
  const post = m.post.length ? expand_(m.post, max, false) : [""];
  if (/\$$/.test(m.pre)) {
    for (let k = 0; k < post.length && k < max; k++) {
      const expansion = pre + "{" + m.body + "}" + post[k];
      expansions.push(expansion);
    }
  } else {
    const isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
    const isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
    const isSequence = isNumericSequence || isAlphaSequence;
    const isOptions = m.body.indexOf(",") >= 0;
    if (!isSequence && !isOptions) {
      if (m.post.match(/,(?!,).*\}/)) {
        str2 = m.pre + "{" + m.body + escClose + m.post;
        return expand_(str2, max, true);
      }
      return [str2];
    }
    let n;
    if (isSequence) {
      n = m.body.split(/\.\./);
    } else {
      n = parseCommaParts(m.body);
      if (n.length === 1 && n[0] !== void 0) {
        n = expand_(n[0], max, false).map(embrace);
        if (n.length === 1) {
          return post.map((p) => m.pre + n[0] + p);
        }
      }
    }
    let N;
    if (isSequence && n[0] !== void 0 && n[1] !== void 0) {
      const x = numeric(n[0]);
      const y = numeric(n[1]);
      const width = Math.max(n[0].length, n[1].length);
      let incr = n.length === 3 && n[2] !== void 0 ? Math.max(Math.abs(numeric(n[2])), 1) : 1;
      let test = lte;
      const reverse = y < x;
      if (reverse) {
        incr *= -1;
        test = gte;
      }
      const pad = n.some(isPadded);
      N = [];
      for (let i = x; test(i, y); i += incr) {
        let c;
        if (isAlphaSequence) {
          c = String.fromCharCode(i);
          if (c === "\\") {
            c = "";
          }
        } else {
          c = String(i);
          if (pad) {
            const need = width - c.length;
            if (need > 0) {
              const z3 = new Array(need + 1).join("0");
              if (i < 0) {
                c = "-" + z3 + c.slice(1);
              } else {
                c = z3 + c;
              }
            }
          }
        }
        N.push(c);
      }
    } else {
      N = [];
      for (let j = 0; j < n.length; j++) {
        N.push.apply(N, expand_(n[j], max, false));
      }
    }
    for (let j = 0; j < N.length; j++) {
      for (let k = 0; k < post.length && expansions.length < max; k++) {
        const expansion = pre + N[j] + post[k];
        if (!isTop || isSequence || expansion) {
          expansions.push(expansion);
        }
      }
    }
  }
  return expansions;
}

// ../../node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/assert-valid-pattern.js
var MAX_PATTERN_LENGTH = 1024 * 64;
var assertValidPattern = (pattern) => {
  if (typeof pattern !== "string") {
    throw new TypeError("invalid pattern");
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new TypeError("pattern is too long");
  }
};

// ../../node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/brace-expressions.js
var posixClasses = {
  "[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}", true],
  "[:alpha:]": ["\\p{L}\\p{Nl}", true],
  "[:ascii:]": ["\\x00-\\x7f", false],
  "[:blank:]": ["\\p{Zs}\\t", true],
  "[:cntrl:]": ["\\p{Cc}", true],
  "[:digit:]": ["\\p{Nd}", true],
  "[:graph:]": ["\\p{Z}\\p{C}", true, true],
  "[:lower:]": ["\\p{Ll}", true],
  "[:print:]": ["\\p{C}", true],
  "[:punct:]": ["\\p{P}", true],
  "[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f", true],
  "[:upper:]": ["\\p{Lu}", true],
  "[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", true],
  "[:xdigit:]": ["A-Fa-f0-9", false]
};
var braceEscape = (s) => s.replace(/[[\]\\-]/g, "\\$&");
var regexpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var rangesToString = (ranges) => ranges.join("");
var parseClass = (glob2, position) => {
  const pos = position;
  if (glob2.charAt(pos) !== "[") {
    throw new Error("not in a brace expression");
  }
  const ranges = [];
  const negs = [];
  let i = pos + 1;
  let sawStart = false;
  let uflag = false;
  let escaping = false;
  let negate = false;
  let endPos = pos;
  let rangeStart = "";
  WHILE: while (i < glob2.length) {
    const c = glob2.charAt(i);
    if ((c === "!" || c === "^") && i === pos + 1) {
      negate = true;
      i++;
      continue;
    }
    if (c === "]" && sawStart && !escaping) {
      endPos = i + 1;
      break;
    }
    sawStart = true;
    if (c === "\\") {
      if (!escaping) {
        escaping = true;
        i++;
        continue;
      }
    }
    if (c === "[" && !escaping) {
      for (const [cls, [unip, u, neg]] of Object.entries(posixClasses)) {
        if (glob2.startsWith(cls, i)) {
          if (rangeStart) {
            return ["$.", false, glob2.length - pos, true];
          }
          i += cls.length;
          if (neg)
            negs.push(unip);
          else
            ranges.push(unip);
          uflag = uflag || u;
          continue WHILE;
        }
      }
    }
    escaping = false;
    if (rangeStart) {
      if (c > rangeStart) {
        ranges.push(braceEscape(rangeStart) + "-" + braceEscape(c));
      } else if (c === rangeStart) {
        ranges.push(braceEscape(c));
      }
      rangeStart = "";
      i++;
      continue;
    }
    if (glob2.startsWith("-]", i + 1)) {
      ranges.push(braceEscape(c + "-"));
      i += 2;
      continue;
    }
    if (glob2.startsWith("-", i + 1)) {
      rangeStart = c;
      i += 2;
      continue;
    }
    ranges.push(braceEscape(c));
    i++;
  }
  if (endPos < i) {
    return ["", false, 0, false];
  }
  if (!ranges.length && !negs.length) {
    return ["$.", false, glob2.length - pos, true];
  }
  if (negs.length === 0 && ranges.length === 1 && /^\\?.$/.test(ranges[0]) && !negate) {
    const r = ranges[0].length === 2 ? ranges[0].slice(-1) : ranges[0];
    return [regexpEscape(r), false, endPos - pos, false];
  }
  const sranges = "[" + (negate ? "^" : "") + rangesToString(ranges) + "]";
  const snegs = "[" + (negate ? "" : "^") + rangesToString(negs) + "]";
  const comb = ranges.length && negs.length ? "(" + sranges + "|" + snegs + ")" : ranges.length ? sranges : snegs;
  return [comb, uflag, endPos - pos, true];
};

// ../../node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/unescape.js
var unescape = (s, { windowsPathsNoEscape = false, magicalBraces = true } = {}) => {
  if (magicalBraces) {
    return windowsPathsNoEscape ? s.replace(/\[([^/\\])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\])\]/g, "$1$2").replace(/\\([^/])/g, "$1");
  }
  return windowsPathsNoEscape ? s.replace(/\[([^/\\{}])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\{}])\]/g, "$1$2").replace(/\\([^/{}])/g, "$1");
};

// ../../node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/ast.js
var _a;
var types = /* @__PURE__ */ new Set(["!", "?", "+", "*", "@"]);
var isExtglobType = (c) => types.has(c);
var isExtglobAST = (c) => isExtglobType(c.type);
var adoptionMap = /* @__PURE__ */ new Map([
  ["!", ["@"]],
  ["?", ["?", "@"]],
  ["@", ["@"]],
  ["*", ["*", "+", "?", "@"]],
  ["+", ["+", "@"]]
]);
var adoptionWithSpaceMap = /* @__PURE__ */ new Map([
  ["!", ["?"]],
  ["@", ["?"]],
  ["+", ["?", "*"]]
]);
var adoptionAnyMap = /* @__PURE__ */ new Map([
  ["!", ["?", "@"]],
  ["?", ["?", "@"]],
  ["@", ["?", "@"]],
  ["*", ["*", "+", "?", "@"]],
  ["+", ["+", "@", "?", "*"]]
]);
var usurpMap = /* @__PURE__ */ new Map([
  ["!", /* @__PURE__ */ new Map([["!", "@"]])],
  [
    "?",
    /* @__PURE__ */ new Map([
      ["*", "*"],
      ["+", "*"]
    ])
  ],
  [
    "@",
    /* @__PURE__ */ new Map([
      ["!", "!"],
      ["?", "?"],
      ["@", "@"],
      ["*", "*"],
      ["+", "+"]
    ])
  ],
  [
    "+",
    /* @__PURE__ */ new Map([
      ["?", "*"],
      ["*", "*"]
    ])
  ]
]);
var startNoTraversal = "(?!(?:^|/)\\.\\.?(?:$|/))";
var startNoDot = "(?!\\.)";
var addPatternStart = /* @__PURE__ */ new Set(["[", "."]);
var justDots = /* @__PURE__ */ new Set(["..", "."]);
var reSpecials = new Set("().*{}+?[]^$\\!");
var regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var qmark = "[^/]";
var star = qmark + "*?";
var starNoEmpty = qmark + "+?";
var ID = 0;
var AST = class {
  type;
  #root;
  #hasMagic;
  #uflag = false;
  #parts = [];
  #parent;
  #parentIndex;
  #negs;
  #filledNegs = false;
  #options;
  #toString;
  // set to true if it's an extglob with no children
  // (which really means one child of '')
  #emptyExt = false;
  id = ++ID;
  get depth() {
    return (this.#parent?.depth ?? -1) + 1;
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return {
      "@@type": "AST",
      id: this.id,
      type: this.type,
      root: this.#root.id,
      parent: this.#parent?.id,
      depth: this.depth,
      partsLength: this.#parts.length,
      parts: this.#parts
    };
  }
  constructor(type2, parent, options = {}) {
    this.type = type2;
    if (type2)
      this.#hasMagic = true;
    this.#parent = parent;
    this.#root = this.#parent ? this.#parent.#root : this;
    this.#options = this.#root === this ? options : this.#root.#options;
    this.#negs = this.#root === this ? [] : this.#root.#negs;
    if (type2 === "!" && !this.#root.#filledNegs)
      this.#negs.push(this);
    this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
  }
  get hasMagic() {
    if (this.#hasMagic !== void 0)
      return this.#hasMagic;
    for (const p of this.#parts) {
      if (typeof p === "string")
        continue;
      if (p.type || p.hasMagic)
        return this.#hasMagic = true;
    }
    return this.#hasMagic;
  }
  // reconstructs the pattern
  toString() {
    return this.#toString !== void 0 ? this.#toString : !this.type ? this.#toString = this.#parts.map((p) => String(p)).join("") : this.#toString = this.type + "(" + this.#parts.map((p) => String(p)).join("|") + ")";
  }
  #fillNegs() {
    if (this !== this.#root)
      throw new Error("should only call on root");
    if (this.#filledNegs)
      return this;
    this.toString();
    this.#filledNegs = true;
    let n;
    while (n = this.#negs.pop()) {
      if (n.type !== "!")
        continue;
      let p = n;
      let pp = p.#parent;
      while (pp) {
        for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) {
          for (const part of n.#parts) {
            if (typeof part === "string") {
              throw new Error("string part in extglob AST??");
            }
            part.copyIn(pp.#parts[i]);
          }
        }
        p = pp;
        pp = p.#parent;
      }
    }
    return this;
  }
  push(...parts) {
    for (const p of parts) {
      if (p === "")
        continue;
      if (typeof p !== "string" && !(p instanceof _a && p.#parent === this)) {
        throw new Error("invalid part: " + p);
      }
      this.#parts.push(p);
    }
  }
  toJSON() {
    const ret = this.type === null ? this.#parts.slice().map((p) => typeof p === "string" ? p : p.toJSON()) : [this.type, ...this.#parts.map((p) => p.toJSON())];
    if (this.isStart() && !this.type)
      ret.unshift([]);
    if (this.isEnd() && (this === this.#root || this.#root.#filledNegs && this.#parent?.type === "!")) {
      ret.push({});
    }
    return ret;
  }
  isStart() {
    if (this.#root === this)
      return true;
    if (!this.#parent?.isStart())
      return false;
    if (this.#parentIndex === 0)
      return true;
    const p = this.#parent;
    for (let i = 0; i < this.#parentIndex; i++) {
      const pp = p.#parts[i];
      if (!(pp instanceof _a && pp.type === "!")) {
        return false;
      }
    }
    return true;
  }
  isEnd() {
    if (this.#root === this)
      return true;
    if (this.#parent?.type === "!")
      return true;
    if (!this.#parent?.isEnd())
      return false;
    if (!this.type)
      return this.#parent?.isEnd();
    const pl = this.#parent ? this.#parent.#parts.length : 0;
    return this.#parentIndex === pl - 1;
  }
  copyIn(part) {
    if (typeof part === "string")
      this.push(part);
    else
      this.push(part.clone(this));
  }
  clone(parent) {
    const c = new _a(this.type, parent);
    for (const p of this.#parts) {
      c.copyIn(p);
    }
    return c;
  }
  static #parseAST(str2, ast, pos, opt, extDepth) {
    const maxDepth = opt.maxExtglobRecursion ?? 2;
    let escaping = false;
    let inBrace = false;
    let braceStart = -1;
    let braceNeg = false;
    if (ast.type === null) {
      let i2 = pos;
      let acc2 = "";
      while (i2 < str2.length) {
        const c = str2.charAt(i2++);
        if (escaping || c === "\\") {
          escaping = !escaping;
          acc2 += c;
          continue;
        }
        if (inBrace) {
          if (i2 === braceStart + 1) {
            if (c === "^" || c === "!") {
              braceNeg = true;
            }
          } else if (c === "]" && !(i2 === braceStart + 2 && braceNeg)) {
            inBrace = false;
          }
          acc2 += c;
          continue;
        } else if (c === "[") {
          inBrace = true;
          braceStart = i2;
          braceNeg = false;
          acc2 += c;
          continue;
        }
        const doRecurse = !opt.noext && isExtglobType(c) && str2.charAt(i2) === "(" && extDepth <= maxDepth;
        if (doRecurse) {
          ast.push(acc2);
          acc2 = "";
          const ext2 = new _a(c, ast);
          i2 = _a.#parseAST(str2, ext2, i2, opt, extDepth + 1);
          ast.push(ext2);
          continue;
        }
        acc2 += c;
      }
      ast.push(acc2);
      return i2;
    }
    let i = pos + 1;
    let part = new _a(null, ast);
    const parts = [];
    let acc = "";
    while (i < str2.length) {
      const c = str2.charAt(i++);
      if (escaping || c === "\\") {
        escaping = !escaping;
        acc += c;
        continue;
      }
      if (inBrace) {
        if (i === braceStart + 1) {
          if (c === "^" || c === "!") {
            braceNeg = true;
          }
        } else if (c === "]" && !(i === braceStart + 2 && braceNeg)) {
          inBrace = false;
        }
        acc += c;
        continue;
      } else if (c === "[") {
        inBrace = true;
        braceStart = i;
        braceNeg = false;
        acc += c;
        continue;
      }
      const doRecurse = !opt.noext && isExtglobType(c) && str2.charAt(i) === "(" && /* c8 ignore start - the maxDepth is sufficient here */
      (extDepth <= maxDepth || ast && ast.#canAdoptType(c));
      if (doRecurse) {
        const depthAdd = ast && ast.#canAdoptType(c) ? 0 : 1;
        part.push(acc);
        acc = "";
        const ext2 = new _a(c, part);
        part.push(ext2);
        i = _a.#parseAST(str2, ext2, i, opt, extDepth + depthAdd);
        continue;
      }
      if (c === "|") {
        part.push(acc);
        acc = "";
        parts.push(part);
        part = new _a(null, ast);
        continue;
      }
      if (c === ")") {
        if (acc === "" && ast.#parts.length === 0) {
          ast.#emptyExt = true;
        }
        part.push(acc);
        acc = "";
        ast.push(...parts, part);
        return i;
      }
      acc += c;
    }
    ast.type = null;
    ast.#hasMagic = void 0;
    ast.#parts = [str2.substring(pos - 1)];
    return i;
  }
  #canAdoptWithSpace(child) {
    return this.#canAdopt(child, adoptionWithSpaceMap);
  }
  #canAdopt(child, map2 = adoptionMap) {
    if (!child || typeof child !== "object" || child.type !== null || child.#parts.length !== 1 || this.type === null) {
      return false;
    }
    const gc = child.#parts[0];
    if (!gc || typeof gc !== "object" || gc.type === null) {
      return false;
    }
    return this.#canAdoptType(gc.type, map2);
  }
  #canAdoptType(c, map2 = adoptionAnyMap) {
    return !!map2.get(this.type)?.includes(c);
  }
  #adoptWithSpace(child, index) {
    const gc = child.#parts[0];
    const blank = new _a(null, gc, this.options);
    blank.#parts.push("");
    gc.push(blank);
    this.#adopt(child, index);
  }
  #adopt(child, index) {
    const gc = child.#parts[0];
    this.#parts.splice(index, 1, ...gc.#parts);
    for (const p of gc.#parts) {
      if (typeof p === "object")
        p.#parent = this;
    }
    this.#toString = void 0;
  }
  #canUsurpType(c) {
    const m = usurpMap.get(this.type);
    return !!m?.has(c);
  }
  #canUsurp(child) {
    if (!child || typeof child !== "object" || child.type !== null || child.#parts.length !== 1 || this.type === null || this.#parts.length !== 1) {
      return false;
    }
    const gc = child.#parts[0];
    if (!gc || typeof gc !== "object" || gc.type === null) {
      return false;
    }
    return this.#canUsurpType(gc.type);
  }
  #usurp(child) {
    const m = usurpMap.get(this.type);
    const gc = child.#parts[0];
    const nt = m?.get(gc.type);
    if (!nt)
      return false;
    this.#parts = gc.#parts;
    for (const p of this.#parts) {
      if (typeof p === "object") {
        p.#parent = this;
      }
    }
    this.type = nt;
    this.#toString = void 0;
    this.#emptyExt = false;
  }
  static fromGlob(pattern, options = {}) {
    const ast = new _a(null, void 0, options);
    _a.#parseAST(pattern, ast, 0, options, 0);
    return ast;
  }
  // returns the regular expression if there's magic, or the unescaped
  // string if not.
  toMMPattern() {
    if (this !== this.#root)
      return this.#root.toMMPattern();
    const glob2 = this.toString();
    const [re, body, hasMagic, uflag] = this.toRegExpSource();
    const anyMagic = hasMagic || this.#hasMagic || this.#options.nocase && !this.#options.nocaseMagicOnly && glob2.toUpperCase() !== glob2.toLowerCase();
    if (!anyMagic) {
      return body;
    }
    const flags = (this.#options.nocase ? "i" : "") + (uflag ? "u" : "");
    return Object.assign(new RegExp(`^${re}$`, flags), {
      _src: re,
      _glob: glob2
    });
  }
  get options() {
    return this.#options;
  }
  // returns the string match, the regexp source, whether there's magic
  // in the regexp (so a regular expression is required) and whether or
  // not the uflag is needed for the regular expression (for posix classes)
  // TODO: instead of injecting the start/end at this point, just return
  // the BODY of the regexp, along with the start/end portions suitable
  // for binding the start/end in either a joined full-path makeRe context
  // (where we bind to (^|/), or a standalone matchPart context (where
  // we bind to ^, and not /).  Otherwise slashes get duped!
  //
  // In part-matching mode, the start is:
  // - if not isStart: nothing
  // - if traversal possible, but not allowed: ^(?!\.\.?$)
  // - if dots allowed or not possible: ^
  // - if dots possible and not allowed: ^(?!\.)
  // end is:
  // - if not isEnd(): nothing
  // - else: $
  //
  // In full-path matching mode, we put the slash at the START of the
  // pattern, so start is:
  // - if first pattern: same as part-matching mode
  // - if not isStart(): nothing
  // - if traversal possible, but not allowed: /(?!\.\.?(?:$|/))
  // - if dots allowed or not possible: /
  // - if dots possible and not allowed: /(?!\.)
  // end is:
  // - if last pattern, same as part-matching mode
  // - else nothing
  //
  // Always put the (?:$|/) on negated tails, though, because that has to be
  // there to bind the end of the negated pattern portion, and it's easier to
  // just stick it in now rather than try to inject it later in the middle of
  // the pattern.
  //
  // We can just always return the same end, and leave it up to the caller
  // to know whether it's going to be used joined or in parts.
  // And, if the start is adjusted slightly, can do the same there:
  // - if not isStart: nothing
  // - if traversal possible, but not allowed: (?:/|^)(?!\.\.?$)
  // - if dots allowed or not possible: (?:/|^)
  // - if dots possible and not allowed: (?:/|^)(?!\.)
  //
  // But it's better to have a simpler binding without a conditional, for
  // performance, so probably better to return both start options.
  //
  // Then the caller just ignores the end if it's not the first pattern,
  // and the start always gets applied.
  //
  // But that's always going to be $ if it's the ending pattern, or nothing,
  // so the caller can just attach $ at the end of the pattern when building.
  //
  // So the todo is:
  // - better detect what kind of start is needed
  // - return both flavors of starting pattern
  // - attach $ at the end of the pattern when creating the actual RegExp
  //
  // Ah, but wait, no, that all only applies to the root when the first pattern
  // is not an extglob. If the first pattern IS an extglob, then we need all
  // that dot prevention biz to live in the extglob portions, because eg
  // +(*|.x*) can match .xy but not .yx.
  //
  // So, return the two flavors if it's #root and the first child is not an
  // AST, otherwise leave it to the child AST to handle it, and there,
  // use the (?:^|/) style of start binding.
  //
  // Even simplified further:
  // - Since the start for a join is eg /(?!\.) and the start for a part
  // is ^(?!\.), we can just prepend (?!\.) to the pattern (either root
  // or start or whatever) and prepend ^ or / at the Regexp construction.
  toRegExpSource(allowDot) {
    const dot = allowDot ?? !!this.#options.dot;
    if (this.#root === this) {
      this.#flatten();
      this.#fillNegs();
    }
    if (!isExtglobAST(this)) {
      const noEmpty = this.isStart() && this.isEnd() && !this.#parts.some((s) => typeof s !== "string");
      const src = this.#parts.map((p) => {
        const [re, _, hasMagic, uflag] = typeof p === "string" ? _a.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot);
        this.#hasMagic = this.#hasMagic || hasMagic;
        this.#uflag = this.#uflag || uflag;
        return re;
      }).join("");
      let start2 = "";
      if (this.isStart()) {
        if (typeof this.#parts[0] === "string") {
          const dotTravAllowed = this.#parts.length === 1 && justDots.has(this.#parts[0]);
          if (!dotTravAllowed) {
            const aps = addPatternStart;
            const needNoTrav = (
              // dots are allowed, and the pattern starts with [ or .
              dot && aps.has(src.charAt(0)) || // the pattern starts with \., and then [ or .
              src.startsWith("\\.") && aps.has(src.charAt(2)) || // the pattern starts with \.\., and then [ or .
              src.startsWith("\\.\\.") && aps.has(src.charAt(4))
            );
            const needNoDot = !dot && !allowDot && aps.has(src.charAt(0));
            start2 = needNoTrav ? startNoTraversal : needNoDot ? startNoDot : "";
          }
        }
      }
      let end = "";
      if (this.isEnd() && this.#root.#filledNegs && this.#parent?.type === "!") {
        end = "(?:$|\\/)";
      }
      const final2 = start2 + src + end;
      return [
        final2,
        unescape(src),
        this.#hasMagic = !!this.#hasMagic,
        this.#uflag
      ];
    }
    const repeated = this.type === "*" || this.type === "+";
    const start = this.type === "!" ? "(?:(?!(?:" : "(?:";
    let body = this.#partsToRegExp(dot);
    if (this.isStart() && this.isEnd() && !body && this.type !== "!") {
      const s = this.toString();
      const me = this;
      me.#parts = [s];
      me.type = null;
      me.#hasMagic = void 0;
      return [s, unescape(this.toString()), false, false];
    }
    let bodyDotAllowed = !repeated || allowDot || dot || !startNoDot ? "" : this.#partsToRegExp(true);
    if (bodyDotAllowed === body) {
      bodyDotAllowed = "";
    }
    if (bodyDotAllowed) {
      body = `(?:${body})(?:${bodyDotAllowed})*?`;
    }
    let final = "";
    if (this.type === "!" && this.#emptyExt) {
      final = (this.isStart() && !dot ? startNoDot : "") + starNoEmpty;
    } else {
      const close = this.type === "!" ? (
        // !() must match something,but !(x) can match ''
        "))" + (this.isStart() && !dot && !allowDot ? startNoDot : "") + star + ")"
      ) : this.type === "@" ? ")" : this.type === "?" ? ")?" : this.type === "+" && bodyDotAllowed ? ")" : this.type === "*" && bodyDotAllowed ? `)?` : `)${this.type}`;
      final = start + body + close;
    }
    return [
      final,
      unescape(body),
      this.#hasMagic = !!this.#hasMagic,
      this.#uflag
    ];
  }
  #flatten() {
    if (!isExtglobAST(this)) {
      for (const p of this.#parts) {
        if (typeof p === "object") {
          p.#flatten();
        }
      }
    } else {
      let iterations = 0;
      let done = false;
      do {
        done = true;
        for (let i = 0; i < this.#parts.length; i++) {
          const c = this.#parts[i];
          if (typeof c === "object") {
            c.#flatten();
            if (this.#canAdopt(c)) {
              done = false;
              this.#adopt(c, i);
            } else if (this.#canAdoptWithSpace(c)) {
              done = false;
              this.#adoptWithSpace(c, i);
            } else if (this.#canUsurp(c)) {
              done = false;
              this.#usurp(c);
            }
          }
        }
      } while (!done && ++iterations < 10);
    }
    this.#toString = void 0;
  }
  #partsToRegExp(dot) {
    return this.#parts.map((p) => {
      if (typeof p === "string") {
        throw new Error("string type in extglob ast??");
      }
      const [re, _, _hasMagic, uflag] = p.toRegExpSource(dot);
      this.#uflag = this.#uflag || uflag;
      return re;
    }).filter((p) => !(this.isStart() && this.isEnd()) || !!p).join("|");
  }
  static #parseGlob(glob2, hasMagic, noEmpty = false) {
    let escaping = false;
    let re = "";
    let uflag = false;
    let inStar = false;
    for (let i = 0; i < glob2.length; i++) {
      const c = glob2.charAt(i);
      if (escaping) {
        escaping = false;
        re += (reSpecials.has(c) ? "\\" : "") + c;
        continue;
      }
      if (c === "*") {
        if (inStar)
          continue;
        inStar = true;
        re += noEmpty && /^[*]+$/.test(glob2) ? starNoEmpty : star;
        hasMagic = true;
        continue;
      } else {
        inStar = false;
      }
      if (c === "\\") {
        if (i === glob2.length - 1) {
          re += "\\\\";
        } else {
          escaping = true;
        }
        continue;
      }
      if (c === "[") {
        const [src, needUflag, consumed, magic] = parseClass(glob2, i);
        if (consumed) {
          re += src;
          uflag = uflag || needUflag;
          i += consumed - 1;
          hasMagic = hasMagic || magic;
          continue;
        }
      }
      if (c === "?") {
        re += qmark;
        hasMagic = true;
        continue;
      }
      re += regExpEscape(c);
    }
    return [re, unescape(glob2), !!hasMagic, uflag];
  }
};
_a = AST;

// ../../node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/escape.js
var escape = (s, { windowsPathsNoEscape = false, magicalBraces = false } = {}) => {
  if (magicalBraces) {
    return windowsPathsNoEscape ? s.replace(/[?*()[\]{}]/g, "[$&]") : s.replace(/[?*()[\]\\{}]/g, "\\$&");
  }
  return windowsPathsNoEscape ? s.replace(/[?*()[\]]/g, "[$&]") : s.replace(/[?*()[\]\\]/g, "\\$&");
};

// ../../node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/index.js
var minimatch = (p, pattern, options = {}) => {
  assertValidPattern(pattern);
  if (!options.nocomment && pattern.charAt(0) === "#") {
    return false;
  }
  return new Minimatch(pattern, options).match(p);
};
var starDotExtRE = /^\*+([^+@!?*[(]*)$/;
var starDotExtTest = (ext2) => (f) => !f.startsWith(".") && f.endsWith(ext2);
var starDotExtTestDot = (ext2) => (f) => f.endsWith(ext2);
var starDotExtTestNocase = (ext2) => {
  ext2 = ext2.toLowerCase();
  return (f) => !f.startsWith(".") && f.toLowerCase().endsWith(ext2);
};
var starDotExtTestNocaseDot = (ext2) => {
  ext2 = ext2.toLowerCase();
  return (f) => f.toLowerCase().endsWith(ext2);
};
var starDotStarRE = /^\*+\.\*+$/;
var starDotStarTest = (f) => !f.startsWith(".") && f.includes(".");
var starDotStarTestDot = (f) => f !== "." && f !== ".." && f.includes(".");
var dotStarRE = /^\.\*+$/;
var dotStarTest = (f) => f !== "." && f !== ".." && f.startsWith(".");
var starRE = /^\*+$/;
var starTest = (f) => f.length !== 0 && !f.startsWith(".");
var starTestDot = (f) => f.length !== 0 && f !== "." && f !== "..";
var qmarksRE = /^\?+([^+@!?*[(]*)?$/;
var qmarksTestNocase = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExt([$0]);
  if (!ext2)
    return noext;
  ext2 = ext2.toLowerCase();
  return (f) => noext(f) && f.toLowerCase().endsWith(ext2);
};
var qmarksTestNocaseDot = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExtDot([$0]);
  if (!ext2)
    return noext;
  ext2 = ext2.toLowerCase();
  return (f) => noext(f) && f.toLowerCase().endsWith(ext2);
};
var qmarksTestDot = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExtDot([$0]);
  return !ext2 ? noext : (f) => noext(f) && f.endsWith(ext2);
};
var qmarksTest = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExt([$0]);
  return !ext2 ? noext : (f) => noext(f) && f.endsWith(ext2);
};
var qmarksTestNoExt = ([$0]) => {
  const len = $0.length;
  return (f) => f.length === len && !f.startsWith(".");
};
var qmarksTestNoExtDot = ([$0]) => {
  const len = $0.length;
  return (f) => f.length === len && f !== "." && f !== "..";
};
var defaultPlatform = typeof process === "object" && process ? typeof process.env === "object" && process.env && process.env.__MINIMATCH_TESTING_PLATFORM__ || process.platform : "posix";
var path3 = {
  win32: { sep: "\\" },
  posix: { sep: "/" }
};
var sep = defaultPlatform === "win32" ? path3.win32.sep : path3.posix.sep;
minimatch.sep = sep;
var GLOBSTAR = /* @__PURE__ */ Symbol("globstar **");
minimatch.GLOBSTAR = GLOBSTAR;
var qmark2 = "[^/]";
var star2 = qmark2 + "*?";
var twoStarDot = "(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?";
var twoStarNoDot = "(?:(?!(?:\\/|^)\\.).)*?";
var filter = (pattern, options = {}) => (p) => minimatch(p, pattern, options);
minimatch.filter = filter;
var ext = (a, b = {}) => Object.assign({}, a, b);
var defaults = (def) => {
  if (!def || typeof def !== "object" || !Object.keys(def).length) {
    return minimatch;
  }
  const orig = minimatch;
  const m = (p, pattern, options = {}) => orig(p, pattern, ext(def, options));
  return Object.assign(m, {
    Minimatch: class Minimatch extends orig.Minimatch {
      constructor(pattern, options = {}) {
        super(pattern, ext(def, options));
      }
      static defaults(options) {
        return orig.defaults(ext(def, options)).Minimatch;
      }
    },
    AST: class AST extends orig.AST {
      /* c8 ignore start */
      constructor(type2, parent, options = {}) {
        super(type2, parent, ext(def, options));
      }
      /* c8 ignore stop */
      static fromGlob(pattern, options = {}) {
        return orig.AST.fromGlob(pattern, ext(def, options));
      }
    },
    unescape: (s, options = {}) => orig.unescape(s, ext(def, options)),
    escape: (s, options = {}) => orig.escape(s, ext(def, options)),
    filter: (pattern, options = {}) => orig.filter(pattern, ext(def, options)),
    defaults: (options) => orig.defaults(ext(def, options)),
    makeRe: (pattern, options = {}) => orig.makeRe(pattern, ext(def, options)),
    braceExpand: (pattern, options = {}) => orig.braceExpand(pattern, ext(def, options)),
    match: (list, pattern, options = {}) => orig.match(list, pattern, ext(def, options)),
    sep: orig.sep,
    GLOBSTAR
  });
};
minimatch.defaults = defaults;
var braceExpand = (pattern, options = {}) => {
  assertValidPattern(pattern);
  if (options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern)) {
    return [pattern];
  }
  return expand(pattern, { max: options.braceExpandMax });
};
minimatch.braceExpand = braceExpand;
var makeRe = (pattern, options = {}) => new Minimatch(pattern, options).makeRe();
minimatch.makeRe = makeRe;
var match = (list, pattern, options = {}) => {
  const mm = new Minimatch(pattern, options);
  list = list.filter((f) => mm.match(f));
  if (mm.options.nonull && !list.length) {
    list.push(pattern);
  }
  return list;
};
minimatch.match = match;
var globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/;
var regExpEscape2 = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var Minimatch = class {
  options;
  set;
  pattern;
  windowsPathsNoEscape;
  nonegate;
  negate;
  comment;
  empty;
  preserveMultipleSlashes;
  partial;
  globSet;
  globParts;
  nocase;
  isWindows;
  platform;
  windowsNoMagicRoot;
  maxGlobstarRecursion;
  regexp;
  constructor(pattern, options = {}) {
    assertValidPattern(pattern);
    options = options || {};
    this.options = options;
    this.maxGlobstarRecursion = options.maxGlobstarRecursion ?? 200;
    this.pattern = pattern;
    this.platform = options.platform || defaultPlatform;
    this.isWindows = this.platform === "win32";
    const awe = "allowWindowsEscape";
    this.windowsPathsNoEscape = !!options.windowsPathsNoEscape || options[awe] === false;
    if (this.windowsPathsNoEscape) {
      this.pattern = this.pattern.replace(/\\/g, "/");
    }
    this.preserveMultipleSlashes = !!options.preserveMultipleSlashes;
    this.regexp = null;
    this.negate = false;
    this.nonegate = !!options.nonegate;
    this.comment = false;
    this.empty = false;
    this.partial = !!options.partial;
    this.nocase = !!this.options.nocase;
    this.windowsNoMagicRoot = options.windowsNoMagicRoot !== void 0 ? options.windowsNoMagicRoot : !!(this.isWindows && this.nocase);
    this.globSet = [];
    this.globParts = [];
    this.set = [];
    this.make();
  }
  hasMagic() {
    if (this.options.magicalBraces && this.set.length > 1) {
      return true;
    }
    for (const pattern of this.set) {
      for (const part of pattern) {
        if (typeof part !== "string")
          return true;
      }
    }
    return false;
  }
  debug(..._) {
  }
  make() {
    const pattern = this.pattern;
    const options = this.options;
    if (!options.nocomment && pattern.charAt(0) === "#") {
      this.comment = true;
      return;
    }
    if (!pattern) {
      this.empty = true;
      return;
    }
    this.parseNegate();
    this.globSet = [...new Set(this.braceExpand())];
    if (options.debug) {
      this.debug = (...args) => console.error(...args);
    }
    this.debug(this.pattern, this.globSet);
    const rawGlobParts = this.globSet.map((s) => this.slashSplit(s));
    this.globParts = this.preprocess(rawGlobParts);
    this.debug(this.pattern, this.globParts);
    let set2 = this.globParts.map((s, _, __) => {
      if (this.isWindows && this.windowsNoMagicRoot) {
        const isUNC = s[0] === "" && s[1] === "" && (s[2] === "?" || !globMagic.test(s[2])) && !globMagic.test(s[3]);
        const isDrive = /^[a-z]:/i.test(s[0]);
        if (isUNC) {
          return [
            ...s.slice(0, 4),
            ...s.slice(4).map((ss) => this.parse(ss))
          ];
        } else if (isDrive) {
          return [s[0], ...s.slice(1).map((ss) => this.parse(ss))];
        }
      }
      return s.map((ss) => this.parse(ss));
    });
    this.debug(this.pattern, set2);
    this.set = set2.filter((s) => s.indexOf(false) === -1);
    if (this.isWindows) {
      for (let i = 0; i < this.set.length; i++) {
        const p = this.set[i];
        if (p[0] === "" && p[1] === "" && this.globParts[i][2] === "?" && typeof p[3] === "string" && /^[a-z]:$/i.test(p[3])) {
          p[2] = "?";
        }
      }
    }
    this.debug(this.pattern, this.set);
  }
  // various transforms to equivalent pattern sets that are
  // faster to process in a filesystem walk.  The goal is to
  // eliminate what we can, and push all ** patterns as far
  // to the right as possible, even if it increases the number
  // of patterns that we have to process.
  preprocess(globParts) {
    if (this.options.noglobstar) {
      for (const partset of globParts) {
        for (let j = 0; j < partset.length; j++) {
          if (partset[j] === "**") {
            partset[j] = "*";
          }
        }
      }
    }
    const { optimizationLevel = 1 } = this.options;
    if (optimizationLevel >= 2) {
      globParts = this.firstPhasePreProcess(globParts);
      globParts = this.secondPhasePreProcess(globParts);
    } else if (optimizationLevel >= 1) {
      globParts = this.levelOneOptimize(globParts);
    } else {
      globParts = this.adjascentGlobstarOptimize(globParts);
    }
    return globParts;
  }
  // just get rid of adjascent ** portions
  adjascentGlobstarOptimize(globParts) {
    return globParts.map((parts) => {
      let gs = -1;
      while (-1 !== (gs = parts.indexOf("**", gs + 1))) {
        let i = gs;
        while (parts[i + 1] === "**") {
          i++;
        }
        if (i !== gs) {
          parts.splice(gs, i - gs);
        }
      }
      return parts;
    });
  }
  // get rid of adjascent ** and resolve .. portions
  levelOneOptimize(globParts) {
    return globParts.map((parts) => {
      parts = parts.reduce((set2, part) => {
        const prev = set2[set2.length - 1];
        if (part === "**" && prev === "**") {
          return set2;
        }
        if (part === "..") {
          if (prev && prev !== ".." && prev !== "." && prev !== "**") {
            set2.pop();
            return set2;
          }
        }
        set2.push(part);
        return set2;
      }, []);
      return parts.length === 0 ? [""] : parts;
    });
  }
  levelTwoFileOptimize(parts) {
    if (!Array.isArray(parts)) {
      parts = this.slashSplit(parts);
    }
    let didSomething = false;
    do {
      didSomething = false;
      if (!this.preserveMultipleSlashes) {
        for (let i = 1; i < parts.length - 1; i++) {
          const p = parts[i];
          if (i === 1 && p === "" && parts[0] === "")
            continue;
          if (p === "." || p === "") {
            didSomething = true;
            parts.splice(i, 1);
            i--;
          }
        }
        if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
          didSomething = true;
          parts.pop();
        }
      }
      let dd = 0;
      while (-1 !== (dd = parts.indexOf("..", dd + 1))) {
        const p = parts[dd - 1];
        if (p && p !== "." && p !== ".." && p !== "**" && !(this.isWindows && /^[a-z]:$/i.test(p))) {
          didSomething = true;
          parts.splice(dd - 1, 2);
          dd -= 2;
        }
      }
    } while (didSomething);
    return parts.length === 0 ? [""] : parts;
  }
  // First phase: single-pattern processing
  // <pre> is 1 or more portions
  // <rest> is 1 or more portions
  // <p> is any portion other than ., .., '', or **
  // <e> is . or ''
  //
  // **/.. is *brutal* for filesystem walking performance, because
  // it effectively resets the recursive walk each time it occurs,
  // and ** cannot be reduced out by a .. pattern part like a regexp
  // or most strings (other than .., ., and '') can be.
  //
  // <pre>/**/../<p>/<p>/<rest> -> {<pre>/../<p>/<p>/<rest>,<pre>/**/<p>/<p>/<rest>}
  // <pre>/<e>/<rest> -> <pre>/<rest>
  // <pre>/<p>/../<rest> -> <pre>/<rest>
  // **/**/<rest> -> **/<rest>
  //
  // **/*/<rest> -> */**/<rest> <== not valid because ** doesn't follow
  // this WOULD be allowed if ** did follow symlinks, or * didn't
  firstPhasePreProcess(globParts) {
    let didSomething = false;
    do {
      didSomething = false;
      for (let parts of globParts) {
        let gs = -1;
        while (-1 !== (gs = parts.indexOf("**", gs + 1))) {
          let gss = gs;
          while (parts[gss + 1] === "**") {
            gss++;
          }
          if (gss > gs) {
            parts.splice(gs + 1, gss - gs);
          }
          let next = parts[gs + 1];
          const p = parts[gs + 2];
          const p2 = parts[gs + 3];
          if (next !== "..")
            continue;
          if (!p || p === "." || p === ".." || !p2 || p2 === "." || p2 === "..") {
            continue;
          }
          didSomething = true;
          parts.splice(gs, 1);
          const other = parts.slice(0);
          other[gs] = "**";
          globParts.push(other);
          gs--;
        }
        if (!this.preserveMultipleSlashes) {
          for (let i = 1; i < parts.length - 1; i++) {
            const p = parts[i];
            if (i === 1 && p === "" && parts[0] === "")
              continue;
            if (p === "." || p === "") {
              didSomething = true;
              parts.splice(i, 1);
              i--;
            }
          }
          if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
            didSomething = true;
            parts.pop();
          }
        }
        let dd = 0;
        while (-1 !== (dd = parts.indexOf("..", dd + 1))) {
          const p = parts[dd - 1];
          if (p && p !== "." && p !== ".." && p !== "**") {
            didSomething = true;
            const needDot = dd === 1 && parts[dd + 1] === "**";
            const splin = needDot ? ["."] : [];
            parts.splice(dd - 1, 2, ...splin);
            if (parts.length === 0)
              parts.push("");
            dd -= 2;
          }
        }
      }
    } while (didSomething);
    return globParts;
  }
  // second phase: multi-pattern dedupes
  // {<pre>/*/<rest>,<pre>/<p>/<rest>} -> <pre>/*/<rest>
  // {<pre>/<rest>,<pre>/<rest>} -> <pre>/<rest>
  // {<pre>/**/<rest>,<pre>/<rest>} -> <pre>/**/<rest>
  //
  // {<pre>/**/<rest>,<pre>/**/<p>/<rest>} -> <pre>/**/<rest>
  // ^-- not valid because ** doens't follow symlinks
  secondPhasePreProcess(globParts) {
    for (let i = 0; i < globParts.length - 1; i++) {
      for (let j = i + 1; j < globParts.length; j++) {
        const matched = this.partsMatch(globParts[i], globParts[j], !this.preserveMultipleSlashes);
        if (matched) {
          globParts[i] = [];
          globParts[j] = matched;
          break;
        }
      }
    }
    return globParts.filter((gs) => gs.length);
  }
  partsMatch(a, b, emptyGSMatch = false) {
    let ai = 0;
    let bi = 0;
    let result = [];
    let which = "";
    while (ai < a.length && bi < b.length) {
      if (a[ai] === b[bi]) {
        result.push(which === "b" ? b[bi] : a[ai]);
        ai++;
        bi++;
      } else if (emptyGSMatch && a[ai] === "**" && b[bi] === a[ai + 1]) {
        result.push(a[ai]);
        ai++;
      } else if (emptyGSMatch && b[bi] === "**" && a[ai] === b[bi + 1]) {
        result.push(b[bi]);
        bi++;
      } else if (a[ai] === "*" && b[bi] && (this.options.dot || !b[bi].startsWith(".")) && b[bi] !== "**") {
        if (which === "b")
          return false;
        which = "a";
        result.push(a[ai]);
        ai++;
        bi++;
      } else if (b[bi] === "*" && a[ai] && (this.options.dot || !a[ai].startsWith(".")) && a[ai] !== "**") {
        if (which === "a")
          return false;
        which = "b";
        result.push(b[bi]);
        ai++;
        bi++;
      } else {
        return false;
      }
    }
    return a.length === b.length && result;
  }
  parseNegate() {
    if (this.nonegate)
      return;
    const pattern = this.pattern;
    let negate = false;
    let negateOffset = 0;
    for (let i = 0; i < pattern.length && pattern.charAt(i) === "!"; i++) {
      negate = !negate;
      negateOffset++;
    }
    if (negateOffset)
      this.pattern = pattern.slice(negateOffset);
    this.negate = negate;
  }
  // set partial to true to test if, for example,
  // "/a/b" matches the start of "/*/b/*/d"
  // Partial means, if you run out of file before you run
  // out of pattern, then that's fine, as long as all
  // the parts match.
  matchOne(file, pattern, partial = false) {
    let fileStartIndex = 0;
    let patternStartIndex = 0;
    if (this.isWindows) {
      const fileDrive = typeof file[0] === "string" && /^[a-z]:$/i.test(file[0]);
      const fileUNC = !fileDrive && file[0] === "" && file[1] === "" && file[2] === "?" && /^[a-z]:$/i.test(file[3]);
      const patternDrive = typeof pattern[0] === "string" && /^[a-z]:$/i.test(pattern[0]);
      const patternUNC = !patternDrive && pattern[0] === "" && pattern[1] === "" && pattern[2] === "?" && typeof pattern[3] === "string" && /^[a-z]:$/i.test(pattern[3]);
      const fdi = fileUNC ? 3 : fileDrive ? 0 : void 0;
      const pdi = patternUNC ? 3 : patternDrive ? 0 : void 0;
      if (typeof fdi === "number" && typeof pdi === "number") {
        const [fd, pd] = [
          file[fdi],
          pattern[pdi]
        ];
        if (fd.toLowerCase() === pd.toLowerCase()) {
          pattern[pdi] = fd;
          patternStartIndex = pdi;
          fileStartIndex = fdi;
        }
      }
    }
    const { optimizationLevel = 1 } = this.options;
    if (optimizationLevel >= 2) {
      file = this.levelTwoFileOptimize(file);
    }
    if (pattern.includes(GLOBSTAR)) {
      return this.#matchGlobstar(file, pattern, partial, fileStartIndex, patternStartIndex);
    }
    return this.#matchOne(file, pattern, partial, fileStartIndex, patternStartIndex);
  }
  #matchGlobstar(file, pattern, partial, fileIndex, patternIndex) {
    const firstgs = pattern.indexOf(GLOBSTAR, patternIndex);
    const lastgs = pattern.lastIndexOf(GLOBSTAR);
    const [head, body, tail] = partial ? [
      pattern.slice(patternIndex, firstgs),
      pattern.slice(firstgs + 1),
      []
    ] : [
      pattern.slice(patternIndex, firstgs),
      pattern.slice(firstgs + 1, lastgs),
      pattern.slice(lastgs + 1)
    ];
    if (head.length) {
      const fileHead = file.slice(fileIndex, fileIndex + head.length);
      if (!this.#matchOne(fileHead, head, partial, 0, 0)) {
        return false;
      }
      fileIndex += head.length;
      patternIndex += head.length;
    }
    let fileTailMatch = 0;
    if (tail.length) {
      if (tail.length + fileIndex > file.length)
        return false;
      let tailStart = file.length - tail.length;
      if (this.#matchOne(file, tail, partial, tailStart, 0)) {
        fileTailMatch = tail.length;
      } else {
        if (file[file.length - 1] !== "" || fileIndex + tail.length === file.length) {
          return false;
        }
        tailStart--;
        if (!this.#matchOne(file, tail, partial, tailStart, 0)) {
          return false;
        }
        fileTailMatch = tail.length + 1;
      }
    }
    if (!body.length) {
      let sawSome = !!fileTailMatch;
      for (let i2 = fileIndex; i2 < file.length - fileTailMatch; i2++) {
        const f = String(file[i2]);
        sawSome = true;
        if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) {
          return false;
        }
      }
      return partial || sawSome;
    }
    const bodySegments = [[[], 0]];
    let currentBody = bodySegments[0];
    let nonGsParts = 0;
    const nonGsPartsSums = [0];
    for (const b of body) {
      if (b === GLOBSTAR) {
        nonGsPartsSums.push(nonGsParts);
        currentBody = [[], 0];
        bodySegments.push(currentBody);
      } else {
        currentBody[0].push(b);
        nonGsParts++;
      }
    }
    let i = bodySegments.length - 1;
    const fileLength = file.length - fileTailMatch;
    for (const b of bodySegments) {
      b[1] = fileLength - (nonGsPartsSums[i--] + b[0].length);
    }
    return !!this.#matchGlobStarBodySections(file, bodySegments, fileIndex, 0, partial, 0, !!fileTailMatch);
  }
  // return false for "nope, not matching"
  // return null for "not matching, cannot keep trying"
  #matchGlobStarBodySections(file, bodySegments, fileIndex, bodyIndex, partial, globStarDepth, sawTail) {
    const bs = bodySegments[bodyIndex];
    if (!bs) {
      for (let i = fileIndex; i < file.length; i++) {
        sawTail = true;
        const f = file[i];
        if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) {
          return false;
        }
      }
      return sawTail;
    }
    const [body, after] = bs;
    while (fileIndex <= after) {
      const m = this.#matchOne(file.slice(0, fileIndex + body.length), body, partial, fileIndex, 0);
      if (m && globStarDepth < this.maxGlobstarRecursion) {
        const sub = this.#matchGlobStarBodySections(file, bodySegments, fileIndex + body.length, bodyIndex + 1, partial, globStarDepth + 1, sawTail);
        if (sub !== false) {
          return sub;
        }
      }
      const f = file[fileIndex];
      if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) {
        return false;
      }
      fileIndex++;
    }
    return partial || null;
  }
  #matchOne(file, pattern, partial, fileIndex, patternIndex) {
    let fi;
    let pi;
    let pl;
    let fl;
    for (fi = fileIndex, pi = patternIndex, fl = file.length, pl = pattern.length; fi < fl && pi < pl; fi++, pi++) {
      this.debug("matchOne loop");
      let p = pattern[pi];
      let f = file[fi];
      this.debug(pattern, p, f);
      if (p === false || p === GLOBSTAR) {
        return false;
      }
      let hit;
      if (typeof p === "string") {
        hit = f === p;
        this.debug("string match", p, f, hit);
      } else {
        hit = p.test(f);
        this.debug("pattern match", p, f, hit);
      }
      if (!hit)
        return false;
    }
    if (fi === fl && pi === pl) {
      return true;
    } else if (fi === fl) {
      return partial;
    } else if (pi === pl) {
      return fi === fl - 1 && file[fi] === "";
    } else {
      throw new Error("wtf?");
    }
  }
  braceExpand() {
    return braceExpand(this.pattern, this.options);
  }
  parse(pattern) {
    assertValidPattern(pattern);
    const options = this.options;
    if (pattern === "**")
      return GLOBSTAR;
    if (pattern === "")
      return "";
    let m;
    let fastTest = null;
    if (m = pattern.match(starRE)) {
      fastTest = options.dot ? starTestDot : starTest;
    } else if (m = pattern.match(starDotExtRE)) {
      fastTest = (options.nocase ? options.dot ? starDotExtTestNocaseDot : starDotExtTestNocase : options.dot ? starDotExtTestDot : starDotExtTest)(m[1]);
    } else if (m = pattern.match(qmarksRE)) {
      fastTest = (options.nocase ? options.dot ? qmarksTestNocaseDot : qmarksTestNocase : options.dot ? qmarksTestDot : qmarksTest)(m);
    } else if (m = pattern.match(starDotStarRE)) {
      fastTest = options.dot ? starDotStarTestDot : starDotStarTest;
    } else if (m = pattern.match(dotStarRE)) {
      fastTest = dotStarTest;
    }
    const re = AST.fromGlob(pattern, this.options).toMMPattern();
    if (fastTest && typeof re === "object") {
      Reflect.defineProperty(re, "test", { value: fastTest });
    }
    return re;
  }
  makeRe() {
    if (this.regexp || this.regexp === false)
      return this.regexp;
    const set2 = this.set;
    if (!set2.length) {
      this.regexp = false;
      return this.regexp;
    }
    const options = this.options;
    const twoStar = options.noglobstar ? star2 : options.dot ? twoStarDot : twoStarNoDot;
    const flags = new Set(options.nocase ? ["i"] : []);
    let re = set2.map((pattern) => {
      const pp = pattern.map((p) => {
        if (p instanceof RegExp) {
          for (const f of p.flags.split(""))
            flags.add(f);
        }
        return typeof p === "string" ? regExpEscape2(p) : p === GLOBSTAR ? GLOBSTAR : p._src;
      });
      pp.forEach((p, i) => {
        const next = pp[i + 1];
        const prev = pp[i - 1];
        if (p !== GLOBSTAR || prev === GLOBSTAR) {
          return;
        }
        if (prev === void 0) {
          if (next !== void 0 && next !== GLOBSTAR) {
            pp[i + 1] = "(?:\\/|" + twoStar + "\\/)?" + next;
          } else {
            pp[i] = twoStar;
          }
        } else if (next === void 0) {
          pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + ")?";
        } else if (next !== GLOBSTAR) {
          pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + "\\/)" + next;
          pp[i + 1] = GLOBSTAR;
        }
      });
      const filtered = pp.filter((p) => p !== GLOBSTAR);
      if (this.partial && filtered.length >= 1) {
        const prefixes = [];
        for (let i = 1; i <= filtered.length; i++) {
          prefixes.push(filtered.slice(0, i).join("/"));
        }
        return "(?:" + prefixes.join("|") + ")";
      }
      return filtered.join("/");
    }).join("|");
    const [open, close] = set2.length > 1 ? ["(?:", ")"] : ["", ""];
    re = "^" + open + re + close + "$";
    if (this.partial) {
      re = "^(?:\\/|" + open + re.slice(1, -1) + close + ")$";
    }
    if (this.negate)
      re = "^(?!" + re + ").+$";
    try {
      this.regexp = new RegExp(re, [...flags].join(""));
    } catch {
      this.regexp = false;
    }
    return this.regexp;
  }
  slashSplit(p) {
    if (this.preserveMultipleSlashes) {
      return p.split("/");
    } else if (this.isWindows && /^\/\/[^/]+/.test(p)) {
      return ["", ...p.split(/\/+/)];
    } else {
      return p.split(/\/+/);
    }
  }
  match(f, partial = this.partial) {
    this.debug("match", f, this.pattern);
    if (this.comment) {
      return false;
    }
    if (this.empty) {
      return f === "";
    }
    if (f === "/" && partial) {
      return true;
    }
    const options = this.options;
    if (this.isWindows) {
      f = f.split("\\").join("/");
    }
    const ff = this.slashSplit(f);
    this.debug(this.pattern, "split", ff);
    const set2 = this.set;
    this.debug(this.pattern, "set", set2);
    let filename = ff[ff.length - 1];
    if (!filename) {
      for (let i = ff.length - 2; !filename && i >= 0; i--) {
        filename = ff[i];
      }
    }
    for (const pattern of set2) {
      let file = ff;
      if (options.matchBase && pattern.length === 1) {
        file = [filename];
      }
      const hit = this.matchOne(file, pattern, partial);
      if (hit) {
        if (options.flipNegate) {
          return true;
        }
        return !this.negate;
      }
    }
    if (options.flipNegate) {
      return false;
    }
    return this.negate;
  }
  static defaults(def) {
    return minimatch.defaults(def).Minimatch;
  }
};
minimatch.AST = AST;
minimatch.Minimatch = Minimatch;
minimatch.escape = escape;
minimatch.unescape = unescape;

// ../version/dist/chunk-UBCKZYTO.js
import fs8 from "fs";
import fs10 from "fs";
import * as path82 from "path";
import { cwd as cwd2 } from "process";

// ../../node_modules/.pnpm/@manypkg+get-packages@3.1.0/node_modules/@manypkg/get-packages/dist/manypkg-get-packages.js
import path7 from "path";

// ../../node_modules/.pnpm/@manypkg+tools@2.1.0/node_modules/@manypkg/tools/dist/manypkg-tools.js
import * as path5 from "path";
import path__default from "path";
import * as fs2 from "fs";
import fs__default from "fs";
import * as fsp from "fs/promises";
import fsp__default from "fs/promises";
import { F_OK } from "constants";

// ../../node_modules/.pnpm/tinyglobby@0.2.15/node_modules/tinyglobby/dist/index.mjs
import nativeFs2 from "fs";
import path4, { posix } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// ../../node_modules/.pnpm/fdir@6.5.0_picomatch@4.0.4/node_modules/fdir/dist/index.mjs
import { createRequire } from "module";
import { basename, dirname as dirname2, normalize, relative, resolve, sep as sep2 } from "path";
import * as nativeFs from "fs";
var __require2 = /* @__PURE__ */ createRequire(import.meta.url);
function cleanPath(path10) {
  let normalized = normalize(path10);
  if (normalized.length > 1 && normalized[normalized.length - 1] === sep2) normalized = normalized.substring(0, normalized.length - 1);
  return normalized;
}
var SLASHES_REGEX = /[\\/]/g;
function convertSlashes(path10, separator) {
  return path10.replace(SLASHES_REGEX, separator);
}
var WINDOWS_ROOT_DIR_REGEX = /^[a-z]:[\\/]$/i;
function isRootDirectory(path10) {
  return path10 === "/" || WINDOWS_ROOT_DIR_REGEX.test(path10);
}
function normalizePath(path10, options) {
  const { resolvePaths, normalizePath: normalizePath$1, pathSeparator } = options;
  const pathNeedsCleaning = process.platform === "win32" && path10.includes("/") || path10.startsWith(".");
  if (resolvePaths) path10 = resolve(path10);
  if (normalizePath$1 || pathNeedsCleaning) path10 = cleanPath(path10);
  if (path10 === ".") return "";
  const needsSeperator = path10[path10.length - 1] !== pathSeparator;
  return convertSlashes(needsSeperator ? path10 + pathSeparator : path10, pathSeparator);
}
function joinPathWithBasePath(filename, directoryPath) {
  return directoryPath + filename;
}
function joinPathWithRelativePath(root, options) {
  return function(filename, directoryPath) {
    const sameRoot = directoryPath.startsWith(root);
    if (sameRoot) return directoryPath.slice(root.length) + filename;
    else return convertSlashes(relative(root, directoryPath), options.pathSeparator) + options.pathSeparator + filename;
  };
}
function joinPath(filename) {
  return filename;
}
function joinDirectoryPath(filename, directoryPath, separator) {
  return directoryPath + filename + separator;
}
function build$7(root, options) {
  const { relativePaths, includeBasePath } = options;
  return relativePaths && root ? joinPathWithRelativePath(root, options) : includeBasePath ? joinPathWithBasePath : joinPath;
}
function pushDirectoryWithRelativePath(root) {
  return function(directoryPath, paths) {
    paths.push(directoryPath.substring(root.length) || ".");
  };
}
function pushDirectoryFilterWithRelativePath(root) {
  return function(directoryPath, paths, filters) {
    const relativePath = directoryPath.substring(root.length) || ".";
    if (filters.every((filter2) => filter2(relativePath, true))) paths.push(relativePath);
  };
}
var pushDirectory = (directoryPath, paths) => {
  paths.push(directoryPath || ".");
};
var pushDirectoryFilter = (directoryPath, paths, filters) => {
  const path10 = directoryPath || ".";
  if (filters.every((filter2) => filter2(path10, true))) paths.push(path10);
};
var empty$2 = () => {
};
function build$6(root, options) {
  const { includeDirs, filters, relativePaths } = options;
  if (!includeDirs) return empty$2;
  if (relativePaths) return filters && filters.length ? pushDirectoryFilterWithRelativePath(root) : pushDirectoryWithRelativePath(root);
  return filters && filters.length ? pushDirectoryFilter : pushDirectory;
}
var pushFileFilterAndCount = (filename, _paths, counts, filters) => {
  if (filters.every((filter2) => filter2(filename, false))) counts.files++;
};
var pushFileFilter = (filename, paths, _counts, filters) => {
  if (filters.every((filter2) => filter2(filename, false))) paths.push(filename);
};
var pushFileCount = (_filename, _paths, counts, _filters) => {
  counts.files++;
};
var pushFile = (filename, paths) => {
  paths.push(filename);
};
var empty$1 = () => {
};
function build$5(options) {
  const { excludeFiles, filters, onlyCounts } = options;
  if (excludeFiles) return empty$1;
  if (filters && filters.length) return onlyCounts ? pushFileFilterAndCount : pushFileFilter;
  else if (onlyCounts) return pushFileCount;
  else return pushFile;
}
var getArray = (paths) => {
  return paths;
};
var getArrayGroup = () => {
  return [""].slice(0, 0);
};
function build$4(options) {
  return options.group ? getArrayGroup : getArray;
}
var groupFiles = (groups, directory, files) => {
  groups.push({
    directory,
    files,
    dir: directory
  });
};
var empty = () => {
};
function build$3(options) {
  return options.group ? groupFiles : empty;
}
var resolveSymlinksAsync = function(path10, state, callback$1) {
  const { queue, fs: fs7, options: { suppressErrors } } = state;
  queue.enqueue();
  fs7.realpath(path10, (error, resolvedPath) => {
    if (error) return queue.dequeue(suppressErrors ? null : error, state);
    fs7.stat(resolvedPath, (error$1, stat) => {
      if (error$1) return queue.dequeue(suppressErrors ? null : error$1, state);
      if (stat.isDirectory() && isRecursive(path10, resolvedPath, state)) return queue.dequeue(null, state);
      callback$1(stat, resolvedPath);
      queue.dequeue(null, state);
    });
  });
};
var resolveSymlinks = function(path10, state, callback$1) {
  const { queue, fs: fs7, options: { suppressErrors } } = state;
  queue.enqueue();
  try {
    const resolvedPath = fs7.realpathSync(path10);
    const stat = fs7.statSync(resolvedPath);
    if (stat.isDirectory() && isRecursive(path10, resolvedPath, state)) return;
    callback$1(stat, resolvedPath);
  } catch (e) {
    if (!suppressErrors) throw e;
  }
};
function build$2(options, isSynchronous) {
  if (!options.resolveSymlinks || options.excludeSymlinks) return null;
  return isSynchronous ? resolveSymlinks : resolveSymlinksAsync;
}
function isRecursive(path10, resolved, state) {
  if (state.options.useRealPaths) return isRecursiveUsingRealPaths(resolved, state);
  let parent = dirname2(path10);
  let depth = 1;
  while (parent !== state.root && depth < 2) {
    const resolvedPath = state.symlinks.get(parent);
    const isSameRoot = !!resolvedPath && (resolvedPath === resolved || resolvedPath.startsWith(resolved) || resolved.startsWith(resolvedPath));
    if (isSameRoot) depth++;
    else parent = dirname2(parent);
  }
  state.symlinks.set(path10, resolved);
  return depth > 1;
}
function isRecursiveUsingRealPaths(resolved, state) {
  return state.visited.includes(resolved + state.options.pathSeparator);
}
var onlyCountsSync = (state) => {
  return state.counts;
};
var groupsSync = (state) => {
  return state.groups;
};
var defaultSync = (state) => {
  return state.paths;
};
var limitFilesSync = (state) => {
  return state.paths.slice(0, state.options.maxFiles);
};
var onlyCountsAsync = (state, error, callback$1) => {
  report(error, callback$1, state.counts, state.options.suppressErrors);
  return null;
};
var defaultAsync = (state, error, callback$1) => {
  report(error, callback$1, state.paths, state.options.suppressErrors);
  return null;
};
var limitFilesAsync = (state, error, callback$1) => {
  report(error, callback$1, state.paths.slice(0, state.options.maxFiles), state.options.suppressErrors);
  return null;
};
var groupsAsync = (state, error, callback$1) => {
  report(error, callback$1, state.groups, state.options.suppressErrors);
  return null;
};
function report(error, callback$1, output3, suppressErrors) {
  if (error && !suppressErrors) callback$1(error, output3);
  else callback$1(null, output3);
}
function build$1(options, isSynchronous) {
  const { onlyCounts, group, maxFiles } = options;
  if (onlyCounts) return isSynchronous ? onlyCountsSync : onlyCountsAsync;
  else if (group) return isSynchronous ? groupsSync : groupsAsync;
  else if (maxFiles) return isSynchronous ? limitFilesSync : limitFilesAsync;
  else return isSynchronous ? defaultSync : defaultAsync;
}
var readdirOpts = { withFileTypes: true };
var walkAsync = (state, crawlPath, directoryPath, currentDepth, callback$1) => {
  state.queue.enqueue();
  if (currentDepth < 0) return state.queue.dequeue(null, state);
  const { fs: fs7 } = state;
  state.visited.push(crawlPath);
  state.counts.directories++;
  fs7.readdir(crawlPath || ".", readdirOpts, (error, entries = []) => {
    callback$1(entries, directoryPath, currentDepth);
    state.queue.dequeue(state.options.suppressErrors ? null : error, state);
  });
};
var walkSync = (state, crawlPath, directoryPath, currentDepth, callback$1) => {
  const { fs: fs7 } = state;
  if (currentDepth < 0) return;
  state.visited.push(crawlPath);
  state.counts.directories++;
  let entries = [];
  try {
    entries = fs7.readdirSync(crawlPath || ".", readdirOpts);
  } catch (e) {
    if (!state.options.suppressErrors) throw e;
  }
  callback$1(entries, directoryPath, currentDepth);
};
function build(isSynchronous) {
  return isSynchronous ? walkSync : walkAsync;
}
var Queue = class {
  count = 0;
  constructor(onQueueEmpty) {
    this.onQueueEmpty = onQueueEmpty;
  }
  enqueue() {
    this.count++;
    return this.count;
  }
  dequeue(error, output3) {
    if (this.onQueueEmpty && (--this.count <= 0 || error)) {
      this.onQueueEmpty(error, output3);
      if (error) {
        output3.controller.abort();
        this.onQueueEmpty = void 0;
      }
    }
  }
};
var Counter = class {
  _files = 0;
  _directories = 0;
  set files(num) {
    this._files = num;
  }
  get files() {
    return this._files;
  }
  set directories(num) {
    this._directories = num;
  }
  get directories() {
    return this._directories;
  }
  /**
  * @deprecated use `directories` instead
  */
  /* c8 ignore next 3 */
  get dirs() {
    return this._directories;
  }
};
var Aborter = class {
  aborted = false;
  abort() {
    this.aborted = true;
  }
};
var Walker = class {
  root;
  isSynchronous;
  state;
  joinPath;
  pushDirectory;
  pushFile;
  getArray;
  groupFiles;
  resolveSymlink;
  walkDirectory;
  callbackInvoker;
  constructor(root, options, callback$1) {
    this.isSynchronous = !callback$1;
    this.callbackInvoker = build$1(options, this.isSynchronous);
    this.root = normalizePath(root, options);
    this.state = {
      root: isRootDirectory(this.root) ? this.root : this.root.slice(0, -1),
      paths: [""].slice(0, 0),
      groups: [],
      counts: new Counter(),
      options,
      queue: new Queue((error, state) => this.callbackInvoker(state, error, callback$1)),
      symlinks: /* @__PURE__ */ new Map(),
      visited: [""].slice(0, 0),
      controller: new Aborter(),
      fs: options.fs || nativeFs
    };
    this.joinPath = build$7(this.root, options);
    this.pushDirectory = build$6(this.root, options);
    this.pushFile = build$5(options);
    this.getArray = build$4(options);
    this.groupFiles = build$3(options);
    this.resolveSymlink = build$2(options, this.isSynchronous);
    this.walkDirectory = build(this.isSynchronous);
  }
  start() {
    this.pushDirectory(this.root, this.state.paths, this.state.options.filters);
    this.walkDirectory(this.state, this.root, this.root, this.state.options.maxDepth, this.walk);
    return this.isSynchronous ? this.callbackInvoker(this.state, null) : null;
  }
  walk = (entries, directoryPath, depth) => {
    const { paths, options: { filters, resolveSymlinks: resolveSymlinks$1, excludeSymlinks, exclude, maxFiles, signal, useRealPaths, pathSeparator }, controller } = this.state;
    if (controller.aborted || signal && signal.aborted || maxFiles && paths.length > maxFiles) return;
    const files = this.getArray(this.state.paths);
    for (let i = 0; i < entries.length; ++i) {
      const entry = entries[i];
      if (entry.isFile() || entry.isSymbolicLink() && !resolveSymlinks$1 && !excludeSymlinks) {
        const filename = this.joinPath(entry.name, directoryPath);
        this.pushFile(filename, files, this.state.counts, filters);
      } else if (entry.isDirectory()) {
        let path10 = joinDirectoryPath(entry.name, directoryPath, this.state.options.pathSeparator);
        if (exclude && exclude(entry.name, path10)) continue;
        this.pushDirectory(path10, paths, filters);
        this.walkDirectory(this.state, path10, path10, depth - 1, this.walk);
      } else if (this.resolveSymlink && entry.isSymbolicLink()) {
        let path10 = joinPathWithBasePath(entry.name, directoryPath);
        this.resolveSymlink(path10, this.state, (stat, resolvedPath) => {
          if (stat.isDirectory()) {
            resolvedPath = normalizePath(resolvedPath, this.state.options);
            if (exclude && exclude(entry.name, useRealPaths ? resolvedPath : path10 + pathSeparator)) return;
            this.walkDirectory(this.state, resolvedPath, useRealPaths ? resolvedPath : path10 + pathSeparator, depth - 1, this.walk);
          } else {
            resolvedPath = useRealPaths ? resolvedPath : path10;
            const filename = basename(resolvedPath);
            const directoryPath$1 = normalizePath(dirname2(resolvedPath), this.state.options);
            resolvedPath = this.joinPath(filename, directoryPath$1);
            this.pushFile(resolvedPath, files, this.state.counts, filters);
          }
        });
      }
    }
    this.groupFiles(this.state.groups, directoryPath, files);
  };
};
function promise(root, options) {
  return new Promise((resolve$1, reject) => {
    callback(root, options, (err, output3) => {
      if (err) return reject(err);
      resolve$1(output3);
    });
  });
}
function callback(root, options, callback$1) {
  let walker = new Walker(root, options, callback$1);
  walker.start();
}
function sync(root, options) {
  const walker = new Walker(root, options);
  return walker.start();
}
var APIBuilder = class {
  constructor(root, options) {
    this.root = root;
    this.options = options;
  }
  withPromise() {
    return promise(this.root, this.options);
  }
  withCallback(cb) {
    callback(this.root, this.options, cb);
  }
  sync() {
    return sync(this.root, this.options);
  }
};
var pm = null;
try {
  __require2.resolve("picomatch");
  pm = __require2("picomatch");
} catch {
}
var Builder = class {
  globCache = {};
  options = {
    maxDepth: Infinity,
    suppressErrors: true,
    pathSeparator: sep2,
    filters: []
  };
  globFunction;
  constructor(options) {
    this.options = {
      ...this.options,
      ...options
    };
    this.globFunction = this.options.globFunction;
  }
  group() {
    this.options.group = true;
    return this;
  }
  withPathSeparator(separator) {
    this.options.pathSeparator = separator;
    return this;
  }
  withBasePath() {
    this.options.includeBasePath = true;
    return this;
  }
  withRelativePaths() {
    this.options.relativePaths = true;
    return this;
  }
  withDirs() {
    this.options.includeDirs = true;
    return this;
  }
  withMaxDepth(depth) {
    this.options.maxDepth = depth;
    return this;
  }
  withMaxFiles(limit) {
    this.options.maxFiles = limit;
    return this;
  }
  withFullPaths() {
    this.options.resolvePaths = true;
    this.options.includeBasePath = true;
    return this;
  }
  withErrors() {
    this.options.suppressErrors = false;
    return this;
  }
  withSymlinks({ resolvePaths = true } = {}) {
    this.options.resolveSymlinks = true;
    this.options.useRealPaths = resolvePaths;
    return this.withFullPaths();
  }
  withAbortSignal(signal) {
    this.options.signal = signal;
    return this;
  }
  normalize() {
    this.options.normalizePath = true;
    return this;
  }
  filter(predicate) {
    this.options.filters.push(predicate);
    return this;
  }
  onlyDirs() {
    this.options.excludeFiles = true;
    this.options.includeDirs = true;
    return this;
  }
  exclude(predicate) {
    this.options.exclude = predicate;
    return this;
  }
  onlyCounts() {
    this.options.onlyCounts = true;
    return this;
  }
  crawl(root) {
    return new APIBuilder(root || ".", this.options);
  }
  withGlobFunction(fn) {
    this.globFunction = fn;
    return this;
  }
  /**
  * @deprecated Pass options using the constructor instead:
  * ```ts
  * new fdir(options).crawl("/path/to/root");
  * ```
  * This method will be removed in v7.0
  */
  /* c8 ignore next 4 */
  crawlWithOptions(root, options) {
    this.options = {
      ...this.options,
      ...options
    };
    return new APIBuilder(root || ".", this.options);
  }
  glob(...patterns) {
    if (this.globFunction) return this.globWithOptions(patterns);
    return this.globWithOptions(patterns, ...[{ dot: true }]);
  }
  globWithOptions(patterns, ...options) {
    const globFn = this.globFunction || pm;
    if (!globFn) throw new Error("Please specify a glob function to use glob matching.");
    var isMatch = this.globCache[patterns.join("\0")];
    if (!isMatch) {
      isMatch = globFn(patterns, ...options);
      this.globCache[patterns.join("\0")] = isMatch;
    }
    this.options.filters.push((path10) => isMatch(path10));
    return this;
  }
};

// ../../node_modules/.pnpm/tinyglobby@0.2.15/node_modules/tinyglobby/dist/index.mjs
var import_picomatch = __toESM(require_picomatch2(), 1);
var isReadonlyArray = Array.isArray;
var isWin = process.platform === "win32";
var ONLY_PARENT_DIRECTORIES = /^(\/?\.\.)+$/;
function getPartialMatcher(patterns, options = {}) {
  const patternsCount = patterns.length;
  const patternsParts = Array(patternsCount);
  const matchers = Array(patternsCount);
  const globstarEnabled = !options.noglobstar;
  for (let i = 0; i < patternsCount; i++) {
    const parts = splitPattern(patterns[i]);
    patternsParts[i] = parts;
    const partsCount = parts.length;
    const partMatchers = Array(partsCount);
    for (let j = 0; j < partsCount; j++) partMatchers[j] = (0, import_picomatch.default)(parts[j], options);
    matchers[i] = partMatchers;
  }
  return (input) => {
    const inputParts = input.split("/");
    if (inputParts[0] === ".." && ONLY_PARENT_DIRECTORIES.test(input)) return true;
    for (let i = 0; i < patterns.length; i++) {
      const patternParts = patternsParts[i];
      const matcher = matchers[i];
      const inputPatternCount = inputParts.length;
      const minParts = Math.min(inputPatternCount, patternParts.length);
      let j = 0;
      while (j < minParts) {
        const part = patternParts[j];
        if (part.includes("/")) return true;
        const match2 = matcher[j](inputParts[j]);
        if (!match2) break;
        if (globstarEnabled && part === "**") return true;
        j++;
      }
      if (j === inputPatternCount) return true;
    }
    return false;
  };
}
var WIN32_ROOT_DIR = /^[A-Z]:\/$/i;
var isRoot = isWin ? (p) => WIN32_ROOT_DIR.test(p) : (p) => p === "/";
function buildFormat(cwd3, root, absolute) {
  if (cwd3 === root || root.startsWith(`${cwd3}/`)) {
    if (absolute) {
      const start = isRoot(cwd3) ? cwd3.length : cwd3.length + 1;
      return (p, isDir) => p.slice(start, isDir ? -1 : void 0) || ".";
    }
    const prefix = root.slice(cwd3.length + 1);
    if (prefix) return (p, isDir) => {
      if (p === ".") return prefix;
      const result = `${prefix}/${p}`;
      return isDir ? result.slice(0, -1) : result;
    };
    return (p, isDir) => isDir && p !== "." ? p.slice(0, -1) : p;
  }
  if (absolute) return (p) => posix.relative(cwd3, p) || ".";
  return (p) => posix.relative(cwd3, `${root}/${p}`) || ".";
}
function buildRelative(cwd3, root) {
  if (root.startsWith(`${cwd3}/`)) {
    const prefix = root.slice(cwd3.length + 1);
    return (p) => `${prefix}/${p}`;
  }
  return (p) => {
    const result = posix.relative(cwd3, `${root}/${p}`);
    if (p.endsWith("/") && result !== "") return `${result}/`;
    return result || ".";
  };
}
var splitPatternOptions = { parts: true };
function splitPattern(path$1) {
  var _result$parts;
  const result = import_picomatch.default.scan(path$1, splitPatternOptions);
  return ((_result$parts = result.parts) === null || _result$parts === void 0 ? void 0 : _result$parts.length) ? result.parts : [path$1];
}
var POSIX_UNESCAPED_GLOB_SYMBOLS = /(?<!\\)([()[\]{}*?|]|^!|[!+@](?=\()|\\(?![()[\]{}!*+?@|]))/g;
var WIN32_UNESCAPED_GLOB_SYMBOLS = /(?<!\\)([()[\]{}]|^!|[!+@](?=\())/g;
var escapePosixPath = (path$1) => path$1.replace(POSIX_UNESCAPED_GLOB_SYMBOLS, "\\$&");
var escapeWin32Path = (path$1) => path$1.replace(WIN32_UNESCAPED_GLOB_SYMBOLS, "\\$&");
var escapePath = isWin ? escapeWin32Path : escapePosixPath;
function isDynamicPattern(pattern, options) {
  if ((options === null || options === void 0 ? void 0 : options.caseSensitiveMatch) === false) return true;
  const scan = import_picomatch.default.scan(pattern);
  return scan.isGlob || scan.negated;
}
function log(...tasks) {
  console.log(`[tinyglobby ${(/* @__PURE__ */ new Date()).toLocaleTimeString("es")}]`, ...tasks);
}
var PARENT_DIRECTORY = /^(\/?\.\.)+/;
var ESCAPING_BACKSLASHES = /\\(?=[()[\]{}!*+?@|])/g;
var BACKSLASHES = /\\/g;
function normalizePattern(pattern, expandDirectories, cwd3, props, isIgnore) {
  let result = pattern;
  if (pattern.endsWith("/")) result = pattern.slice(0, -1);
  if (!result.endsWith("*") && expandDirectories) result += "/**";
  const escapedCwd = escapePath(cwd3);
  if (path4.isAbsolute(result.replace(ESCAPING_BACKSLASHES, ""))) result = posix.relative(escapedCwd, result);
  else result = posix.normalize(result);
  const parentDirectoryMatch = PARENT_DIRECTORY.exec(result);
  const parts = splitPattern(result);
  if (parentDirectoryMatch === null || parentDirectoryMatch === void 0 ? void 0 : parentDirectoryMatch[0]) {
    const n = (parentDirectoryMatch[0].length + 1) / 3;
    let i = 0;
    const cwdParts = escapedCwd.split("/");
    while (i < n && parts[i + n] === cwdParts[cwdParts.length + i - n]) {
      result = result.slice(0, (n - i - 1) * 3) + result.slice((n - i) * 3 + parts[i + n].length + 1) || ".";
      i++;
    }
    const potentialRoot = posix.join(cwd3, parentDirectoryMatch[0].slice(i * 3));
    if (!potentialRoot.startsWith(".") && props.root.length > potentialRoot.length) {
      props.root = potentialRoot;
      props.depthOffset = -n + i;
    }
  }
  if (!isIgnore && props.depthOffset >= 0) {
    var _props$commonPath;
    (_props$commonPath = props.commonPath) !== null && _props$commonPath !== void 0 || (props.commonPath = parts);
    const newCommonPath = [];
    const length = Math.min(props.commonPath.length, parts.length);
    for (let i = 0; i < length; i++) {
      const part = parts[i];
      if (part === "**" && !parts[i + 1]) {
        newCommonPath.pop();
        break;
      }
      if (part !== props.commonPath[i] || isDynamicPattern(part) || i === parts.length - 1) break;
      newCommonPath.push(part);
    }
    props.depthOffset = newCommonPath.length;
    props.commonPath = newCommonPath;
    props.root = newCommonPath.length > 0 ? posix.join(cwd3, ...newCommonPath) : cwd3;
  }
  return result;
}
function processPatterns({ patterns = ["**/*"], ignore = [], expandDirectories = true }, cwd3, props) {
  if (typeof patterns === "string") patterns = [patterns];
  if (typeof ignore === "string") ignore = [ignore];
  const matchPatterns = [];
  const ignorePatterns = [];
  for (const pattern of ignore) {
    if (!pattern) continue;
    if (pattern[0] !== "!" || pattern[1] === "(") ignorePatterns.push(normalizePattern(pattern, expandDirectories, cwd3, props, true));
  }
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (pattern[0] !== "!" || pattern[1] === "(") matchPatterns.push(normalizePattern(pattern, expandDirectories, cwd3, props, false));
    else if (pattern[1] !== "!" || pattern[2] === "(") ignorePatterns.push(normalizePattern(pattern.slice(1), expandDirectories, cwd3, props, true));
  }
  return {
    match: matchPatterns,
    ignore: ignorePatterns
  };
}
function formatPaths(paths, relative2) {
  for (let i = paths.length - 1; i >= 0; i--) {
    const path$1 = paths[i];
    paths[i] = relative2(path$1);
  }
  return paths;
}
function normalizeCwd(cwd3) {
  if (!cwd3) return process.cwd().replace(BACKSLASHES, "/");
  if (cwd3 instanceof URL) return fileURLToPath2(cwd3).replace(BACKSLASHES, "/");
  return path4.resolve(cwd3).replace(BACKSLASHES, "/");
}
function getCrawler(patterns, inputOptions = {}) {
  const options = process.env.TINYGLOBBY_DEBUG ? {
    ...inputOptions,
    debug: true
  } : inputOptions;
  const cwd3 = normalizeCwd(options.cwd);
  if (options.debug) log("globbing with:", {
    patterns,
    options,
    cwd: cwd3
  });
  if (Array.isArray(patterns) && patterns.length === 0) return [{
    sync: () => [],
    withPromise: async () => []
  }, false];
  const props = {
    root: cwd3,
    commonPath: null,
    depthOffset: 0
  };
  const processed = processPatterns({
    ...options,
    patterns
  }, cwd3, props);
  if (options.debug) log("internal processing patterns:", processed);
  const matchOptions = {
    dot: options.dot,
    nobrace: options.braceExpansion === false,
    nocase: options.caseSensitiveMatch === false,
    noextglob: options.extglob === false,
    noglobstar: options.globstar === false,
    posix: true
  };
  const matcher = (0, import_picomatch.default)(processed.match, {
    ...matchOptions,
    ignore: processed.ignore
  });
  const ignore = (0, import_picomatch.default)(processed.ignore, matchOptions);
  const partialMatcher = getPartialMatcher(processed.match, matchOptions);
  const format = buildFormat(cwd3, props.root, options.absolute);
  const formatExclude = options.absolute ? format : buildFormat(cwd3, props.root, true);
  const fdirOptions = {
    filters: [options.debug ? (p, isDirectory) => {
      const path$1 = format(p, isDirectory);
      const matches = matcher(path$1);
      if (matches) log(`matched ${path$1}`);
      return matches;
    } : (p, isDirectory) => matcher(format(p, isDirectory))],
    exclude: options.debug ? (_, p) => {
      const relativePath = formatExclude(p, true);
      const skipped = relativePath !== "." && !partialMatcher(relativePath) || ignore(relativePath);
      if (skipped) log(`skipped ${p}`);
      else log(`crawling ${p}`);
      return skipped;
    } : (_, p) => {
      const relativePath = formatExclude(p, true);
      return relativePath !== "." && !partialMatcher(relativePath) || ignore(relativePath);
    },
    fs: options.fs ? {
      readdir: options.fs.readdir || nativeFs2.readdir,
      readdirSync: options.fs.readdirSync || nativeFs2.readdirSync,
      realpath: options.fs.realpath || nativeFs2.realpath,
      realpathSync: options.fs.realpathSync || nativeFs2.realpathSync,
      stat: options.fs.stat || nativeFs2.stat,
      statSync: options.fs.statSync || nativeFs2.statSync
    } : void 0,
    pathSeparator: "/",
    relativePaths: true,
    resolveSymlinks: true,
    signal: options.signal
  };
  if (options.deep !== void 0) fdirOptions.maxDepth = Math.round(options.deep - props.depthOffset);
  if (options.absolute) {
    fdirOptions.relativePaths = false;
    fdirOptions.resolvePaths = true;
    fdirOptions.includeBasePath = true;
  }
  if (options.followSymbolicLinks === false) {
    fdirOptions.resolveSymlinks = false;
    fdirOptions.excludeSymlinks = true;
  }
  if (options.onlyDirectories) {
    fdirOptions.excludeFiles = true;
    fdirOptions.includeDirs = true;
  } else if (options.onlyFiles === false) fdirOptions.includeDirs = true;
  props.root = props.root.replace(BACKSLASHES, "");
  const root = props.root;
  if (options.debug) log("internal properties:", props);
  const relative2 = cwd3 !== root && !options.absolute && buildRelative(cwd3, props.root);
  return [new Builder(fdirOptions).crawl(root), relative2];
}
async function glob(patternsOrOptions, options) {
  if (patternsOrOptions && (options === null || options === void 0 ? void 0 : options.patterns)) throw new Error("Cannot pass patterns as both an argument and an option");
  const isModern = isReadonlyArray(patternsOrOptions) || typeof patternsOrOptions === "string";
  const opts = isModern ? options : patternsOrOptions;
  const patterns = isModern ? patternsOrOptions : patternsOrOptions.patterns;
  const [crawler, relative2] = getCrawler(patterns, opts);
  if (!relative2) return crawler.withPromise();
  return formatPaths(await crawler.withPromise(), relative2);
}
function globSync(patternsOrOptions, options) {
  if (patternsOrOptions && (options === null || options === void 0 ? void 0 : options.patterns)) throw new Error("Cannot pass patterns as both an argument and an option");
  const isModern = isReadonlyArray(patternsOrOptions) || typeof patternsOrOptions === "string";
  const opts = isModern ? options : patternsOrOptions;
  const patterns = isModern ? patternsOrOptions : patternsOrOptions.patterns;
  const [crawler, relative2] = getCrawler(patterns, opts);
  if (!relative2) return crawler.sync();
  return formatPaths(crawler.sync(), relative2);
}

// ../../node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray5(sequence) {
  if (Array.isArray(sequence)) return sequence;
  else if (isNothing(sequence)) return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length; index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0; cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray5;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception2, compact) {
  var where = "", message = exception2.reason || "(unknown reason)";
  if (!exception2.mark) return message;
  if (exception2.mark.name) {
    where += 'in "' + exception2.mark.name + '" ';
  }
  where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
  if (!compact && exception2.mark.snippet) {
    where += "\n\n" + exception2.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = function toString(compact) {
  return this.name + ": " + formatError(this, compact);
};
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
    // relative position
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer) return null;
  if (!options.maxLength) options.maxLength = 79;
  if (typeof options.indent !== "number") options.indent = 1;
  if (typeof options.linesBefore !== "number") options.linesBefore = 3;
  if (typeof options.linesAfter !== "number") options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match2;
  var foundLineNo = -1;
  while (match2 = re.exec(mark.buffer)) {
    lineEnds.push(match2.index);
    lineStarts.push(match2.index + match2[0].length);
    if (mark.position <= match2.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    );
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + "\n" + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
  for (i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    );
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  }
  return result.replace(/\n$/, "");
}
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map2) {
  var result = {};
  if (map2 !== null) {
    Object.keys(map2).forEach(function(style) {
      map2[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
var type = Type$1;
function compileList(schema2, name) {
  var result = [];
  schema2[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
Schema$1.prototype.extend = function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit) implicit = implicit.concat(definition.implicit);
    if (definition.explicit) explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
};
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: function(data) {
    return data !== null ? data : "";
  }
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: function(data) {
    return data !== null ? data : [];
  }
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: function(data) {
    return data !== null ? data : {};
  }
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null) return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function() {
      return "~";
    },
    lowercase: function() {
      return "null";
    },
    uppercase: function() {
      return "NULL";
    },
    camelcase: function() {
      return "Null";
    },
    empty: function() {
      return "";
    }
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null) return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function(object) {
      return object ? "true" : "false";
    },
    uppercase: function(object) {
      return object ? "TRUE" : "FALSE";
    },
    camelcase: function(object) {
      return object ? "True" : "False";
    }
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null) return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max) return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max) return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isOctCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_") return false;
  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_") return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0") return 0;
  if (ch === "0") {
    if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function(obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    octal: function(obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    },
    decimal: function(obj) {
      return obj.toString(10);
    },
    /* eslint-disable max-len */
    hexadecimal: function(obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp(
  // 2.5e4, 2.5 and integers
  "^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
);
function resolveYamlFloat(data) {
  if (data === null) return false;
  if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
  // Probably should update regexp & check speed
  data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
);
var YAML_TIMESTAMP_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
);
function resolveYamlTimestamp(data) {
  if (data === null) return false;
  if (YAML_DATE_REGEXP.exec(data) !== null) return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match2, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match2 = YAML_DATE_REGEXP.exec(data);
  if (match2 === null) match2 = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match2 === null) throw new Error("Date resolve error");
  year = +match2[1];
  month = +match2[2] - 1;
  day = +match2[3];
  if (!match2[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match2[4];
  minute = +match2[5];
  second = +match2[6];
  if (match2[7]) {
    fraction = match2[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match2[9]) {
    tz_hour = +match2[10];
    tz_minute = +(match2[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 6e4;
    if (match2[9] === "-") delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta) date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
function resolveYamlBinary(data) {
  if (data === null) return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64) continue;
    if (code < 0) return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0; idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null) return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]") return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true;
        else return false;
      }
    }
    if (!pairHasKey) return false;
    if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
    else return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null) return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]") return false;
    keys = Object.keys(pair);
    if (keys.length !== 1) return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null) return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null) return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null) return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode(
    (c - 65536 >> 10) + 55296,
    (c - 65536 & 1023) + 56320
  );
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    // omit trailing \0
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
var directiveHandlers = {
  YAML: function handleYamlDirective(state, name, args) {
    var match2, major, minor;
    if (state.version !== null) {
      throwError(state, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state, "YAML directive accepts exactly one argument");
    }
    match2 = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match2 === null) {
      throwError(state, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match2[1], 10);
    minor = parseInt(match2[2], 10);
    if (major !== 1) {
      throwError(state, "unacceptable YAML version of the document");
    }
    state.version = args[0];
    state.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state, "unsupported YAML version of the document");
    }
  },
  TAG: function handleTagDirective(state, name, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state, "tag prefix is malformed: " + prefix);
    }
    state.tagMap[handle] = prefix;
  }
};
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat("\n", count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = /* @__PURE__ */ Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += "\n";
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat("\n", emptyLines);
      }
    } else {
      state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = /* @__PURE__ */ Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33) return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38) return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42) return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = /* @__PURE__ */ Object.create(null);
  state.anchorMap = /* @__PURE__ */ Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch)) break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0) readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += "\n";
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\0");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\0";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return void 0;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = '\\"';
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null) return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length; index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf("\n", position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== "\n") result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return "\n" + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (
    // ns-plain-safe
    (inblock ? (
      // c = flow-in
      cIsNsCharOrWhitespace
    ) : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar
  );
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
          i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = (function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(
      string,
      singleLineOnly,
      state.indent,
      lineWidth,
      testAmbiguity,
      state.quotingType,
      state.forceQuotes && !iskey,
      inblock
    )) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  })();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === "\n";
  var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + "\n";
}
function dropEndingNewline(string) {
  return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = (function() {
    var nextLF = string.indexOf("\n");
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  })();
  var prevMoreIndented = string[0] === "\n" || string[0] === " ";
  var moreIndented;
  var match2;
  while (match2 = lineRe.exec(string)) {
    var prefix = match2[1], line = match2[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ") return line;
  var breakRe = / [^ ]/g;
  var match2;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match2 = breakRe.exec(line)) {
    next = match2.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += "\n" + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += "\n";
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
    char = codePointAt(string, i);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i];
      if (char >= 65536) result += string[i + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "") pairBuffer += ", ";
    if (state.condenseFlow) pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024) pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length; index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid) return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(
        state.tag[0] === "!" ? state.tag.slice(1) : state.tag
      ).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length; index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length; index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs) getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
  return "";
}
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
  };
}
var Type = type;
var Schema = schema;
var FAILSAFE_SCHEMA = failsafe;
var JSON_SCHEMA = json;
var CORE_SCHEMA = core;
var DEFAULT_SCHEMA = _default;
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var YAMLException = exception;
var types2 = {
  binary,
  float,
  map,
  null: _null,
  pairs,
  set,
  timestamp,
  bool,
  int,
  merge,
  omap,
  seq,
  str
};
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");
var jsYaml = {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types: types2,
  safeLoad,
  safeLoadAll,
  safeDump
};

// ../../node_modules/.pnpm/@manypkg+tools@2.1.0/node_modules/@manypkg/tools/dist/manypkg-tools.js
var import_jju = __toESM(require_jju(), 1);
var InvalidMonorepoError = class extends Error {
};
var readJson = async (directory, file) => JSON.parse(await fsp__default.readFile(path__default.join(directory, file), "utf-8"));
var readJsonSync = (directory, file) => JSON.parse(fs__default.readFileSync(path__default.join(directory, file), "utf-8"));
async function expandPackageGlobs(packageGlobs, directory) {
  const relativeDirectories = await glob(packageGlobs, {
    cwd: directory,
    onlyDirectories: true,
    ignore: ["**/node_modules"],
    expandDirectories: false
  });
  const directories = relativeDirectories.map((p) => path__default.resolve(directory, p)).sort();
  const discoveredPackages = await Promise.all(directories.map((dir) => fsp__default.readFile(path__default.join(dir, "package.json"), "utf-8").catch((err) => {
    if (err && err.code === "ENOENT") {
      return void 0;
    }
    throw err;
  }).then((result) => {
    if (result) {
      return {
        dir: path__default.resolve(dir),
        relativeDir: path__default.relative(directory, dir),
        packageJson: JSON.parse(result)
      };
    }
  })));
  return discoveredPackages.filter((pkg) => pkg);
}
function expandPackageGlobsSync(packageGlobs, directory) {
  const relativeDirectories = globSync(packageGlobs, {
    cwd: directory,
    onlyDirectories: true,
    ignore: ["**/node_modules"],
    expandDirectories: false
  });
  const directories = relativeDirectories.map((p) => path__default.resolve(directory, p)).sort();
  const discoveredPackages = directories.map((dir) => {
    try {
      const packageJson = readJsonSync(dir, "package.json");
      return {
        dir: path__default.resolve(dir),
        relativeDir: path__default.relative(directory, dir),
        packageJson
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return void 0;
      }
      throw err;
    }
  });
  return discoveredPackages.filter((pkg) => pkg);
}
async function hasBunLockFile(directory) {
  try {
    await Promise.any([fsp.access(path5.join(directory, "bun.lockb"), F_OK), fsp.access(path5.join(directory, "bun.lock"), F_OK)]);
    return true;
  } catch (err) {
    return false;
  }
}
function hasBunLockFileSync(directory) {
  try {
    fs2.accessSync(path5.join(directory, "bun.lockb"), F_OK);
    return true;
  } catch (err) {
    try {
      fs2.accessSync(path5.join(directory, "bun.lock"), F_OK);
      return true;
    } catch (err2) {
      return false;
    }
  }
}
var BunTool = {
  type: "bun",
  async isMonorepoRoot(directory) {
    try {
      const [pkgJson, hasLockFile] = await Promise.all([readJson(directory, "package.json"), hasBunLockFile(directory)]);
      if (pkgJson.workspaces && hasLockFile) {
        if (Array.isArray(pkgJson.workspaces)) {
          return true;
        }
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  isMonorepoRootSync(directory) {
    try {
      const hasLockFile = hasBunLockFileSync(directory);
      if (!hasLockFile) {
        return false;
      }
      const pkgJson = readJsonSync(directory, "package.json");
      if (pkgJson.workspaces) {
        if (Array.isArray(pkgJson.workspaces)) {
          return true;
        }
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  async getPackages(directory) {
    const rootDir = path5.resolve(directory);
    try {
      const pkgJson = await readJson(rootDir, "package.json");
      const packageGlobs = pkgJson.workspaces || [];
      return {
        tool: BunTool,
        packages: await expandPackageGlobs(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${BunTool.type} monorepo root`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path5.resolve(directory);
    try {
      const pkgJson = readJsonSync(rootDir, "package.json");
      const packageGlobs = pkgJson.workspaces || [];
      return {
        tool: BunTool,
        packages: expandPackageGlobsSync(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${BunTool.type} monorepo root`);
      }
      throw err;
    }
  }
};
var LernaTool = {
  type: "lerna",
  async isMonorepoRoot(directory) {
    try {
      const lernaJson = await readJson(directory, "lerna.json");
      if (lernaJson.useWorkspaces !== true) {
        return true;
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  isMonorepoRootSync(directory) {
    try {
      const lernaJson = readJsonSync(directory, "lerna.json");
      if (lernaJson.useWorkspaces !== true) {
        return true;
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  async getPackages(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const lernaJson = await readJson(rootDir, "lerna.json");
      const pkgJson = await readJson(rootDir, "package.json");
      const packageGlobs = lernaJson.packages || ["packages/*"];
      return {
        tool: LernaTool,
        packages: await expandPackageGlobs(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${LernaTool.type} monorepo root: missing lerna.json and/or package.json`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const lernaJson = readJsonSync(rootDir, "lerna.json");
      const pkgJson = readJsonSync(rootDir, "package.json");
      const packageGlobs = lernaJson.packages || ["packages/*"];
      return {
        tool: LernaTool,
        packages: expandPackageGlobsSync(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${LernaTool.type} monorepo root: missing lerna.json and/or package.json`);
      }
      throw err;
    }
  }
};
var NpmTool = {
  type: "npm",
  async isMonorepoRoot(directory) {
    try {
      const [pkgJson] = await Promise.all([readJson(directory, "package.json"), fsp__default.access(path__default.join(directory, "package-lock.json"), F_OK)]);
      if (pkgJson.workspaces) {
        if (Array.isArray(pkgJson.workspaces)) {
          return true;
        }
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  isMonorepoRootSync(directory) {
    try {
      fs__default.accessSync(path__default.join(directory, "package-lock.json"), F_OK);
      const pkgJson = readJsonSync(directory, "package.json");
      if (pkgJson.workspaces) {
        if (Array.isArray(pkgJson.workspaces)) {
          return true;
        }
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  async getPackages(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const pkgJson = await readJson(rootDir, "package.json");
      const packageGlobs = pkgJson.workspaces;
      return {
        tool: NpmTool,
        packages: await expandPackageGlobs(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${NpmTool.type} monorepo root`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const pkgJson = readJsonSync(rootDir, "package.json");
      const packageGlobs = pkgJson.workspaces;
      return {
        tool: NpmTool,
        packages: expandPackageGlobsSync(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${NpmTool.type} monorepo root`);
      }
      throw err;
    }
  }
};
async function readYamlFile(path10) {
  return fsp__default.readFile(path10, "utf8").then((data) => jsYaml.load(data));
}
function readYamlFileSync(path10) {
  return jsYaml.load(fs__default.readFileSync(path10, "utf8"));
}
var PnpmTool = {
  type: "pnpm",
  async isMonorepoRoot(directory) {
    try {
      const manifest = await readYamlFile(path__default.join(directory, "pnpm-workspace.yaml"));
      if (manifest.packages) {
        return true;
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  isMonorepoRootSync(directory) {
    try {
      const manifest = readYamlFileSync(path__default.join(directory, "pnpm-workspace.yaml"));
      if (manifest.packages) {
        return true;
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  async getPackages(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const manifest = await readYamlFile(path__default.join(rootDir, "pnpm-workspace.yaml"));
      const pkgJson = await readJson(rootDir, "package.json");
      const packageGlobs = manifest.packages;
      return {
        tool: PnpmTool,
        packages: await expandPackageGlobs(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${PnpmTool.type} monorepo root: missing pnpm-workspace.yaml and/or package.json`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const manifest = readYamlFileSync(path__default.join(rootDir, "pnpm-workspace.yaml"));
      const pkgJson = readJsonSync(rootDir, "package.json");
      const packageGlobs = manifest.packages;
      return {
        tool: PnpmTool,
        packages: expandPackageGlobsSync(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${PnpmTool.type} monorepo root: missing pnpm-workspace.yaml and/or package.json`);
      }
      throw err;
    }
  }
};
var RootTool = {
  type: "root",
  async isMonorepoRoot(_directory) {
    return false;
  },
  isMonorepoRootSync(_directory) {
    return false;
  },
  async getPackages(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const pkgJson = await readJson(rootDir, "package.json");
      const pkg = {
        dir: rootDir,
        relativeDir: ".",
        packageJson: pkgJson
      };
      return {
        tool: RootTool,
        packages: [pkg],
        rootPackage: pkg,
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${RootTool.type} monorepo root`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const pkgJson = readJsonSync(rootDir, "package.json");
      const pkg = {
        dir: rootDir,
        relativeDir: ".",
        packageJson: pkgJson
      };
      return {
        tool: RootTool,
        packages: [pkg],
        rootPackage: pkg,
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${RootTool.type} monorepo root`);
      }
      throw err;
    }
  }
};
var RushTool = {
  type: "rush",
  async isMonorepoRoot(directory) {
    try {
      await fsp__default.access(path__default.join(directory, "rush.json"), F_OK);
      return true;
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  },
  isMonorepoRootSync(directory) {
    try {
      fs__default.accessSync(path__default.join(directory, "rush.json"), F_OK);
      return true;
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  },
  async getPackages(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const rushText = await fsp__default.readFile(path__default.join(rootDir, "rush.json"), "utf8");
      const rushJson = import_jju.default.parse(rushText);
      const directories = rushJson.projects.map((project) => path__default.resolve(rootDir, project.projectFolder));
      const packages = await Promise.all(directories.map(async (dir) => {
        return {
          dir,
          relativeDir: path__default.relative(directory, dir),
          packageJson: await readJson(dir, "package.json")
        };
      }));
      return {
        tool: RushTool,
        packages,
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${RushTool.type} monorepo root: missing rush.json`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const rushText = fs__default.readFileSync(path__default.join(rootDir, "rush.json"), "utf8");
      const rushJson = import_jju.default.parse(rushText);
      const directories = rushJson.projects.map((project) => path__default.resolve(rootDir, project.projectFolder));
      const packages = directories.map((dir) => {
        const packageJson = readJsonSync(dir, "package.json");
        return {
          dir,
          relativeDir: path__default.relative(directory, dir),
          packageJson
        };
      });
      return {
        tool: RushTool,
        packages,
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${RushTool.type} monorepo root: missing rush.json`);
      }
      throw err;
    }
  }
};
var YarnTool = {
  type: "yarn",
  async isMonorepoRoot(directory) {
    try {
      const [pkgJson] = await Promise.all([readJson(directory, "package.json"), fsp__default.access(path__default.join(directory, "yarn.lock"), F_OK)]);
      if (pkgJson.workspaces) {
        if (Array.isArray(pkgJson.workspaces) || Array.isArray(pkgJson.workspaces.packages)) {
          return true;
        }
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  isMonorepoRootSync(directory) {
    try {
      fs__default.accessSync(path__default.join(directory, "yarn.lock"), F_OK);
      const pkgJson = readJsonSync(directory, "package.json");
      if (pkgJson.workspaces) {
        if (Array.isArray(pkgJson.workspaces) || Array.isArray(pkgJson.workspaces.packages)) {
          return true;
        }
      }
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
    return false;
  },
  async getPackages(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const pkgJson = await readJson(rootDir, "package.json");
      const packageGlobs = Array.isArray(pkgJson.workspaces) ? pkgJson.workspaces : pkgJson.workspaces.packages;
      return {
        tool: YarnTool,
        packages: await expandPackageGlobs(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${YarnTool.type} monorepo root`);
      }
      throw err;
    }
  },
  getPackagesSync(directory) {
    const rootDir = path__default.resolve(directory);
    try {
      const pkgJson = readJsonSync(rootDir, "package.json");
      const packageGlobs = Array.isArray(pkgJson.workspaces) ? pkgJson.workspaces : pkgJson.workspaces.packages;
      return {
        tool: YarnTool,
        packages: expandPackageGlobsSync(packageGlobs, rootDir),
        rootPackage: {
          dir: rootDir,
          relativeDir: ".",
          packageJson: pkgJson
        },
        rootDir
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new InvalidMonorepoError(`Directory ${rootDir} is not a valid ${YarnTool.type} monorepo root`);
      }
      throw err;
    }
  }
};

// ../../node_modules/.pnpm/@manypkg+find-root@3.1.0/node_modules/@manypkg/find-root/dist/manypkg-find-root.js
import fs3 from "fs";
import fsp2 from "fs/promises";
import path6 from "path";
var DEFAULT_TOOLS = [YarnTool, PnpmTool, NpmTool, BunTool, LernaTool, RushTool, RootTool];
var NoPkgJsonFound = class extends Error {
  constructor(directory) {
    super(`No package.json could be found upwards from directory ${directory}`);
    this.directory = directory;
  }
};
var NoMatchingMonorepoFound = class extends Error {
  constructor(directory) {
    super(`No monorepo matching the list of supported monorepos could be found upwards from directory ${directory}`);
    this.directory = directory;
  }
};
function findRootSync(cwd3, options = {}) {
  let monorepoRoot;
  const tools = options.tools || DEFAULT_TOOLS;
  findUpSync((directory) => {
    for (const tool of tools) {
      if (tool.isMonorepoRootSync(directory)) {
        monorepoRoot = {
          tool: tool.type,
          rootDir: directory
        };
        return directory;
      }
    }
  }, cwd3);
  if (monorepoRoot) {
    return monorepoRoot;
  }
  if (!tools.includes(RootTool)) {
    throw new NoMatchingMonorepoFound(cwd3);
  }
  const rootDir = findUpSync((directory) => {
    const exists = fs3.existsSync(path6.join(directory, "package.json"));
    return exists ? directory : void 0;
  }, cwd3);
  if (!rootDir) {
    throw new NoPkgJsonFound(cwd3);
  }
  return {
    tool: RootTool.type,
    rootDir
  };
}
function findUpSync(matcher, cwd3) {
  let directory = path6.resolve(cwd3);
  const {
    root
  } = path6.parse(directory);
  while (directory && directory !== root) {
    const filePath = matcher(directory);
    if (filePath) {
      return path6.resolve(directory, filePath);
    }
    directory = path6.dirname(directory);
  }
}

// ../../node_modules/.pnpm/@manypkg+get-packages@3.1.0/node_modules/@manypkg/get-packages/dist/manypkg-get-packages.js
var PackageJsonMissingNameError = class extends Error {
  constructor(directories) {
    super(`The following package.jsons are missing the "name" field:
${directories.join("\n")}`);
    this.directories = directories;
  }
};
function getPackagesSync(dir, options) {
  const monorepoRoot = findRootSync(dir, options);
  const tools = options?.tools || DEFAULT_TOOLS;
  const tool = tools.find((t) => t.type === monorepoRoot.tool);
  if (!tool) throw new Error(`Could not find ${monorepoRoot.tool} tool`);
  const packages = tool.getPackagesSync(monorepoRoot.rootDir);
  validatePackages(packages);
  return packages;
}
function validatePackages(packages) {
  const pkgJsonsMissingNameField = [];
  for (const pkg of packages.packages) {
    if (!pkg.packageJson.name) {
      pkgJsonsMissingNameField.push(path7.join(pkg.relativeDir, "package.json"));
    }
  }
  if (pkgJsonsMissingNameField.length > 0) {
    pkgJsonsMissingNameField.sort();
    throw new PackageJsonMissingNameError(pkgJsonsMissingNameField);
  }
}

// ../version/dist/chunk-UBCKZYTO.js
import path9 from "path";
import { Command } from "commander";
function parseCargoToml(cargoPath) {
  const content = fs4.readFileSync(cargoPath, "utf-8");
  return TOML.parse(content);
}
function isCargoToml(filePath) {
  return path8.basename(filePath) === "Cargo.toml";
}
var ConfigError = class extends ReleaseKitError {
  code = "CONFIG_ERROR";
  suggestions;
  constructor(message, suggestions) {
    super(message);
    this.suggestions = suggestions ?? [
      "Check that releasekit.config.json exists and is valid JSON",
      "Run with --verbose for more details"
    ];
  }
};
var MAX_JSONC_LENGTH = 1e5;
function parseJsonc(content) {
  if (content.length > MAX_JSONC_LENGTH) {
    throw new Error(`JSONC content too long: ${content.length} characters (max ${MAX_JSONC_LENGTH})`);
  }
  try {
    return JSON.parse(content);
  } catch {
    const cleaned = content.replace(/\/\/[^\r\n]{0,10000}$/gm, "").replace(/\/\*[\s\S]{0,50000}?\*\//g, "").trim();
    return JSON.parse(cleaned);
  }
}
var GitConfigSchema = z.object({
  remote: z.string().default("origin"),
  branch: z.string().default("main"),
  pushMethod: z.enum(["auto", "ssh", "https"]).default("auto"),
  /**
   * Optional env var name containing a GitHub token for HTTPS pushes.
   * When set, publish steps can use this token without mutating git remotes.
   */
  httpsTokenEnv: z.string().optional(),
  push: z.boolean().optional(),
  skipHooks: z.boolean().optional()
});
var MonorepoConfigSchema = z.object({
  mode: z.enum(["root", "packages", "both"]).optional(),
  rootPath: z.string().optional(),
  packagesPath: z.string().optional(),
  mainPackage: z.string().optional()
});
var BranchPatternSchema = z.object({
  pattern: z.string(),
  releaseType: z.enum(["major", "minor", "patch", "prerelease"])
});
var VersionCargoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z.array(z.string()).optional()
});
var VersionConfigSchema = z.object({
  tagTemplate: z.string().default("v{version}"),
  packageSpecificTags: z.boolean().default(false),
  preset: z.string().default("conventional"),
  sync: z.boolean().default(true),
  packages: z.array(z.string()).default([]),
  mainPackage: z.string().optional(),
  updateInternalDependencies: z.enum(["major", "minor", "patch", "no-internal-update"]).default("minor"),
  skip: z.array(z.string()).optional(),
  commitMessage: z.string().optional(),
  versionStrategy: z.enum(["branchPattern", "commitMessage"]).default("commitMessage"),
  branchPatterns: z.array(BranchPatternSchema).optional(),
  defaultReleaseType: z.enum(["major", "minor", "patch", "prerelease"]).optional(),
  mismatchStrategy: z.enum(["error", "warn", "ignore", "prefer-package", "prefer-git"]).default("warn"),
  versionPrefix: z.string().default(""),
  prereleaseIdentifier: z.string().optional(),
  strictReachable: z.boolean().default(false),
  cargo: VersionCargoConfigSchema.optional()
});
var NpmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auth: z.enum(["auto", "oidc", "token"]).default("auto"),
  provenance: z.boolean().default(true),
  access: z.enum(["public", "restricted"]).default("public"),
  registry: z.string().default("https://registry.npmjs.org"),
  copyFiles: z.array(z.string()).default(["LICENSE"]),
  tag: z.string().default("latest")
});
var CargoPublishConfigSchema = z.object({
  enabled: z.boolean().default(false),
  noVerify: z.boolean().default(false),
  publishOrder: z.array(z.string()).default([]),
  clean: z.boolean().default(false)
});
var PublishGitConfigSchema = z.object({
  push: z.boolean().default(true),
  pushMethod: z.enum(["auto", "ssh", "https"]).optional(),
  remote: z.string().optional(),
  branch: z.string().optional(),
  httpsTokenEnv: z.string().optional(),
  skipHooks: z.boolean().optional()
});
var GitHubReleaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  draft: z.boolean().default(true),
  perPackage: z.boolean().default(true),
  prerelease: z.union([z.literal("auto"), z.boolean()]).default("auto"),
  /**
   * Controls the source for the GitHub release body.
   * - 'auto': Use release notes if enabled, else changelog, else GitHub auto-generated.
   * - 'releaseNotes': Use LLM-generated release notes (requires notes.releaseNotes.enabled: true).
   * - 'changelog': Use formatted changelog entries.
   * - 'generated': Use GitHub's auto-generated notes.
   * - 'none': No body.
   */
  body: z.enum(["auto", "releaseNotes", "changelog", "generated", "none"]).default("auto"),
  /**
   * Template string for the GitHub release title when a package name is resolved.
   * Available variables: ${packageName} (original scoped name), ${version} (e.g. "v1.0.0").
   * Version-only tags (e.g. "v1.0.0") always use the tag as-is.
   */
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
  titleTemplate: z.string().default("${packageName}: ${version}")
});
var VerifyRegistryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().positive().default(5),
  initialDelay: z.number().int().positive().default(15e3),
  backoffMultiplier: z.number().positive().default(2)
});
var VerifyConfigSchema = z.object({
  npm: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 5,
    initialDelay: 15e3,
    backoffMultiplier: 2
  }),
  cargo: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 10,
    initialDelay: 3e4,
    backoffMultiplier: 2
  })
});
var PublishConfigSchema = z.object({
  git: PublishGitConfigSchema.optional(),
  npm: NpmConfigSchema.default({
    enabled: true,
    auth: "auto",
    provenance: true,
    access: "public",
    registry: "https://registry.npmjs.org",
    copyFiles: ["LICENSE"],
    tag: "latest"
  }),
  cargo: CargoPublishConfigSchema.default({
    enabled: false,
    noVerify: false,
    publishOrder: [],
    clean: false
  }),
  githubRelease: GitHubReleaseConfigSchema.default({
    enabled: true,
    draft: true,
    perPackage: true,
    prerelease: "auto",
    body: "auto",
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
    titleTemplate: "${packageName}: ${version}"
  }),
  verify: VerifyConfigSchema.default({
    npm: {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 15e3,
      backoffMultiplier: 2
    },
    cargo: {
      enabled: true,
      maxAttempts: 10,
      initialDelay: 3e4,
      backoffMultiplier: 2
    }
  })
});
var TemplateConfigSchema = z.object({
  path: z.string().optional(),
  engine: z.enum(["handlebars", "liquid", "ejs"]).optional()
});
var LocationModeSchema = z.enum(["root", "packages", "both"]);
var ChangelogConfigSchema = z.object({
  mode: LocationModeSchema.optional(),
  file: z.string().optional(),
  templates: TemplateConfigSchema.optional()
});
var LLMOptionsSchema = z.object({
  timeout: z.number().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional()
});
var LLMRetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().optional(),
  initialDelay: z.number().nonnegative().optional(),
  maxDelay: z.number().positive().optional(),
  backoffFactor: z.number().positive().optional()
});
var LLMTasksConfigSchema = z.object({
  summarize: z.boolean().optional(),
  enhance: z.boolean().optional(),
  categorize: z.boolean().optional(),
  releaseNotes: z.boolean().optional()
});
var LLMCategorySchema = z.object({
  name: z.string(),
  description: z.string(),
  scopes: z.array(z.string()).optional()
});
var ScopeRulesSchema = z.object({
  allowed: z.array(z.string()).optional(),
  caseSensitive: z.boolean().default(false),
  invalidScopeAction: z.enum(["remove", "keep", "fallback"]).default("remove"),
  fallbackScope: z.string().optional()
});
var ScopeConfigSchema = z.object({
  mode: z.enum(["restricted", "packages", "none", "unrestricted"]).default("unrestricted"),
  rules: ScopeRulesSchema.optional()
});
var LLMPromptOverridesSchema = z.object({
  enhance: z.string().optional(),
  categorize: z.string().optional(),
  enhanceAndCategorize: z.string().optional(),
  summarize: z.string().optional(),
  releaseNotes: z.string().optional()
});
var LLMPromptsConfigSchema = z.object({
  instructions: LLMPromptOverridesSchema.optional(),
  templates: LLMPromptOverridesSchema.optional()
});
var LLMConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  options: LLMOptionsSchema.optional(),
  concurrency: z.number().int().positive().optional(),
  retry: LLMRetryConfigSchema.optional(),
  tasks: LLMTasksConfigSchema.optional(),
  categories: z.array(LLMCategorySchema).optional(),
  style: z.string().optional(),
  scopes: ScopeConfigSchema.optional(),
  prompts: LLMPromptsConfigSchema.optional()
});
var ReleaseNotesConfigSchema = z.object({
  mode: LocationModeSchema.optional(),
  file: z.string().optional(),
  templates: TemplateConfigSchema.optional(),
  llm: LLMConfigSchema.optional()
});
var NotesInputConfigSchema = z.object({
  source: z.string().optional(),
  file: z.string().optional()
});
var NotesConfigSchema = z.object({
  changelog: z.union([z.literal(false), ChangelogConfigSchema]).optional(),
  releaseNotes: z.union([z.literal(false), ReleaseNotesConfigSchema]).optional(),
  updateStrategy: z.enum(["prepend", "regenerate"]).optional()
});
var CILabelsConfigSchema = z.object({
  stable: z.string().default("release:stable"),
  prerelease: z.string().default("release:prerelease"),
  skip: z.string().default("release:skip"),
  major: z.string().default("release:major"),
  minor: z.string().default("release:minor"),
  patch: z.string().default("release:patch")
});
var CIConfigSchema = z.object({
  releaseStrategy: z.enum(["manual", "direct", "standing-pr", "scheduled"]).default("direct"),
  releaseTrigger: z.enum(["commit", "label"]).default("label"),
  prPreview: z.boolean().default(true),
  autoRelease: z.boolean().default(false),
  /**
   * Commit message prefixes that should not trigger a release.
   * Defaults to `['chore: release ']` to match the release commit template
   * (`chore: release ${packageName} v${version}`) and provide a
   * secondary loop-prevention guard alongside `[skip ci]`.
   */
  skipPatterns: z.array(z.string()).default(["chore: release "]),
  minChanges: z.number().int().positive().default(1),
  labels: CILabelsConfigSchema.default({
    stable: "release:stable",
    prerelease: "release:prerelease",
    skip: "release:skip",
    major: "release:major",
    minor: "release:minor",
    patch: "release:patch"
  })
});
var ReleaseCIConfigSchema = z.object({
  skipPatterns: z.array(z.string().min(1)).optional(),
  minChanges: z.number().int().positive().optional(),
  /** Set to `false` to disable GitHub release creation in CI. */
  githubRelease: z.literal(false).optional(),
  /** Set to `false` to disable changelog generation in CI. */
  notes: z.literal(false).optional()
});
var ReleaseConfigSchema = z.object({
  /**
   * Optional steps to enable. The version step always runs; only 'notes' and
   * 'publish' can be opted out. Omitting a step is equivalent to --skip-<step>.
   */
  steps: z.array(z.enum(["notes", "publish"])).min(1).optional(),
  ci: ReleaseCIConfigSchema.optional()
});
var ReleaseKitConfigSchema = z.object({
  git: GitConfigSchema.optional(),
  monorepo: MonorepoConfigSchema.optional(),
  version: VersionConfigSchema.optional(),
  publish: PublishConfigSchema.optional(),
  notes: NotesConfigSchema.optional(),
  ci: CIConfigSchema.optional(),
  release: ReleaseConfigSchema.optional()
});
var MAX_INPUT_LENGTH = 1e4;
function substituteVariables(value) {
  if (value.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long: ${value.length} characters (max ${MAX_INPUT_LENGTH})`);
  }
  const envPattern = /\{env:([^}]{1,1000})\}/g;
  const filePattern = /\{file:([^}]{1,1000})\}/g;
  let result = value;
  result = result.replace(envPattern, (_, varName) => {
    return process.env[varName] ?? "";
  });
  result = result.replace(filePattern, (_, filePath) => {
    const expandedPath = filePath.startsWith("~") ? path22.join(os.homedir(), filePath.slice(1)) : filePath;
    try {
      return fs22.readFileSync(expandedPath, "utf-8").trim();
    } catch {
      return "";
    }
  });
  return result;
}
var SOLE_REFERENCE_PATTERN = /^\{(?:env|file):[^}]+\}$/;
function substituteInObject(obj) {
  if (typeof obj === "string") {
    const result = substituteVariables(obj);
    if (result === "" && SOLE_REFERENCE_PATTERN.test(obj)) {
      return void 0;
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item));
  }
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteInObject(value);
    }
    return result;
  }
  return obj;
}
var AUTH_DIR = path22.join(os.homedir(), ".config", "releasekit");
var AUTH_FILE = path22.join(AUTH_DIR, "auth.json");
var CONFIG_FILE = "releasekit.config.json";
function loadConfigFile(configPath) {
  if (!fs32.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs32.readFileSync(configPath, "utf-8");
    const parsed = parseJsonc(content);
    const substituted = substituteInObject(parsed);
    return ReleaseKitConfigSchema.parse(substituted);
  } catch (error) {
    if (error instanceof z2.ZodError) {
      const issues = error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new ConfigError(`Config validation errors:
${issues}`);
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}
function loadConfig(options) {
  const cwd3 = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? path32.join(cwd3, CONFIG_FILE);
  return loadConfigFile(configPath);
}
function toVersionConfig(config, gitConfig) {
  if (!config) {
    return {
      tagTemplate: "v{version}",
      packageSpecificTags: false,
      preset: "conventional",
      sync: true,
      packages: [],
      updateInternalDependencies: "minor",
      versionPrefix: "",
      baseBranch: gitConfig?.branch
    };
  }
  return {
    tagTemplate: config.tagTemplate ?? "v{version}",
    packageSpecificTags: config.packageSpecificTags,
    preset: config.preset ?? "conventional",
    sync: config.sync ?? true,
    packages: config.packages ?? [],
    mainPackage: config.mainPackage,
    updateInternalDependencies: config.updateInternalDependencies ?? "minor",
    skip: config.skip,
    commitMessage: config.commitMessage,
    versionStrategy: config.versionStrategy,
    branchPatterns: config.branchPatterns?.map((bp) => ({
      pattern: bp.pattern,
      releaseType: bp.releaseType
    })),
    defaultReleaseType: config.defaultReleaseType,
    mismatchStrategy: config.mismatchStrategy,
    versionPrefix: config.versionPrefix ?? "",
    prereleaseIdentifier: config.prereleaseIdentifier,
    baseBranch: gitConfig?.branch,
    cargo: config.cargo
  };
}
function loadConfig2(options) {
  const fullConfig = loadConfig(options);
  return toVersionConfig(fullConfig.version, fullConfig.git);
}
var VersionError = class extends BaseVersionError {
};
var VersionErrorCode = /* @__PURE__ */ ((VersionErrorCode2) => {
  VersionErrorCode2["CONFIG_REQUIRED"] = "CONFIG_REQUIRED";
  VersionErrorCode2["PACKAGES_NOT_FOUND"] = "PACKAGES_NOT_FOUND";
  VersionErrorCode2["WORKSPACE_ERROR"] = "WORKSPACE_ERROR";
  VersionErrorCode2["INVALID_CONFIG"] = "INVALID_CONFIG";
  VersionErrorCode2["PACKAGE_NOT_FOUND"] = "PACKAGE_NOT_FOUND";
  VersionErrorCode2["VERSION_CALCULATION_ERROR"] = "VERSION_CALCULATION_ERROR";
  return VersionErrorCode2;
})(VersionErrorCode || {});
function createVersionError(code, details) {
  const messages = {
    [
      "CONFIG_REQUIRED"
      /* CONFIG_REQUIRED */
    ]: "Configuration is required",
    [
      "PACKAGES_NOT_FOUND"
      /* PACKAGES_NOT_FOUND */
    ]: "Failed to get packages information",
    [
      "WORKSPACE_ERROR"
      /* WORKSPACE_ERROR */
    ]: "Failed to get workspace packages",
    [
      "INVALID_CONFIG"
      /* INVALID_CONFIG */
    ]: "Invalid configuration",
    [
      "PACKAGE_NOT_FOUND"
      /* PACKAGE_NOT_FOUND */
    ]: "Package not found",
    [
      "VERSION_CALCULATION_ERROR"
      /* VERSION_CALCULATION_ERROR */
    ]: "Failed to calculate version"
  };
  const suggestions = {
    [
      "CONFIG_REQUIRED"
      /* CONFIG_REQUIRED */
    ]: [
      "Create a releasekit.config.json file in your project root",
      "Check the documentation for configuration examples"
    ],
    [
      "PACKAGES_NOT_FOUND"
      /* PACKAGES_NOT_FOUND */
    ]: [
      "Ensure package.json or Cargo.toml files exist in your project",
      "Check workspace configuration (pnpm-workspace.yaml, etc.)",
      "Verify file permissions and paths"
    ],
    [
      "WORKSPACE_ERROR"
      /* WORKSPACE_ERROR */
    ]: [
      "Verify workspace configuration files are valid",
      "Check that workspace packages are accessible",
      "Ensure proper monorepo structure"
    ],
    [
      "INVALID_CONFIG"
      /* INVALID_CONFIG */
    ]: [
      "Validate releasekit.config.json syntax",
      "Check configuration against schema",
      "Review documentation for valid configuration options"
    ],
    [
      "PACKAGE_NOT_FOUND"
      /* PACKAGE_NOT_FOUND */
    ]: [
      "Verify package name spelling and case",
      "Check if package exists in workspace",
      "Review packages configuration in releasekit.config.json"
    ],
    [
      "VERSION_CALCULATION_ERROR"
      /* VERSION_CALCULATION_ERROR */
    ]: [
      "Ensure git repository has commits",
      "Check conventional commit message format",
      "Verify git tags are properly formatted"
    ]
  };
  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;
  return new VersionError(fullMessage, code, suggestions[code]);
}
var _jsonOutputMode = false;
var _pendingWrites = [];
var _jsonData = {
  dryRun: false,
  updates: [],
  changelogs: [],
  sharedEntries: void 0,
  tags: []
};
function enableJsonOutput(dryRun = false) {
  _jsonOutputMode = true;
  _jsonData.dryRun = dryRun;
  _jsonData.updates = [];
  _jsonData.changelogs = [];
  _jsonData.sharedEntries = void 0;
  _jsonData.tags = [];
  _jsonData.commitMessage = void 0;
  _pendingWrites.length = 0;
}
function recordPendingWrite(path10, content) {
  if (!_jsonOutputMode) return;
  _pendingWrites.push({ path: path10, content });
}
function flushPendingWrites() {
  try {
    for (const { path: path10, content } of _pendingWrites) {
      fs42.writeFileSync(path10, content);
    }
  } finally {
    _pendingWrites.length = 0;
  }
}
function isJsonOutputMode() {
  return _jsonOutputMode;
}
function addPackageUpdate(packageName, newVersion, filePath) {
  if (!_jsonOutputMode) return;
  _jsonData.updates.push({
    packageName,
    newVersion,
    filePath
  });
}
function addChangelogData(data) {
  if (!_jsonOutputMode) return;
  _jsonData.changelogs.push(data);
}
function setSharedEntries(entries) {
  if (!_jsonOutputMode) return;
  _jsonData.sharedEntries = entries.length > 0 ? entries : void 0;
}
function addTag(tag) {
  if (!_jsonOutputMode) return;
  _jsonData.tags.push(tag);
}
function setCommitMessage(message) {
  if (!_jsonOutputMode) return;
  _jsonData.commitMessage = message;
}
function getJsonData() {
  return { ..._jsonData };
}
function printJsonOutput() {
  if (_jsonOutputMode) {
    console.log(JSON.stringify(_jsonData, null, 2));
  }
}
function getCurrentBranch() {
  const result = execSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.toString().trim();
}
function log2(message, level = "info") {
  const showDebug = process.env.DEBUG === "true" || process.env.DEBUG === "1";
  if (level === "debug" && !showDebug) {
    return;
  }
  let chalkFn;
  switch (level) {
    case "success":
      chalkFn = chalk.green;
      break;
    case "warning":
      chalkFn = chalk.yellow;
      break;
    case "error":
      chalkFn = chalk.red;
      break;
    case "debug":
      chalkFn = chalk.gray;
      break;
    default:
      chalkFn = chalk.blue;
  }
  const formattedMessage = level === "debug" ? `[DEBUG] ${message}` : message;
  if (isJsonOutputMode()) {
    console.error(chalkFn(formattedMessage));
    return;
  }
  if (level === "error") {
    console.error(chalkFn(formattedMessage));
  } else {
    console.log(chalkFn(formattedMessage));
  }
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function formatVersionPrefix(prefix) {
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}
function formatTag(version, prefix, packageName, template, packageSpecificTags) {
  const sanitizedPackageName = packageName ? sanitizePackageName(packageName) : packageName;
  if (template?.includes("${packageName}") && !packageName) {
    log2(
      `Warning: Your tagTemplate contains \${packageName} but no package name is available.
This will result in an empty package name in the tag (e.g., "@v1.0.0" instead of "my-package@v1.0.0").

To fix this:
\u2022 If using sync mode: Set "packageSpecificTags": true in your config to enable package names in tags
\u2022 If you want global tags: Remove \${packageName} from your tagTemplate (e.g., use "\${prefix}\${version}")
\u2022 If using single/async mode: Ensure your package.json has a valid "name" field`,
      "warning"
    );
  }
  if (template) {
    return template.replace(/\$\{version\}/g, version).replace(/\$\{prefix\}/g, prefix).replace(/\$\{packageName\}/g, sanitizedPackageName || "");
  }
  if (packageSpecificTags && sanitizedPackageName) {
    return `${sanitizedPackageName}@${prefix}${version}`;
  }
  return `${prefix}${version}`;
}
function formatCommitMessage(template, version, packageName, additionalContext) {
  if (template.includes("${packageName}") && !packageName) {
    log2(
      `Warning: Your commitMessage template contains \${packageName} but no package name is available.
This will result in an empty package name in the commit message (e.g., "Release @v1.0.0").

To fix this:
\u2022 If using sync mode: Set "packageSpecificTags": true to enable package names in commits
\u2022 If you want generic commit messages: Remove \${packageName} from your commitMessage template
\u2022 If using single/async mode: Ensure your package.json has a valid "name" field`,
      "warning"
    );
  }
  let result = template.replace(/\$\{version\}/g, version).replace(/\$\{packageName\}/g, packageName || "");
  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      const placeholder = `${key ? `\${${key}}` : ""}`;
      result = result.replace(new RegExp(escapeRegExp(placeholder), "g"), value);
    }
  }
  return result;
}
function getCommitsLength(pkgRoot, sinceTag) {
  try {
    let amount;
    if (sinceTag && sinceTag.trim() !== "") {
      amount = execSync("git", ["rev-list", "--count", `${sinceTag}..HEAD`, pkgRoot]).toString().trim();
    } else {
      const latestTag = execSync("git", ["describe", "--tags", "--abbrev=0"]).toString().trim();
      amount = execSync("git", ["rev-list", "--count", "HEAD", `^${latestTag}`, pkgRoot]).toString().trim();
    }
    return Number(amount);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log2(`Failed to get number of commits since last tag: ${errorMessage}`, "error");
    return 0;
  }
}
async function getLatestTag(versionPrefix) {
  try {
    const tags = await getSemverTags({
      tagPrefix: versionPrefix
    });
    if (tags.length === 0) {
      return "";
    }
    const chronologicalLatest = tags[0];
    const sortedTags = [...tags].sort((a, b) => {
      const versionA = import_semver4.default.clean(a) || "0.0.0";
      const versionB = import_semver4.default.clean(b) || "0.0.0";
      return import_semver4.default.rcompare(versionA, versionB);
    });
    const semanticLatest = sortedTags[0];
    if (semanticLatest !== chronologicalLatest) {
      log2(
        `Tag ordering differs: chronological latest is ${chronologicalLatest}, semantic latest is ${semanticLatest}`,
        "debug"
      );
      log2(`Using semantic latest (${semanticLatest}) to handle out-of-order tag creation`, "info");
    }
    return semanticLatest;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log2(`Failed to get latest tag: ${errorMessage}`, "error");
    if (error instanceof Error && error.message.includes("No names found")) {
      log2("No tags found in the repository.", "info");
    }
    return "";
  }
}
async function lastMergeBranchName(branches, baseBranch) {
  try {
    const escapedBranches = branches.map((branch) => escapeRegExp(branch));
    const branchesRegex = `${escapedBranches.join("/(.*)|")}/(.*)`;
    const { stdout } = await execAsync("git", [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)",
      "refs/heads",
      `--merged=${baseBranch}`
    ]);
    const regex = new RegExp(branchesRegex, "i");
    const matched = stdout.split("\n").map((l) => l.trim()).filter(Boolean).find((b) => regex.test(b));
    return matched ?? null;
  } catch (error) {
    console.error("Error while getting the last branch name:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
async function getLatestTagForPackage(packageName, versionPrefix, options) {
  try {
    const packageSpecificTags = options?.packageSpecificTags ?? false;
    const tagTemplate = options?.tagTemplate || (packageSpecificTags ? `\${packageName}@\${prefix}\${version}` : `\${prefix}\${version}`);
    const sanitizedPackageName = packageName.startsWith("@") ? packageName.slice(1).replace(/\//g, "-") : packageName;
    const escapedPackageName = escapeRegExp(sanitizedPackageName);
    const escapedPrefix = versionPrefix ? escapeRegExp(versionPrefix) : "";
    log2(
      `Looking for tags for package ${packageName} with prefix ${versionPrefix || "none"}, packageSpecificTags: ${packageSpecificTags}`,
      "debug"
    );
    let allTags = [];
    try {
      const { execSync: execSync2 } = await import("./commandExecutor-E44ID5U4-ZQZNV25N.js");
      const tagsOutput = execSync2("git", ["tag", "--sort=-creatordate"], { cwd: process.cwd() });
      allTags = tagsOutput.toString().trim().split("\n").filter((tag) => tag.length > 0);
    } catch (err) {
      log2(`Error getting tags: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    log2(`Retrieved ${allTags.length} tags`, "debug");
    if (packageSpecificTags) {
      const packageTagPattern = escapeRegExp(tagTemplate).replace(/\\\$\\\{packageName\\\}/g, `(?:${escapedPackageName})`).replace(/\\\$\\\{prefix\\\}/g, `(?:${escapedPrefix})`).replace(/\\\$\\\{version\\\}/g, "(?:[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)");
      log2(`Using package tag pattern: ${packageTagPattern}`, "debug");
      const packageTagRegex = new RegExp(`^${packageTagPattern}$`);
      const packageTags = allTags.filter((tag) => packageTagRegex.test(tag));
      log2(`Found ${packageTags.length} matching tags for ${packageName}`, "debug");
      if (packageTags.length > 0) {
        log2(`Found ${packageTags.length} package tags using configured pattern`, "debug");
        log2(`Using most recently created tag: ${packageTags[0]}`, "debug");
        return packageTags[0];
      }
      log2("No matching tags found for configured tag pattern", "debug");
      if (allTags.length > 0) {
        log2(`Available tags: ${allTags.join(", ")}`, "debug");
      } else {
        log2("No tags available in the repository", "debug");
      }
      return "";
    }
    log2(`Package-specific tags disabled for ${packageName}, falling back to global tags`, "debug");
    return "";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log2(`Failed to get latest tag for package ${packageName}: ${errorMessage}`, "error");
    if (error instanceof Error && error.message.includes("No names found")) {
      log2(`No tags found for package ${packageName}.`, "info");
    }
    return "";
  }
}
function getCargoInfo(cargoPath) {
  if (!fs5.existsSync(cargoPath)) {
    log2(`Cargo.toml file not found at: ${cargoPath}`, "error");
    throw new Error(`Cargo.toml file not found at: ${cargoPath}`);
  }
  try {
    const cargo = parseCargoToml(cargoPath);
    if (!cargo.package?.name) {
      log2(`Package name not found in: ${cargoPath}`, "error");
      throw new Error(`Package name not found in: ${cargoPath}`);
    }
    return {
      name: cargo.package.name,
      version: cargo.package.version || "0.0.0",
      path: cargoPath,
      dir: path42.dirname(cargoPath),
      content: cargo
    };
  } catch (error) {
    log2(`Error reading Cargo.toml: ${cargoPath}`, "error");
    if (error instanceof Error) {
      log2(error.message, "error");
      throw error;
    }
    throw new Error(`Failed to process Cargo.toml at ${cargoPath}`);
  }
}
function updateCargoVersion(cargoPath, version, dryRun = false) {
  try {
    const cargo = parseCargoToml(cargoPath);
    const packageName = cargo.package?.name;
    if (!packageName) {
      throw new Error(`No package name found in ${cargoPath}`);
    }
    if (!cargo.package) {
      cargo.package = { name: packageName, version };
    } else {
      cargo.package.version = version;
    }
    const updatedContent = TOML2.stringify(cargo);
    if (dryRun) {
      recordPendingWrite(cargoPath, updatedContent);
    } else {
      fs5.writeFileSync(cargoPath, updatedContent);
    }
    addPackageUpdate(packageName, version, cargoPath);
    log2(`${dryRun ? "[DRY RUN] Would update" : "Updated"} Cargo.toml at ${cargoPath} to version ${version}`, "success");
  } catch (error) {
    log2(`Failed to update Cargo.toml at ${cargoPath}`, "error");
    if (error instanceof Error) {
      log2(error.message, "error");
    }
    throw error;
  }
}
function getVersionFromManifests(packageDir) {
  const packageJsonPath = path52.join(packageDir, "package.json");
  const cargoTomlPath = path52.join(packageDir, "Cargo.toml");
  if (fs6.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs6.readFileSync(packageJsonPath, "utf-8"));
      if (packageJson.version) {
        log2(`Found version ${packageJson.version} in package.json`, "debug");
        return {
          version: packageJson.version,
          manifestFound: true,
          manifestPath: packageJsonPath,
          manifestType: "package.json"
        };
      }
      log2("No version field found in package.json", "debug");
    } catch (packageJsonError) {
      const errMsg = packageJsonError instanceof Error ? packageJsonError.message : String(packageJsonError);
      log2(`Error reading package.json: ${errMsg}`, "warning");
    }
  }
  if (fs6.existsSync(cargoTomlPath)) {
    try {
      const cargoInfo = getCargoInfo(cargoTomlPath);
      if (cargoInfo.version) {
        log2(`Found version ${cargoInfo.version} in Cargo.toml`, "debug");
        return {
          version: cargoInfo.version,
          manifestFound: true,
          manifestPath: cargoTomlPath,
          manifestType: "Cargo.toml"
        };
      }
      log2("No version field found in Cargo.toml", "debug");
    } catch (cargoTomlError) {
      const errMsg = cargoTomlError instanceof Error ? cargoTomlError.message : String(cargoTomlError);
      log2(`Error reading Cargo.toml: ${errMsg}`, "warning");
    }
  }
  return {
    version: null,
    manifestFound: false,
    manifestPath: "",
    manifestType: null
  };
}
function verifyTag(tagName, cwd3) {
  if (!tagName || tagName.trim() === "") {
    return { exists: false, reachable: false, error: "Empty tag name" };
  }
  try {
    execSync("git", ["rev-parse", "--verify", tagName], {
      cwd: cwd3,
      stdio: "ignore"
    });
    return { exists: true, reachable: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("unknown revision") || errorMessage.includes("bad revision") || errorMessage.includes("No such ref")) {
      return {
        exists: false,
        reachable: false,
        error: `Tag '${tagName}' not found in repository`
      };
    }
    return {
      exists: false,
      reachable: false,
      error: `Git error: ${errorMessage}`
    };
  }
}
var STANDARD_BUMP_TYPES = ["major", "minor", "patch"];
function normalizePrereleaseIdentifier(prereleaseIdentifier, config) {
  if (prereleaseIdentifier === true) {
    return config?.prereleaseIdentifier || "next";
  }
  if (typeof prereleaseIdentifier === "string") {
    return prereleaseIdentifier;
  }
  return void 0;
}
function bumpVersion(currentVersion, bumpType, prereleaseIdentifier) {
  if (prereleaseIdentifier && STANDARD_BUMP_TYPES.includes(bumpType) && !import_semver5.default.prerelease(currentVersion)) {
    const preBumpType = `pre${bumpType}`;
    log2(`Creating prerelease version with identifier '${prereleaseIdentifier}' using ${preBumpType}`, "debug");
    return import_semver5.default.inc(currentVersion, preBumpType, prereleaseIdentifier) || "";
  }
  if (import_semver5.default.prerelease(currentVersion) && STANDARD_BUMP_TYPES.includes(bumpType)) {
    const parsed = import_semver5.default.parse(currentVersion);
    if (!parsed) {
      return import_semver5.default.inc(currentVersion, bumpType) || "";
    }
    if (bumpType === "major" && parsed.minor === 0 && parsed.patch === 0 || bumpType === "minor" && parsed.patch === 0 || bumpType === "patch") {
      log2(`Cleaning prerelease identifier from ${currentVersion} for ${bumpType} bump`, "debug");
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    }
    log2(`Standard increment for ${currentVersion} with ${bumpType} bump`, "debug");
    return import_semver5.default.inc(currentVersion, bumpType) || "";
  }
  if (prereleaseIdentifier) {
    return import_semver5.default.inc(currentVersion, bumpType, prereleaseIdentifier) || "";
  }
  return import_semver5.default.inc(currentVersion, bumpType) || "";
}
function detectVersionMismatch(tagVersion, packageVersion) {
  const tagIsPrerelease = import_semver5.default.prerelease(tagVersion) !== null;
  const packageIsPrerelease = import_semver5.default.prerelease(packageVersion) !== null;
  const tagParsed = import_semver5.default.parse(tagVersion);
  const packageParsed = import_semver5.default.parse(packageVersion);
  if (!tagParsed || !packageParsed) {
    return { isMismatch: false, severity: "minor", message: "" };
  }
  if (!tagIsPrerelease && packageIsPrerelease && tagParsed.major === packageParsed.major) {
    return {
      isMismatch: true,
      severity: "major",
      message: `Git tag ${tagVersion} (stable) is ahead of package ${packageVersion} (prerelease). This may indicate a reverted release. Consider deleting tag ${tagVersion} or updating package.json.`
    };
  }
  const tagHigher = import_semver5.default.gt(tagVersion, packageVersion);
  if (tagHigher) {
    const diff = import_semver5.default.diff(packageVersion, tagVersion);
    if (diff === "major" || diff === "minor") {
      return {
        isMismatch: true,
        severity: "major",
        message: `Git tag ${tagVersion} is significantly ahead (${diff}) of package ${packageVersion}. This may cause unexpected version bumps.`
      };
    }
  }
  if (tagIsPrerelease && !packageIsPrerelease) {
    return {
      isMismatch: true,
      severity: "minor",
      message: `Git tag ${tagVersion} is a prerelease but package ${packageVersion} is stable. Consider aligning your versioning.`
    };
  }
  return { isMismatch: false, severity: "minor", message: "" };
}
var VersionMismatchError = class extends Error {
  constructor(message, severity) {
    super(message);
    this.severity = severity;
    this.name = "VersionMismatchError";
  }
};
async function getBestVersionSource(tagName, packageVersion, cwd3, mismatchStrategy = "error", strictReachable = false) {
  if (!tagName?.trim()) {
    return packageVersion ? { source: "package", version: packageVersion, reason: "No git tag provided" } : { source: "initial", version: "0.1.0", reason: "No git tag or package version available" };
  }
  const verification = verifyTag(tagName, cwd3);
  if (!verification.exists || !verification.reachable) {
    if (strictReachable) {
      throw new Error(
        `Git tag '${tagName}' is not reachable from the current commit. The tag exists but cannot be reached from HEAD, which usually means you're on a different branch or the tag is orphaned. To allow fallback to package version, set strictReachable to false in your configuration.`
      );
    }
    if (packageVersion) {
      log2(
        `Git tag '${tagName}' unreachable (${verification.error}), using package version: ${packageVersion}`,
        "warning"
      );
      return { source: "package", version: packageVersion, reason: "Git tag unreachable" };
    }
    log2(`Git tag '${tagName}' unreachable and no package version available, using initial version`, "warning");
    return {
      source: "initial",
      version: "0.1.0",
      reason: "Git tag unreachable, no package version"
    };
  }
  if (!packageVersion) {
    return {
      source: "git",
      version: tagName,
      reason: "Git tag exists, no package version to compare"
    };
  }
  try {
    const cleanTagVersion = tagName.replace(/^.*?([0-9])/, "$1");
    const cleanPackageVersion = packageVersion;
    const mismatch = detectVersionMismatch(cleanTagVersion, cleanPackageVersion);
    const mismatchInfo = mismatch.isMismatch ? { detected: true, severity: mismatch.severity, message: mismatch.message } : void 0;
    if (mismatch.isMismatch) {
      switch (mismatchStrategy) {
        case "error":
          throw new VersionMismatchError(
            `Version mismatch detected: ${mismatch.message}
To resolve: delete the conflicting tag, update package.json, or change mismatchStrategy to 'warn' or 'ignore'`,
            mismatch.severity
          );
        case "warn":
          log2(mismatch.message, "warning");
          log2(
            `Continuing with git tag ${tagName}. To use package version instead, set mismatchStrategy to 'prefer-package'`,
            "warning"
          );
          break;
        case "ignore":
          break;
        case "prefer-package":
          log2(mismatch.message, "warning");
          log2(`Using package version ${packageVersion} due to mismatchStrategy='prefer-package'`, "info");
          return {
            source: "package",
            version: packageVersion,
            reason: "Mismatch detected, using package version per strategy",
            mismatch: mismatchInfo
          };
        case "prefer-git":
          log2(mismatch.message, "warning");
          log2(`Using git tag ${tagName} due to mismatchStrategy='prefer-git'`, "info");
          return {
            source: "git",
            version: tagName,
            reason: "Mismatch detected, using git tag per strategy",
            mismatch: mismatchInfo
          };
      }
    }
    if (import_semver5.default.gt(cleanPackageVersion, cleanTagVersion)) {
      log2(`Package version ${packageVersion} is newer than git tag ${tagName}, using package version`, "info");
      return {
        source: "package",
        version: packageVersion,
        reason: "Package version is newer",
        mismatch: mismatchInfo
      };
    }
    if (import_semver5.default.gt(cleanTagVersion, cleanPackageVersion)) {
      log2(`Git tag ${tagName} is newer than package version ${packageVersion}, using git tag`, "info");
      return {
        source: "git",
        version: tagName,
        reason: "Git tag is newer",
        mismatch: mismatchInfo
      };
    }
    return {
      source: "git",
      version: tagName,
      reason: "Versions equal, using git tag",
      mismatch: mismatchInfo
    };
  } catch (error) {
    if (error instanceof VersionMismatchError) {
      throw error;
    }
    log2(`Failed to compare versions, defaulting to git tag: ${error}`, "warning");
    return { source: "git", version: tagName, reason: "Version comparison failed" };
  }
}
async function calculateVersion(config, options) {
  const {
    type: configType,
    preset = "angular",
    versionPrefix,
    prereleaseIdentifier: configPrereleaseIdentifier,
    branchPattern,
    baseBranch,
    mismatchStrategy,
    strictReachable
  } = config;
  const {
    latestTag,
    name,
    path: pkgPath,
    commitCheckPath,
    type: optionsType,
    prereleaseIdentifier: optionsPrereleaseIdentifier
  } = options;
  const type2 = optionsType || configType;
  const prereleaseIdentifier = optionsPrereleaseIdentifier || configPrereleaseIdentifier;
  const initialVersion = "0.1.0";
  const hasNoTags = !latestTag || latestTag.trim() === "";
  const normalizedPrereleaseId = normalizePrereleaseIdentifier(prereleaseIdentifier, config);
  try {
    let buildTagStripPattern2 = function(packageName, prefix) {
      if (!packageName) return escapeRegExp(prefix);
      const sanitized = sanitizePackageName(packageName);
      const escapedRaw = escapeRegExp(`${packageName}@${prefix}`);
      const escapedDash = escapeRegExp(`${sanitized}-${prefix}`);
      return `(?:${escapedRaw}|${escapedDash})`;
    }, getCurrentVersionFromSource2 = function() {
      if (!versionSource) {
        if (hasNoTags) {
          return initialVersion;
        }
        const cleanedTag = import_semver3.default.clean(latestTag) || latestTag;
        return import_semver3.default.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), "")) || "0.0.0";
      }
      if (versionSource.source === "git") {
        const cleanedTag = import_semver3.default.clean(versionSource.version) || versionSource.version;
        return import_semver3.default.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), "")) || "0.0.0";
      }
      return versionSource.version;
    };
    var buildTagStripPattern = buildTagStripPattern2, getCurrentVersionFromSource = getCurrentVersionFromSource2;
    const originalPrefix = versionPrefix || "";
    const escapedTagPattern = buildTagStripPattern2(name, originalPrefix);
    let versionSource;
    if (pkgPath) {
      const packageDir = pkgPath || cwd();
      const manifestResult = getVersionFromManifests(packageDir);
      const packageVersion = manifestResult.manifestFound && manifestResult.version ? manifestResult.version : void 0;
      versionSource = await getBestVersionSource(
        latestTag,
        packageVersion,
        packageDir,
        mismatchStrategy,
        strictReachable
      );
      log2(`Using version source: ${versionSource.source} (${versionSource.reason})`, "info");
    }
    const specifiedType = type2;
    if (specifiedType) {
      const currentVersion = getCurrentVersionFromSource2();
      const isCurrentPrerelease = import_semver3.default.prerelease(currentVersion);
      const explicitlyRequestedPrerelease = config.isPrerelease;
      if (STANDARD_BUMP_TYPES.includes(specifiedType) && (isCurrentPrerelease || explicitlyRequestedPrerelease)) {
        const prereleaseId2 = explicitlyRequestedPrerelease || isCurrentPrerelease ? normalizedPrereleaseId : void 0;
        log2(
          explicitlyRequestedPrerelease ? `Creating prerelease version with identifier '${prereleaseId2}' using ${specifiedType}` : `Cleaning prerelease identifier from ${currentVersion} for ${specifiedType} bump`,
          "debug"
        );
        return bumpVersion(currentVersion, specifiedType, prereleaseId2);
      }
      const isPrereleaseBumpType = ["prerelease", "premajor", "preminor", "prepatch"].includes(specifiedType);
      const prereleaseId = config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : void 0;
      return bumpVersion(currentVersion, specifiedType, prereleaseId);
    }
    if (branchPattern && branchPattern.length > 0) {
      const currentBranch = getCurrentBranch();
      if (baseBranch) {
        lastMergeBranchName(branchPattern, baseBranch);
      }
      const branchToCheck = currentBranch;
      let branchVersionType;
      for (const pattern of branchPattern) {
        if (!pattern.includes(":")) {
          log2(`Invalid branch pattern "${pattern}" - missing colon. Skipping.`, "warning");
          continue;
        }
        const [patternRegex, releaseType] = pattern.split(":");
        if (new RegExp(patternRegex).test(branchToCheck)) {
          branchVersionType = releaseType;
          log2(`Using branch pattern ${patternRegex} for version type ${releaseType}`, "debug");
          break;
        }
      }
      if (branchVersionType) {
        const currentVersion = getCurrentVersionFromSource2();
        log2(`Applying ${branchVersionType} bump based on branch pattern`, "debug");
        const isPrereleaseBumpType = ["prerelease", "premajor", "preminor", "prepatch"].includes(branchVersionType);
        const prereleaseId = config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : void 0;
        return bumpVersion(currentVersion, branchVersionType, prereleaseId);
      }
    }
    try {
      const bumper = new Bumper();
      bumper.loadPreset(preset);
      const recommendedBump = await bumper.bump();
      const releaseTypeFromCommits = recommendedBump && "releaseType" in recommendedBump ? recommendedBump.releaseType : void 0;
      const currentVersion = getCurrentVersionFromSource2();
      if (versionSource && versionSource.source === "git") {
        const checkPath = commitCheckPath || pkgPath || cwd();
        const commitsLength = getCommitsLength(checkPath, versionSource.version);
        if (commitsLength === 0) {
          log2(
            `No new commits found for ${name || "project"} since ${versionSource.version}, skipping version bump`,
            "info"
          );
          return "";
        }
      } else if (versionSource && versionSource.source === "package") {
        log2(
          `Using package version ${versionSource.version} as base, letting conventional commits determine bump necessity`,
          "debug"
        );
      }
      if (!releaseTypeFromCommits) {
        if (latestTag && latestTag.trim() !== "") {
          log2(`No relevant commits found for ${name || "project"} since ${latestTag}, skipping version bump`, "info");
        } else {
          log2(`No relevant commits found for ${name || "project"}, skipping version bump`, "info");
        }
        return "";
      }
      const isPrereleaseBumpType = ["prerelease", "premajor", "preminor", "prepatch"].includes(releaseTypeFromCommits);
      const prereleaseId = config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : void 0;
      return bumpVersion(currentVersion, releaseTypeFromCommits, prereleaseId);
    } catch (error) {
      log2(`Failed to calculate version for ${name || "project"}`, "error");
      console.error(error);
      if (error instanceof Error && error.message.includes("No names found")) {
        log2("No tags found, proceeding with initial version calculation (if applicable).", "info");
        return initialVersion;
      }
      throw error;
    }
  } catch (error) {
    log2(`Failed to calculate version for ${name || "project"}`, "error");
    console.error(error);
    if (error instanceof Error && error.message.includes("No names found")) {
      log2("No tags found, proceeding with initial version calculation (if applicable).", "info");
      return initialVersion;
    }
    throw error;
  }
}
var CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)(?:\n\n([\s\S]*))?/;
var BREAKING_CHANGE_REGEX = /BREAKING CHANGE: ([\s\S]+?)(?:\n\n|$)/;
function extractAllChangelogEntriesWithHash(projectDir, revisionRange) {
  try {
    const args = ["log", revisionRange, "--pretty=format:%H|||%B---COMMIT_DELIMITER---", "--no-merges"];
    const output3 = execSync("git", args, { cwd: projectDir, encoding: "utf8" }).toString();
    const commits = output3.split("---COMMIT_DELIMITER---").filter((commit) => commit.trim() !== "");
    return commits.map((commit) => {
      const [hash, ...messageParts] = commit.split("|||");
      const message = messageParts.join("|||").trim();
      const entry = parseCommitMessage(message);
      if (entry && hash) {
        return { hash: hash.trim(), entry };
      }
      return null;
    }).filter((item) => item !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log2(`Error extracting all commits with hash: ${errorMessage}`, "error");
    return [];
  }
}
function commitTouchesAnyPackage(projectDir, commitHash, packageDirs, sharedPackageDirs = []) {
  try {
    const output3 = execSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commitHash], {
      cwd: projectDir,
      encoding: "utf8"
    }).toString().trim();
    if (!output3) {
      return false;
    }
    const changedFiles = output3.split("\n");
    return changedFiles.some((file) => {
      return packageDirs.some((pkgDir) => {
        if (sharedPackageDirs.some((sharedDir) => pkgDir.includes(sharedDir))) {
          return false;
        }
        const normalizedFile = file.replace(/\\/g, "/");
        const normalizedPkgDir = pkgDir.replace(/\\/g, "/").replace(/^\.\//, "");
        return normalizedFile.startsWith(normalizedPkgDir);
      });
    });
  } catch (error) {
    log2(
      `Error checking if commit ${commitHash} touches packages: ${error instanceof Error ? error.message : String(error)}`,
      "debug"
    );
    return false;
  }
}
function extractRepoLevelChangelogEntries(projectDir, revisionRange, packageDirs, sharedPackageDirs = []) {
  try {
    const allCommits = extractAllChangelogEntriesWithHash(projectDir, revisionRange);
    const repoLevelCommits = allCommits.filter((commit) => {
      const touchesPackage = commitTouchesAnyPackage(projectDir, commit.hash, packageDirs, sharedPackageDirs);
      return !touchesPackage;
    });
    if (repoLevelCommits.length > 0) {
      log2(
        `Found ${repoLevelCommits.length} repo-level commit(s) (including shared packages: ${sharedPackageDirs.join(", ")})`,
        "debug"
      );
    }
    return repoLevelCommits.map((c) => c.entry);
  } catch (error) {
    log2(`Error extracting repo-level commits: ${error instanceof Error ? error.message : String(error)}`, "warning");
    return [];
  }
}
function extractChangelogEntriesFromCommits(projectDir, revisionRange) {
  return extractCommitsFromGitLog(projectDir, revisionRange, true);
}
function extractCommitsFromGitLog(projectDir, revisionRange, filterToPath) {
  try {
    const args = ["log", revisionRange, "--pretty=format:%B---COMMIT_DELIMITER---", "--no-merges"];
    if (filterToPath) {
      args.push("--", ".");
    }
    const output3 = execSync("git", args, { cwd: projectDir, encoding: "utf8" }).toString();
    const commits = output3.split("---COMMIT_DELIMITER---").filter((commit) => commit.trim() !== "");
    return commits.map((commit) => parseCommitMessage(commit)).filter((entry) => entry !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("ambiguous argument") && errorMessage.includes("unknown revision")) {
      const tagName = revisionRange.split("..")[0] || revisionRange;
      if (tagName.startsWith("v") && !tagName.includes("@")) {
        log2(
          `Error: Tag "${tagName}" not found. If you're using package-specific tags (like "package-name@v1.0.0"), you may need to configure "tagTemplate" in your releasekit.config.json to use: \${packageName}@\${prefix}\${version}`,
          "error"
        );
      } else {
        log2(
          `Error: Tag or revision "${tagName}" not found in the repository. Please check if this tag exists or if you need to fetch it from the remote.`,
          "error"
        );
      }
    } else {
      log2(`Error extracting commits: ${errorMessage}`, "error");
    }
    return [];
  }
}
function parseCommitMessage(message) {
  const trimmedMessage = message.trim();
  const match2 = trimmedMessage.match(CONVENTIONAL_COMMIT_REGEX);
  if (match2) {
    const [, type2, scope, breakingMark, subject, body = ""] = match2;
    const breakingFromMark = breakingMark === "!";
    const breakingChangeMatch = body.match(BREAKING_CHANGE_REGEX);
    const hasBreakingChange = breakingFromMark || breakingChangeMatch !== null;
    const changelogType = mapCommitTypeToChangelogType(type2);
    if (!changelogType) {
      return null;
    }
    const issueIds = extractIssueIds(body);
    let description = subject;
    if (hasBreakingChange) {
      description = `**BREAKING** ${description}`;
    }
    return {
      type: changelogType,
      description,
      scope: scope || void 0,
      issueIds: issueIds.length > 0 ? issueIds : void 0,
      originalType: type2
      // Store original type for custom formatting
    };
  }
  if (!trimmedMessage.startsWith("Merge") && !trimmedMessage.match(/^v?\d+\.\d+\.\d+/)) {
    const firstLine = trimmedMessage.split("\n")[0].trim();
    return {
      type: "changed",
      description: firstLine
    };
  }
  return null;
}
function mapCommitTypeToChangelogType(type2) {
  switch (type2) {
    case "feat":
      return "added";
    case "fix":
      return "fixed";
    case "docs":
    case "style":
    case "refactor":
    case "perf":
    case "build":
    case "ci":
      return "changed";
    case "revert":
      return "removed";
    case "chore":
      return "changed";
    case "test":
      return null;
    default:
      return "changed";
  }
}
function extractIssueIds(body) {
  const issueRegex = /(?:fix|fixes|close|closes|resolve|resolves)\s+#(\d+)/gi;
  const issueIds = [];
  let match2 = issueRegex.exec(body);
  while (match2 !== null) {
    issueIds.push(`#${match2[1]}`);
    match2 = issueRegex.exec(body);
  }
  return issueIds;
}
function matchesPackageTarget(packageName, target) {
  if (packageName === target) {
    return true;
  }
  if (target.startsWith("@") && target.endsWith("/*") && !target.includes("**")) {
    const scope = target.slice(0, -2);
    return packageName.startsWith(`${scope}/`);
  }
  try {
    return minimatch(packageName, target, {
      dot: true
    });
  } catch (error) {
    log2(`Invalid pattern "${target}": ${error instanceof Error ? error.message : String(error)}`, "warning");
    return false;
  }
}
function shouldMatchPackageTargets(packageName, targets) {
  return targets.some((target) => matchesPackageTarget(packageName, target));
}
function shouldProcessPackage(packageName, skip = []) {
  if (skip.length === 0) {
    return true;
  }
  return !shouldMatchPackageTargets(packageName, skip);
}
function updatePackageVersion(packagePath, version, dryRun = false) {
  if (isCargoToml(packagePath)) {
    updateCargoVersion(packagePath, version, dryRun);
    return;
  }
  try {
    const packageContent = fs8.readFileSync(packagePath, "utf8");
    const packageJson = JSON.parse(packageContent);
    const packageName = packageJson.name;
    const updatedContent = `${JSON.stringify({ ...packageJson, version }, null, 2)}
`;
    if (dryRun) {
      recordPendingWrite(packagePath, updatedContent);
    } else {
      fs8.writeFileSync(packagePath, updatedContent);
    }
    addPackageUpdate(packageName, version, packagePath);
    log2(
      `${dryRun ? "[DRY RUN] Would update" : "Updated"} package.json at ${packagePath} to version ${version}`,
      "success"
    );
  } catch (error) {
    log2(`Failed to update package.json at ${packagePath}`, "error");
    if (error instanceof Error) {
      log2(error.message, "error");
    }
    throw error;
  }
}
var PackageProcessor = class {
  skip;
  versionPrefix;
  tagTemplate;
  commitMessageTemplate;
  dryRun;
  getLatestTag;
  config;
  // Config for version calculation
  fullConfig;
  constructor(options) {
    this.skip = options.skip || [];
    this.versionPrefix = options.versionPrefix || "v";
    this.tagTemplate = options.tagTemplate;
    this.commitMessageTemplate = options.commitMessageTemplate || "";
    this.dryRun = options.dryRun || false;
    this.getLatestTag = options.getLatestTag;
    this.config = options.config;
    this.fullConfig = options.fullConfig;
  }
  /**
   * Process packages based on skip list only (targeting handled at discovery time)
   */
  async processPackages(packages) {
    const tags = [];
    const updatedPackagesInfo = [];
    if (!packages || !Array.isArray(packages)) {
      log2("Invalid packages data provided. Expected array of packages.", "error");
      return { updatedPackages: [], tags: [] };
    }
    const pkgsToConsider = packages.filter((pkg) => {
      const pkgName = pkg.packageJson.name;
      const shouldProcess = shouldProcessPackage(pkgName, this.skip);
      if (!shouldProcess) {
        log2(`Skipping package ${pkgName} as it's in the skip list.`, "info");
      }
      return shouldProcess;
    });
    log2(`Found ${pkgsToConsider.length} package(s) to process after filtering.`, "info");
    if (pkgsToConsider.length === 0) {
      log2("No packages found to process.", "info");
      return { updatedPackages: [], tags: [] };
    }
    const sharedEntriesMap = /* @__PURE__ */ new Map();
    for (const pkg of pkgsToConsider) {
      const name = pkg.packageJson.name;
      const pkgPath = pkg.dir;
      log2(`Processing package ${name} at path: ${pkgPath}`, "info");
      const formattedPrefix = formatVersionPrefix(this.versionPrefix);
      let latestTagResult = "";
      try {
        latestTagResult = await getLatestTagForPackage(name, this.versionPrefix, {
          tagTemplate: this.tagTemplate,
          packageSpecificTags: this.fullConfig.packageSpecificTags
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log2(`Error getting package-specific tag for ${name}, falling back to global tag: ${errorMessage}`, "warning");
      }
      if (!latestTagResult) {
        try {
          const packageDir = pkgPath;
          let manifestFallbackUsed = false;
          const manifestResult = getVersionFromManifests(packageDir);
          if (manifestResult.manifestFound && manifestResult.version) {
            log2(
              `Using ${manifestResult.manifestType} version ${manifestResult.version} for ${name} as no package-specific tags found`,
              "info"
            );
            log2(`FALLBACK: Using package version from ${manifestResult.manifestType} instead of global tag`, "debug");
            latestTagResult = `${this.versionPrefix || ""}${manifestResult.version}`;
            manifestFallbackUsed = true;
          }
          if (!manifestFallbackUsed) {
            const globalTagResult = await this.getLatestTag();
            if (globalTagResult) {
              latestTagResult = globalTagResult;
              log2(`Using global tag ${globalTagResult} as fallback for package ${name}`, "info");
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log2(`Error getting fallback version, using empty tag value: ${errorMessage}`, "warning");
        }
      }
      const latestTag = latestTagResult;
      const nextVersion = await calculateVersion(this.fullConfig, {
        latestTag,
        versionPrefix: formattedPrefix,
        path: pkgPath,
        name,
        branchPattern: this.config.branchPattern,
        baseBranch: this.config.baseBranch,
        prereleaseIdentifier: this.config.prereleaseIdentifier,
        type: this.config.type
      });
      if (!nextVersion) {
        continue;
      }
      let changelogEntries = [];
      let revisionRange = "HEAD";
      try {
        if (latestTag) {
          const verification = verifyTag(latestTag, pkgPath);
          if (verification.exists && verification.reachable) {
            revisionRange = `${latestTag}..HEAD`;
          } else {
            if (this.config.strictReachable) {
              throw new Error(
                `Cannot generate changelog: tag '${latestTag}' is not reachable from the current commit. When strictReachable is enabled, all tags must be reachable. To allow fallback to all commits, set strictReachable to false.`
              );
            }
            log2(`Tag ${latestTag} is unreachable (${verification.error}), using all commits for changelog`, "debug");
            revisionRange = "HEAD";
          }
        } else {
          revisionRange = "HEAD";
        }
        changelogEntries = extractChangelogEntriesFromCommits(pkgPath, revisionRange);
        const allPackageDirs = packages.map((p) => p.dir);
        const sharedPackageNames = ["config", "core", "@releasekit/config", "@releasekit/core"];
        const sharedPackageDirs = packages.filter((p) => sharedPackageNames.includes(p.packageJson.name)).map((p) => p.dir);
        const repoLevelEntries = extractRepoLevelChangelogEntries(
          pkgPath,
          revisionRange,
          allPackageDirs,
          sharedPackageDirs
        );
        if (repoLevelEntries.length > 0) {
          log2(`Found ${repoLevelEntries.length} repo-level commit(s) for ${name}`, "debug");
          for (const entry of repoLevelEntries) {
            sharedEntriesMap.set(`${entry.type}:${entry.description}`, entry);
          }
        }
        if (changelogEntries.length === 0) {
          changelogEntries = [
            {
              type: "changed",
              description: `Update version to ${nextVersion}`
            }
          ];
        }
      } catch (error) {
        log2(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, "warning");
        changelogEntries = [
          {
            type: "changed",
            description: `Update version to ${nextVersion}`
          }
        ];
      }
      let repoUrl;
      try {
        const packageJsonPath2 = path72.join(pkgPath, "package.json");
        if (fs9.existsSync(packageJsonPath2)) {
          const packageJson = JSON.parse(fs9.readFileSync(packageJsonPath2, "utf8"));
          if (packageJson.repository) {
            if (typeof packageJson.repository === "string") {
              repoUrl = packageJson.repository;
            } else if (packageJson.repository.url) {
              repoUrl = packageJson.repository.url;
            }
            if (repoUrl?.startsWith("git+") && repoUrl?.endsWith(".git")) {
              repoUrl = repoUrl.substring(4, repoUrl.length - 4);
            }
          }
        }
      } catch (error) {
        log2(
          `Could not determine repository URL for changelog links: ${error instanceof Error ? error.message : String(error)}`,
          "warning"
        );
      }
      addChangelogData({
        packageName: name,
        version: nextVersion,
        previousVersion: latestTag || null,
        revisionRange,
        repoUrl: repoUrl || null,
        entries: changelogEntries
      });
      const packageJsonPath = path72.join(pkgPath, "package.json");
      if (fs9.existsSync(packageJsonPath)) {
        updatePackageVersion(packageJsonPath, nextVersion, this.dryRun);
      }
      const cargoEnabled = this.fullConfig.cargo?.enabled !== false;
      log2(`Cargo enabled for ${name}: ${cargoEnabled}, config: ${JSON.stringify(this.fullConfig.cargo)}`, "debug");
      if (cargoEnabled) {
        const cargoPaths = this.fullConfig.cargo?.paths;
        log2(`Cargo paths config for ${name}: ${JSON.stringify(cargoPaths)}`, "debug");
        if (cargoPaths && cargoPaths.length > 0) {
          for (const cargoPath of cargoPaths) {
            const resolvedCargoPath = path72.resolve(pkgPath, cargoPath, "Cargo.toml");
            log2(`Checking cargo path for ${name}: ${resolvedCargoPath}`, "debug");
            if (fs9.existsSync(resolvedCargoPath)) {
              log2(`Found Cargo.toml for ${name} at ${resolvedCargoPath}, updating...`, "debug");
              updatePackageVersion(resolvedCargoPath, nextVersion, this.dryRun);
            } else {
              log2(`Cargo.toml not found at ${resolvedCargoPath}`, "debug");
            }
          }
        } else {
          const cargoTomlPath = path72.join(pkgPath, "Cargo.toml");
          log2(`Checking default cargo path for ${name}: ${cargoTomlPath}`, "debug");
          if (fs9.existsSync(cargoTomlPath)) {
            log2(`Found Cargo.toml for ${name} at ${cargoTomlPath}, updating...`, "debug");
            updatePackageVersion(cargoTomlPath, nextVersion, this.dryRun);
          } else {
            log2(`Cargo.toml not found for ${name} at ${cargoTomlPath}`, "debug");
          }
        }
      } else {
        log2(`Cargo disabled for ${name}`, "debug");
      }
      const packageTag = formatTag(
        nextVersion,
        this.versionPrefix,
        name,
        this.tagTemplate,
        this.fullConfig.packageSpecificTags
      );
      addTag(packageTag);
      tags.push(packageTag);
      if (this.dryRun) {
        log2(`[DRY RUN] Would create tag: ${packageTag}`, "info");
      } else {
        log2(`Version ${nextVersion} prepared (tag: ${packageTag})`, "success");
      }
      updatedPackagesInfo.push({ name, version: nextVersion, path: pkgPath });
    }
    setSharedEntries([...sharedEntriesMap.values()]);
    if (updatedPackagesInfo.length === 0) {
      log2("No packages required a version update.", "info");
      return { updatedPackages: [], tags };
    }
    const packageNames = updatedPackagesInfo.map((p) => p.name).join(", ");
    const representativeVersion = updatedPackagesInfo[0]?.version || "multiple";
    const versionsMatch = updatedPackagesInfo.length <= 1 || updatedPackagesInfo.every((p) => p.version === representativeVersion);
    let commitMessage = this.commitMessageTemplate || "chore: release";
    const MAX_COMMIT_MSG_LENGTH = 1e4;
    if (commitMessage.length > MAX_COMMIT_MSG_LENGTH) {
      log2("Commit message template too long, truncating", "warning");
      commitMessage = commitMessage.slice(0, MAX_COMMIT_MSG_LENGTH);
    }
    const placeholderRegex = /\$\{[^{}$]{1,1000}\}/;
    if (placeholderRegex.test(commitMessage)) {
      const packageName = updatedPackagesInfo.length === 1 ? updatedPackagesInfo[0].name : packageNames;
      commitMessage = formatCommitMessage(commitMessage, representativeVersion, packageName);
    } else {
      if (versionsMatch) {
        const formattedVersion = `${formatVersionPrefix(this.versionPrefix)}${representativeVersion}`;
        commitMessage = `${commitMessage} ${packageNames} ${formattedVersion}`;
      } else {
        const packageVersionList = updatedPackagesInfo.map((p) => `${p.name}@${p.version}`).join(", ");
        commitMessage = `${commitMessage} ${packageVersionList}`;
      }
    }
    setCommitMessage(commitMessage);
    if (this.dryRun) {
      log2(`[DRY RUN] Would commit with message: "${commitMessage}"`, "info");
    }
    return {
      updatedPackages: updatedPackagesInfo,
      commitMessage,
      tags
    };
  }
};
function shouldProcessPackage2(pkg, config) {
  const pkgName = pkg.packageJson.name;
  return shouldProcessPackage(pkgName, config.skip);
}
function updateCargoFiles(packageDir, version, cargoConfig, dryRun = false) {
  const updatedFiles = [];
  const cargoEnabled = cargoConfig?.enabled !== false;
  if (!cargoEnabled) {
    return updatedFiles;
  }
  const cargoPaths = cargoConfig?.paths;
  if (cargoPaths && cargoPaths.length > 0) {
    for (const cargoPath of cargoPaths) {
      const resolvedCargoPath = path82.resolve(packageDir, cargoPath, "Cargo.toml");
      if (fs10.existsSync(resolvedCargoPath)) {
        updatePackageVersion(resolvedCargoPath, version, dryRun);
        updatedFiles.push(resolvedCargoPath);
      }
    }
  } else {
    const cargoTomlPath = path82.join(packageDir, "Cargo.toml");
    if (fs10.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, version, dryRun);
      updatedFiles.push(cargoTomlPath);
    }
  }
  return updatedFiles;
}
function createSyncStrategy(config) {
  return async (packages) => {
    try {
      const {
        versionPrefix,
        tagTemplate,
        baseBranch,
        branchPattern,
        commitMessage = `chore: release \${packageName} v\${version}`,
        prereleaseIdentifier,
        dryRun,
        mainPackage
      } = config;
      const formattedPrefix = formatVersionPrefix(versionPrefix || "v");
      let latestTag = await getLatestTag();
      const repoRoot = packages.root ?? process.cwd();
      let mainPkgPath = packages.root;
      let mainPkgName;
      let versionSourcePath = mainPkgPath;
      let versionSourceName;
      if (mainPackage) {
        const mainPkg = packages.packages.find((p) => p.packageJson.name === mainPackage);
        if (mainPkg) {
          mainPkgPath = mainPkg.dir;
          mainPkgName = mainPkg.packageJson.name;
          versionSourcePath = mainPkgPath;
          versionSourceName = mainPkgName;
          log2(`Using ${mainPkgName} as primary package for version determination`, "info");
        } else {
          log2(`Main package '${mainPackage}' not found. Using root package for version determination.`, "warning");
        }
      } else if (packages.packages.length > 0) {
        versionSourcePath = packages.packages[0].dir;
        versionSourceName = packages.packages[0].packageJson.name;
        log2(`No mainPackage specified; using ${versionSourceName} as sync version source`, "info");
      }
      if (!mainPkgPath) {
        mainPkgPath = process.cwd();
        log2(`No valid package path found, using current working directory: ${mainPkgPath}`, "warning");
      }
      if (versionSourceName) {
        const packageSpecificTag = await getLatestTagForPackage(versionSourceName, formattedPrefix, {
          tagTemplate,
          packageSpecificTags: config.packageSpecificTags
        });
        if (packageSpecificTag) {
          latestTag = packageSpecificTag;
          log2(`Using package-specific tag for ${versionSourceName}: ${latestTag}`, "debug");
        } else {
          log2(`No package-specific tag found for ${versionSourceName}, using global tag: ${latestTag}`, "debug");
        }
      }
      const nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern,
        baseBranch,
        prereleaseIdentifier,
        path: versionSourcePath,
        commitCheckPath: repoRoot,
        name: versionSourceName,
        type: config.type
      });
      if (!nextVersion) {
        const msg = mainPkgName ? `No version change needed for ${mainPkgName}` : "No version change needed";
        log2(msg, "info");
        return;
      }
      const files = [];
      const updatedPackages = [];
      const processedPaths = /* @__PURE__ */ new Set();
      try {
        if (packages.root) {
          const rootPkgPath = path82.join(packages.root, "package.json");
          if (fs10.existsSync(rootPkgPath)) {
            updatePackageVersion(rootPkgPath, nextVersion, dryRun);
            files.push(rootPkgPath);
            updatedPackages.push("root");
            processedPaths.add(rootPkgPath);
            const rootCargoFiles = updateCargoFiles(packages.root, nextVersion, config.cargo, dryRun);
            files.push(...rootCargoFiles);
          }
        } else {
          log2("Root package path is undefined, skipping root package.json update", "warning");
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        log2(`Failed to update root package.json: ${errMessage}`, "error");
      }
      for (const pkg of packages.packages) {
        if (!shouldProcessPackage2(pkg, config)) {
          continue;
        }
        const packageJsonPath = path82.join(pkg.dir, "package.json");
        if (processedPaths.has(packageJsonPath)) {
          continue;
        }
        updatePackageVersion(packageJsonPath, nextVersion, dryRun);
        files.push(packageJsonPath);
        updatedPackages.push(pkg.packageJson.name);
        processedPaths.add(packageJsonPath);
        const pkgCargoFiles = updateCargoFiles(pkg.dir, nextVersion, config.cargo, dryRun);
        files.push(...pkgCargoFiles);
      }
      if (updatedPackages.length > 0) {
        log2(`Updated ${updatedPackages.length} package(s) to version ${nextVersion}`, "success");
      } else {
        log2("No packages were updated", "warning");
        return;
      }
      let changelogEntries = [];
      let revisionRange = "HEAD";
      try {
        if (latestTag) {
          try {
            execSync("git", ["rev-parse", "--verify", latestTag], {
              cwd: mainPkgPath,
              stdio: "ignore"
            });
            revisionRange = `${latestTag}..HEAD`;
          } catch {
            if (config.strictReachable) {
              throw new Error(
                `Cannot generate changelog: tag '${latestTag}' is not reachable from the current commit. When strictReachable is enabled, all tags must be reachable. To allow fallback to all commits, set strictReachable to false.`
              );
            }
            log2(`Tag ${latestTag} doesn't exist, using all commits for changelog`, "debug");
            revisionRange = "HEAD";
          }
        }
        changelogEntries = extractChangelogEntriesFromCommits(mainPkgPath, revisionRange);
        if (changelogEntries.length === 0) {
          changelogEntries = [
            {
              type: "changed",
              description: `Update version to ${nextVersion}`
            }
          ];
        }
      } catch (error) {
        log2(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, "warning");
        changelogEntries = [
          {
            type: "changed",
            description: `Update version to ${nextVersion}`
          }
        ];
      }
      const workspaceNames = updatedPackages.filter((n) => n !== "root");
      let repoUrl = null;
      for (const searchPath of [mainPkgPath, versionSourcePath].filter(Boolean)) {
        try {
          const pkgJsonPath = path82.join(searchPath, "package.json");
          if (fs10.existsSync(pkgJsonPath)) {
            const pkgJson = JSON.parse(fs10.readFileSync(pkgJsonPath, "utf8"));
            let url;
            if (typeof pkgJson.repository === "string") {
              url = pkgJson.repository;
            } else if (pkgJson.repository?.url) {
              url = pkgJson.repository.url;
            }
            if (url) {
              if (url.startsWith("git+")) {
                url = url.slice(4);
              }
              if (url.endsWith(".git")) {
                url = url.slice(0, -4);
              }
              repoUrl = url;
              break;
            }
          }
        } catch {
        }
      }
      if (config.packageSpecificTags && workspaceNames.length > 0) {
        for (const pkgName of workspaceNames) {
          addChangelogData({
            packageName: pkgName,
            version: nextVersion,
            previousVersion: latestTag || null,
            revisionRange,
            repoUrl,
            entries: changelogEntries
          });
        }
      } else {
        addChangelogData({
          packageName: mainPkgName || "monorepo",
          version: nextVersion,
          previousVersion: latestTag || null,
          revisionRange,
          repoUrl,
          entries: changelogEntries
        });
      }
      const commitPackageName = workspaceNames.length > 0 ? workspaceNames.join(", ") : void 0;
      const nextTags = config.packageSpecificTags && workspaceNames.length > 0 ? workspaceNames.map((pkgName) => formatTag(nextVersion, formattedPrefix, pkgName, tagTemplate, true)) : [formatTag(nextVersion, formattedPrefix, null, void 0, false)];
      let formattedCommitMessage;
      const hasPackageNamePlaceholder = commitMessage.includes("${packageName}");
      if (commitPackageName === void 0 && !hasPackageNamePlaceholder) {
        formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, void 0, void 0);
      } else if (commitPackageName === void 0) {
        formattedCommitMessage = commitMessage.replace(/\$\{version\}/g, nextVersion).replace(/\$\{packageName\}/g, "").replace(/\$\{scope\}/g, "");
      } else {
        formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, commitPackageName, void 0);
      }
      formattedCommitMessage = formattedCommitMessage.replace(/\s{2,}/g, " ").trim();
      for (const tag of nextTags) {
        addTag(tag);
      }
      setCommitMessage(formattedCommitMessage);
      if (!dryRun) {
        log2(`Version ${nextVersion} prepared (tags: ${nextTags.join(", ")})`, "success");
      } else {
        log2(`Would create tags: ${nextTags.join(", ")}`, "info");
      }
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log2(`Synced Strategy failed: ${error.message} (${error.code})`, "error");
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log2(`Synced Strategy failed: ${errorMessage}`, "error");
      }
      throw error;
    }
  };
}
function createSingleStrategy(config) {
  return async (packages) => {
    try {
      const {
        mainPackage,
        versionPrefix,
        tagTemplate,
        commitMessage = `chore: release \${packageName} v\${version}`,
        dryRun
      } = config;
      let packageName;
      if (mainPackage) {
        packageName = mainPackage;
      } else if (packages.packages.length === 1) {
        packageName = packages.packages[0].packageJson.name;
      } else {
        throw createVersionError(
          "INVALID_CONFIG",
          "Single mode requires either mainPackage or exactly one resolved package"
        );
      }
      const pkg = packages.packages.find((p) => p.packageJson.name === packageName);
      if (!pkg) {
        throw createVersionError("PACKAGE_NOT_FOUND", packageName);
      }
      const pkgPath = pkg.dir;
      const formattedPrefix = formatVersionPrefix(versionPrefix || "v");
      let latestTagResult = await getLatestTagForPackage(packageName, formattedPrefix, {
        tagTemplate,
        packageSpecificTags: config.packageSpecificTags
      });
      if (!latestTagResult) {
        const globalTagResult = await getLatestTag();
        latestTagResult = globalTagResult || "";
      }
      const latestTag = latestTagResult;
      let nextVersion;
      nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
        prereleaseIdentifier: config.prereleaseIdentifier,
        path: pkgPath,
        name: packageName,
        type: config.type
      });
      if (!nextVersion) {
        log2(`No version change needed for ${packageName}`, "info");
        return;
      }
      let changelogEntries = [];
      let revisionRange = "HEAD";
      try {
        if (latestTag) {
          try {
            execSync("git", ["rev-parse", "--verify", latestTag], {
              cwd: pkgPath,
              stdio: "ignore"
            });
            revisionRange = `${latestTag}..HEAD`;
          } catch {
            if (config.strictReachable) {
              throw new Error(
                `Cannot generate changelog: tag '${latestTag}' is not reachable from the current commit. When strictReachable is enabled, all tags must be reachable. To allow fallback to all commits, set strictReachable to false.`
              );
            }
            log2(`Tag ${latestTag} doesn't exist, using all commits for changelog`, "debug");
            revisionRange = "HEAD";
          }
        } else {
          revisionRange = "HEAD";
        }
        changelogEntries = extractChangelogEntriesFromCommits(pkgPath, revisionRange);
        if (changelogEntries.length === 0) {
          changelogEntries = [
            {
              type: "changed",
              description: `Update version to ${nextVersion}`
            }
          ];
        }
      } catch (error) {
        log2(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, "warning");
        changelogEntries = [
          {
            type: "changed",
            description: `Update version to ${nextVersion}`
          }
        ];
      }
      let repoUrl;
      try {
        const packageJsonPath2 = path82.join(pkgPath, "package.json");
        if (fs10.existsSync(packageJsonPath2)) {
          const packageJson = JSON.parse(fs10.readFileSync(packageJsonPath2, "utf8"));
          if (packageJson.repository) {
            if (typeof packageJson.repository === "string") {
              repoUrl = packageJson.repository;
            } else if (packageJson.repository.url) {
              repoUrl = packageJson.repository.url;
            }
            if (repoUrl?.startsWith("git+") && repoUrl?.endsWith(".git")) {
              repoUrl = repoUrl.substring(4, repoUrl.length - 4);
            }
          }
        }
      } catch (error) {
        log2(
          `Could not determine repository URL for changelog links: ${error instanceof Error ? error.message : String(error)}`,
          "warning"
        );
      }
      addChangelogData({
        packageName,
        version: nextVersion,
        previousVersion: latestTag || null,
        revisionRange,
        repoUrl: repoUrl || null,
        entries: changelogEntries
      });
      const packageJsonPath = path82.join(pkgPath, "package.json");
      updatePackageVersion(packageJsonPath, nextVersion, dryRun);
      const filesToCommit = [packageJsonPath];
      const cargoFiles = updateCargoFiles(pkgPath, nextVersion, config.cargo, dryRun);
      filesToCommit.push(...cargoFiles);
      log2(`Updated package ${packageName} to version ${nextVersion}`, "success");
      const tagName = formatTag(nextVersion, formattedPrefix, packageName, tagTemplate, config.packageSpecificTags);
      const commitMsg = formatCommitMessage(commitMessage, nextVersion, packageName);
      addTag(tagName);
      setCommitMessage(commitMsg);
      if (!dryRun) {
        log2(`Version ${nextVersion} prepared (tag: ${tagName})`, "success");
      } else {
        log2(`Would create tag: ${tagName}`, "info");
      }
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log2(`Single Strategy failed: ${error.message} (${error.code})`, "error");
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log2(`Single Strategy failed: ${errorMessage}`, "error");
      }
      throw error;
    }
  };
}
function createAsyncStrategy(config) {
  const dependencies = {
    getLatestTag
  };
  const processorOptions = {
    skip: config.skip || [],
    versionPrefix: config.versionPrefix || "v",
    tagTemplate: config.tagTemplate,
    commitMessageTemplate: config.commitMessage || "",
    dryRun: config.dryRun || false,
    getLatestTag: dependencies.getLatestTag,
    fullConfig: config,
    // Extract common version configuration properties
    config: {
      branchPattern: config.branchPattern || [],
      baseBranch: config.baseBranch || "main",
      prereleaseIdentifier: config.prereleaseIdentifier,
      type: config.type
    }
  };
  const packageProcessor = new PackageProcessor(processorOptions);
  return async (packages, targets = []) => {
    try {
      let packagesToProcess = packages.packages;
      if (targets.length > 0) {
        const beforeCount = packagesToProcess.length;
        packagesToProcess = packagesToProcess.filter((pkg) => targets.includes(pkg.packageJson.name));
        log2(
          `Runtime targets filter: ${beforeCount} \u2192 ${packagesToProcess.length} packages (${targets.join(", ")})`,
          "info"
        );
      }
      log2(`Processing ${packagesToProcess.length} packages`, "info");
      const result = await packageProcessor.processPackages(packagesToProcess);
      if (result.updatedPackages.length === 0) {
        log2("No packages required a version update.", "info");
      } else {
        const packageNames = result.updatedPackages.map((p) => p.name).join(", ");
        log2(`Updated ${result.updatedPackages.length} package(s): ${packageNames}`, "success");
        if (result.tags.length > 0) {
          log2(`Created ${result.tags.length} tag(s): ${result.tags.join(", ")}`, "success");
        }
        if (result.commitMessage) {
          log2(`Created commit with message: "${result.commitMessage}"`, "success");
        }
      }
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log2(`Async Strategy failed: ${error.message} (${error.code})`, "error");
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log2(`Async Strategy failed: ${errorMessage}`, "error");
      }
      throw error;
    }
  };
}
function createStrategy(config) {
  if (config.sync) {
    return createSyncStrategy(config);
  }
  return createAsyncStrategy(config);
}
function createStrategyMap(config) {
  return {
    sync: createSyncStrategy(config),
    single: createSingleStrategy(config),
    async: createAsyncStrategy(config)
  };
}
var GitError = class extends BaseVersionError {
};
function filterPackagesByConfig(packages, configTargets, workspaceRoot) {
  if (configTargets.length === 0) {
    log2("No config targets specified, returning all packages", "debug");
    return packages;
  }
  const matchedPackages = /* @__PURE__ */ new Set();
  for (const target of configTargets) {
    const dirMatches = filterByDirectoryPattern(packages, target, workspaceRoot);
    const nameMatches = filterByPackageNamePattern(packages, target);
    for (const pkg of dirMatches) {
      matchedPackages.add(pkg);
    }
    for (const pkg of nameMatches) {
      matchedPackages.add(pkg);
    }
  }
  return Array.from(matchedPackages);
}
function filterByDirectoryPattern(packages, pattern, workspaceRoot) {
  if (pattern === "./" || pattern === ".") {
    return packages.filter((pkg) => pkg.dir === workspaceRoot);
  }
  const normalizedPattern = pattern.replace(/\\/g, "/");
  return packages.filter((pkg) => {
    const relativePath = path9.relative(workspaceRoot, pkg.dir);
    const normalizedRelativePath = relativePath.replace(/\\/g, "/");
    if (normalizedPattern === normalizedRelativePath) {
      return true;
    }
    try {
      return minimatch(normalizedRelativePath, normalizedPattern, {
        dot: true
      });
    } catch (error) {
      log2(
        `Invalid directory pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
        "warning"
      );
      return false;
    }
  });
}
function filterByPackageNamePattern(packages, pattern) {
  return packages.filter((pkg) => {
    if (!pkg.packageJson?.name || typeof pkg.packageJson.name !== "string") {
      return false;
    }
    return matchesPackageNamePattern(pkg.packageJson.name, pattern);
  });
}
function matchesPackageNamePattern(packageName, pattern) {
  if (packageName === pattern) {
    return true;
  }
  if (pattern.startsWith("@") && pattern.endsWith("/*") && !pattern.includes("**")) {
    const scope = pattern.slice(0, -2);
    return packageName.startsWith(`${scope}/`);
  }
  try {
    return minimatch(packageName, pattern, {
      dot: true
    });
  } catch (error) {
    log2(
      `Invalid package name pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
      "warning"
    );
    return false;
  }
}
var VersionEngine = class {
  config;
  workspaceCache = null;
  strategies;
  currentStrategy;
  constructor(config, _jsonMode = false) {
    if (!config) {
      throw createVersionError(
        "CONFIG_REQUIRED"
        /* CONFIG_REQUIRED */
      );
    }
    if (!config.preset) {
      config.preset = "conventional-commits";
      log2("No preset specified, using default: conventional-commits", "warning");
    }
    this.config = config;
    this.strategies = createStrategyMap(config);
    this.currentStrategy = createStrategy(config);
  }
  /**
   * Get workspace packages information - with caching for performance
   */
  async getWorkspacePackages() {
    try {
      if (this.workspaceCache) {
        return this.workspaceCache;
      }
      const pkgsResult = getPackagesSync(cwd2());
      if (!pkgsResult?.packages) {
        throw createVersionError(
          "PACKAGES_NOT_FOUND"
          /* PACKAGES_NOT_FOUND */
        );
      }
      if (!pkgsResult.root) {
        log2("Root path is undefined in packages result, setting to current working directory", "warning");
        pkgsResult.root = cwd2();
      }
      if (this.config.packages && this.config.packages.length > 0) {
        const originalCount = pkgsResult.packages.length;
        const filteredPackages = filterPackagesByConfig(pkgsResult.packages, this.config.packages, pkgsResult.root);
        pkgsResult.packages = filteredPackages;
        log2(
          `Filtered ${originalCount} workspace packages to ${filteredPackages.length} based on packages config`,
          "info"
        );
        if (filteredPackages.length === 0) {
          log2("Warning: No packages matched the specified patterns in config.packages", "warning");
        }
      }
      this.workspaceCache = pkgsResult;
      return pkgsResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log2(`Failed to get packages information: ${errorMessage}`, "error");
      console.error(error);
      throw createVersionError("WORKSPACE_ERROR", errorMessage);
    }
  }
  /**
   * Run the current strategy
   * @param packages Workspace packages to process
   * @param targets Optional package targets to process (only used by async strategy)
   */
  async run(packages, targets = []) {
    try {
      return this.currentStrategy(packages, targets);
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log2(`Version engine failed: ${error.message} (${error.code || "UNKNOWN"})`, "error");
        if (error instanceof GitError) {
          console.error("Git error details:");
          if (error.message.includes("Command failed:")) {
            const cmdOutput = error.message.split("Command failed:")[1];
            if (cmdOutput) {
              console.error("Command output:", cmdOutput.trim());
            }
          }
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log2(`Version engine failed: ${errorMessage}`, "error");
        if (error instanceof Error && error.stack) {
          console.error("Error stack trace:");
          console.error(error.stack);
        }
      }
      throw error;
    }
  }
  /**
   * Change the current strategy
   * @param strategyType The strategy type to use: 'sync', 'single', or 'async'
   */
  setStrategy(strategyType) {
    this.currentStrategy = this.strategies[strategyType];
  }
};
function createVersionCommand() {
  return new Command("version").description("Version a package or packages based on configuration").option("-c, --config <path>", "Path to config file (defaults to releasekit.config.json in current directory)").option("-d, --dry-run", "Dry run (no changes made)", false).option("-b, --bump <type>", "Specify bump type (patch|minor|major)").option("-p, --prerelease [identifier]", "Create prerelease version").option("-s, --sync", "Use synchronized versioning across all packages").option("-j, --json", "Output results as JSON", false).option("-t, --target <packages>", "Comma-delimited list of package names to target").option("--project-dir <path>", "Project directory to run commands in", process.cwd()).action(async (options) => {
    if (options.json) {
      enableJsonOutput(options.dryRun);
    }
    try {
      const originalCwd = process.cwd();
      if (options.projectDir && options.projectDir !== originalCwd) {
        try {
          process.chdir(options.projectDir);
          log2(`Changed working directory to: ${options.projectDir}`, "debug");
        } catch (error) {
          throw new Error(
            `Failed to change to directory "${options.projectDir}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      const config = loadConfig2({ cwd: options.projectDir, configPath: options.config });
      log2(`Loaded configuration from ${options.config || "releasekit.config.json"}`, "info");
      if (options.dryRun) config.dryRun = true;
      if (options.sync) config.sync = true;
      if (options.bump) config.type = options.bump;
      if (options.prerelease) {
        config.prereleaseIdentifier = options.prerelease === true ? "next" : options.prerelease;
        config.isPrerelease = true;
      }
      const cliTargets = options.target ? options.target.split(",").map((t) => t.trim()) : [];
      if (cliTargets.length > 0) {
        config.packages = cliTargets;
        log2(`CLI targets specified: ${cliTargets.join(", ")}`, "info");
      }
      const engine = new VersionEngine(config, !!options.json);
      const pkgsResult = await engine.getWorkspacePackages();
      const resolvedCount = pkgsResult.packages.length;
      log2(`Resolved ${resolvedCount} packages from workspace`, "debug");
      log2(`Config packages: ${JSON.stringify(config.packages)}`, "debug");
      log2(`Config sync: ${config.sync}`, "debug");
      if (config.sync) {
        log2("Using sync versioning strategy.", "info");
        engine.setStrategy("sync");
        await engine.run(pkgsResult);
      } else if (resolvedCount === 1) {
        log2("Using single package versioning strategy.", "info");
        if (cliTargets.length > 0) {
          log2("--target flag is ignored for single package strategy.", "warning");
        }
        engine.setStrategy("single");
        await engine.run(pkgsResult);
      } else if (resolvedCount === 0) {
        throw new Error("No packages found in workspace");
      } else {
        log2("Using async versioning strategy.", "info");
        if (cliTargets.length > 0) {
          log2(`Targeting specific packages: ${cliTargets.join(", ")}`, "info");
        }
        engine.setStrategy("async");
        await engine.run(pkgsResult, cliTargets);
      }
      log2("Versioning process completed.", "success");
      printJsonOutput();
    } catch (error) {
      const { BaseVersionError: BaseVersionError2 } = await import("./baseError-DQHIJACF-MKENOKQI.js");
      if (BaseVersionError2.isVersionError(error)) {
        error.logError();
      } else {
        log2(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
      process.exit(1);
    }
  });
}

export {
  loadConfig2,
  VersionErrorCode,
  createVersionError,
  enableJsonOutput,
  flushPendingWrites,
  getJsonData,
  calculateVersion,
  PackageProcessor,
  createSyncStrategy,
  createSingleStrategy,
  createAsyncStrategy,
  VersionEngine,
  createVersionCommand
};
/*! Bundled license information:

js-yaml/dist/js-yaml.mjs:
  (*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT *)
*/
