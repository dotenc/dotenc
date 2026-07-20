var import_node_module = require("node:module");
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// node_modules/@noble/ciphers/utils.js
var require_utils = __commonJS((exports2) => {
  /*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.wrapCipher = exports2.Hash = exports2.nextTick = exports2.isLE = undefined;
  exports2.isBytes = isBytes;
  exports2.abool = abool;
  exports2.anumber = anumber;
  exports2.abytes = abytes;
  exports2.ahash = ahash;
  exports2.aexists = aexists;
  exports2.aoutput = aoutput;
  exports2.u8 = u8;
  exports2.u32 = u32;
  exports2.clean = clean;
  exports2.createView = createView;
  exports2.bytesToHex = bytesToHex;
  exports2.hexToBytes = hexToBytes;
  exports2.hexToNumber = hexToNumber;
  exports2.bytesToNumberBE = bytesToNumberBE;
  exports2.numberToBytesBE = numberToBytesBE;
  exports2.utf8ToBytes = utf8ToBytes;
  exports2.bytesToUtf8 = bytesToUtf8;
  exports2.toBytes = toBytes;
  exports2.overlapBytes = overlapBytes;
  exports2.complexOverlapBytes = complexOverlapBytes;
  exports2.concatBytes = concatBytes;
  exports2.checkOpts = checkOpts;
  exports2.equalBytes = equalBytes;
  exports2.getOutput = getOutput;
  exports2.setBigUint64 = setBigUint64;
  exports2.u64Lengths = u64Lengths;
  exports2.isAligned32 = isAligned32;
  exports2.copyBytes = copyBytes;
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abool(b) {
    if (typeof b !== "boolean")
      throw new Error(`boolean expected, not ${b}`);
  }
  function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("positive integer expected, got " + n);
  }
  function abytes(b, ...lengths) {
    if (!isBytes(b))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b.length))
      throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new Error("Hash should be wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error("digestInto() expects output buffer of length at least " + min);
    }
  }
  function u8(arr) {
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean(...arrays) {
    for (let i = 0;i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  exports2.isLE = (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i = 0;i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }
  var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
  function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
      return ch - asciis._0;
    if (ch >= asciis.A && ch <= asciis.F)
      return ch - (asciis.A - 10);
    if (ch >= asciis.a && ch <= asciis.f)
      return ch - (asciis.a - 10);
    return;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    if (hasHexBuiltin)
      return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new Error("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === undefined || n2 === undefined) {
        const char = hex[hi] + hex[hi + 1];
        throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    return BigInt(hex === "" ? "0" : "0x" + hex);
  }
  function bytesToNumberBE(bytes) {
    return hexToNumber(bytesToHex(bytes));
  }
  function numberToBytesBE(n, len) {
    return hexToBytes(n.toString(16).padStart(len * 2, "0"));
  }
  var nextTick = async () => {};
  exports2.nextTick = nextTick;
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    else if (isBytes(data))
      data = copyBytes(data);
    else
      throw new Error("Uint8Array expected, got " + typeof data);
    return data;
  }
  function overlapBytes(a, b) {
    return a.buffer === b.buffer && a.byteOffset < b.byteOffset + b.byteLength && b.byteOffset < a.byteOffset + a.byteLength;
  }
  function complexOverlapBytes(input, output) {
    if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
      throw new Error("complex overlap of input and output is not supported");
  }
  function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0;i < arrays.length; i++) {
      const a = arrays[i];
      abytes(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0;i < arrays.length; i++) {
      const a = arrays[i];
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  }
  function checkOpts(defaults, opts) {
    if (opts == null || typeof opts !== "object")
      throw new Error("options must be defined");
    const merged = Object.assign(defaults, opts);
    return merged;
  }
  function equalBytes(a, b) {
    if (a.length !== b.length)
      return false;
    let diff = 0;
    for (let i = 0;i < a.length; i++)
      diff |= a[i] ^ b[i];
    return diff === 0;
  }

  class Hash {
  }
  exports2.Hash = Hash;
  var wrapCipher = (params, constructor) => {
    function wrappedCipher(key, ...args) {
      abytes(key);
      if (!exports2.isLE)
        throw new Error("Non little-endian hardware is not yet supported");
      if (params.nonceLength !== undefined) {
        const nonce = args[0];
        if (!nonce)
          throw new Error("nonce / iv required");
        if (params.varSizeNonce)
          abytes(nonce);
        else
          abytes(nonce, params.nonceLength);
      }
      const tagl = params.tagLength;
      if (tagl && args[1] !== undefined) {
        abytes(args[1]);
      }
      const cipher = constructor(key, ...args);
      const checkOutput = (fnLength, output) => {
        if (output !== undefined) {
          if (fnLength !== 2)
            throw new Error("cipher output not supported");
          abytes(output);
        }
      };
      let called = false;
      const wrCipher = {
        encrypt(data, output) {
          if (called)
            throw new Error("cannot encrypt() twice with same key + nonce");
          called = true;
          abytes(data);
          checkOutput(cipher.encrypt.length, output);
          return cipher.encrypt(data, output);
        },
        decrypt(data, output) {
          abytes(data);
          if (tagl && data.length < tagl)
            throw new Error("invalid ciphertext length: smaller than tagLength=" + tagl);
          checkOutput(cipher.decrypt.length, output);
          return cipher.decrypt(data, output);
        }
      };
      return wrCipher;
    }
    Object.assign(wrappedCipher, params);
    return wrappedCipher;
  };
  exports2.wrapCipher = wrapCipher;
  function getOutput(expectedLength, out, onlyAligned = true) {
    if (out === undefined)
      return new Uint8Array(expectedLength);
    if (out.length !== expectedLength)
      throw new Error("invalid output length, expected " + expectedLength + ", got: " + out.length);
    if (onlyAligned && !isAligned32(out))
      throw new Error("invalid output, must be aligned");
    return out;
  }
  function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE);
    const _32n = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
  }
  function u64Lengths(dataLength, aadLength, isLE) {
    abool(isLE);
    const num = new Uint8Array(16);
    const view = createView(num);
    setBigUint64(view, 0, BigInt(aadLength), isLE);
    setBigUint64(view, 8, BigInt(dataLength), isLE);
    return num;
  }
  function isAligned32(bytes) {
    return bytes.byteOffset % 4 === 0;
  }
  function copyBytes(bytes) {
    return Uint8Array.from(bytes);
  }
});

// node_modules/eciesjs/dist/consts.js
var require_consts = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.AEAD_TAG_LENGTH = exports2.XCHACHA20_NONCE_LENGTH = exports2.CURVE25519_PUBLIC_KEY_SIZE = exports2.ETH_PUBLIC_KEY_SIZE = exports2.UNCOMPRESSED_PUBLIC_KEY_SIZE = exports2.COMPRESSED_PUBLIC_KEY_SIZE = exports2.SECRET_KEY_LENGTH = undefined;
  exports2.SECRET_KEY_LENGTH = 32;
  exports2.COMPRESSED_PUBLIC_KEY_SIZE = 33;
  exports2.UNCOMPRESSED_PUBLIC_KEY_SIZE = 65;
  exports2.ETH_PUBLIC_KEY_SIZE = 64;
  exports2.CURVE25519_PUBLIC_KEY_SIZE = 32;
  exports2.XCHACHA20_NONCE_LENGTH = 24;
  exports2.AEAD_TAG_LENGTH = 16;
});

// node_modules/eciesjs/dist/config.js
var require_config = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.ephemeralKeySize = exports2.symmetricNonceLength = exports2.symmetricAlgorithm = exports2.isHkdfKeyCompressed = exports2.isEphemeralKeyCompressed = exports2.ellipticCurve = exports2.ECIES_CONFIG = exports2.Config = undefined;
  var consts_js_1 = require_consts();
  var Config = function() {
    function Config2() {
      this.ellipticCurve = "secp256k1";
      this.isEphemeralKeyCompressed = false;
      this.isHkdfKeyCompressed = false;
      this.symmetricAlgorithm = "aes-256-gcm";
      this.symmetricNonceLength = 16;
    }
    Object.defineProperty(Config2.prototype, "ephemeralKeySize", {
      get: function() {
        var mapping = {
          secp256k1: this.isEphemeralKeyCompressed ? consts_js_1.COMPRESSED_PUBLIC_KEY_SIZE : consts_js_1.UNCOMPRESSED_PUBLIC_KEY_SIZE,
          x25519: consts_js_1.CURVE25519_PUBLIC_KEY_SIZE,
          ed25519: consts_js_1.CURVE25519_PUBLIC_KEY_SIZE
        };
        if (this.ellipticCurve in mapping) {
          return mapping[this.ellipticCurve];
        } else {
          throw new Error("Not implemented");
        }
      },
      enumerable: false,
      configurable: true
    });
    return Config2;
  }();
  exports2.Config = Config;
  exports2.ECIES_CONFIG = new Config;
  var ellipticCurve = function() {
    return exports2.ECIES_CONFIG.ellipticCurve;
  };
  exports2.ellipticCurve = ellipticCurve;
  var isEphemeralKeyCompressed = function() {
    return exports2.ECIES_CONFIG.isEphemeralKeyCompressed;
  };
  exports2.isEphemeralKeyCompressed = isEphemeralKeyCompressed;
  var isHkdfKeyCompressed = function() {
    return exports2.ECIES_CONFIG.isHkdfKeyCompressed;
  };
  exports2.isHkdfKeyCompressed = isHkdfKeyCompressed;
  var symmetricAlgorithm = function() {
    return exports2.ECIES_CONFIG.symmetricAlgorithm;
  };
  exports2.symmetricAlgorithm = symmetricAlgorithm;
  var symmetricNonceLength = function() {
    return exports2.ECIES_CONFIG.symmetricNonceLength;
  };
  exports2.symmetricNonceLength = symmetricNonceLength;
  var ephemeralKeySize = function() {
    return exports2.ECIES_CONFIG.ephemeralKeySize;
  };
  exports2.ephemeralKeySize = ephemeralKeySize;
});

// node_modules/@noble/ciphers/cryptoNode.js
var require_cryptoNode = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.crypto = undefined;
  var nc = require("node:crypto");
  exports2.crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && ("randomBytes" in nc) ? nc : undefined;
});

// node_modules/@noble/ciphers/webcrypto.js
var require_webcrypto = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.gcm = exports2.ctr = exports2.cbc = exports2.utils = undefined;
  exports2.randomBytes = randomBytes;
  exports2.getWebcryptoSubtle = getWebcryptoSubtle;
  exports2.managedNonce = managedNonce;
  var crypto_1 = require_cryptoNode();
  var utils_ts_1 = require_utils();
  function randomBytes(bytesLength = 32) {
    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === "function") {
      return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
    }
    if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === "function") {
      return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
    }
    throw new Error("crypto.getRandomValues must be defined");
  }
  function getWebcryptoSubtle() {
    if (crypto_1.crypto && typeof crypto_1.crypto.subtle === "object" && crypto_1.crypto.subtle != null)
      return crypto_1.crypto.subtle;
    throw new Error("crypto.subtle must be defined");
  }
  function managedNonce(fn) {
    const { nonceLength } = fn;
    (0, utils_ts_1.anumber)(nonceLength);
    return (key, ...args) => ({
      encrypt(plaintext, ...argsEnc) {
        const nonce = randomBytes(nonceLength);
        const ciphertext = fn(key, nonce, ...args).encrypt(plaintext, ...argsEnc);
        const out = (0, utils_ts_1.concatBytes)(nonce, ciphertext);
        ciphertext.fill(0);
        return out;
      },
      decrypt(ciphertext, ...argsDec) {
        const nonce = ciphertext.subarray(0, nonceLength);
        const data = ciphertext.subarray(nonceLength);
        return fn(key, nonce, ...args).decrypt(data, ...argsDec);
      }
    });
  }
  exports2.utils = {
    async encrypt(key, keyParams, cryptParams, plaintext) {
      const cr = getWebcryptoSubtle();
      const iKey = await cr.importKey("raw", key, keyParams, true, ["encrypt"]);
      const ciphertext = await cr.encrypt(cryptParams, iKey, plaintext);
      return new Uint8Array(ciphertext);
    },
    async decrypt(key, keyParams, cryptParams, ciphertext) {
      const cr = getWebcryptoSubtle();
      const iKey = await cr.importKey("raw", key, keyParams, true, ["decrypt"]);
      const plaintext = await cr.decrypt(cryptParams, iKey, ciphertext);
      return new Uint8Array(plaintext);
    }
  };
  var mode = {
    CBC: "AES-CBC",
    CTR: "AES-CTR",
    GCM: "AES-GCM"
  };
  function getCryptParams(algo, nonce, AAD) {
    if (algo === mode.CBC)
      return { name: mode.CBC, iv: nonce };
    if (algo === mode.CTR)
      return { name: mode.CTR, counter: nonce, length: 64 };
    if (algo === mode.GCM) {
      if (AAD)
        return { name: mode.GCM, iv: nonce, additionalData: AAD };
      else
        return { name: mode.GCM, iv: nonce };
    }
    throw new Error("unknown aes block mode");
  }
  function generate(algo) {
    return (key, nonce, AAD) => {
      (0, utils_ts_1.abytes)(key);
      (0, utils_ts_1.abytes)(nonce);
      const keyParams = { name: algo, length: key.length * 8 };
      const cryptParams = getCryptParams(algo, nonce, AAD);
      let consumed = false;
      return {
        encrypt(plaintext) {
          (0, utils_ts_1.abytes)(plaintext);
          if (consumed)
            throw new Error("Cannot encrypt() twice with same key / nonce");
          consumed = true;
          return exports2.utils.encrypt(key, keyParams, cryptParams, plaintext);
        },
        decrypt(ciphertext) {
          (0, utils_ts_1.abytes)(ciphertext);
          return exports2.utils.decrypt(key, keyParams, cryptParams, ciphertext);
        }
      };
    };
  }
  exports2.cbc = (() => generate(mode.CBC))();
  exports2.ctr = (() => generate(mode.CTR))();
  exports2.gcm = /* @__PURE__ */ (() => generate(mode.GCM))();
});

// node_modules/@noble/hashes/cryptoNode.js
var require_cryptoNode2 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.crypto = undefined;
  var nc = require("node:crypto");
  exports2.crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && ("randomBytes" in nc) ? nc : undefined;
});

// node_modules/@noble/hashes/utils.js
var require_utils2 = __commonJS((exports2) => {
  /*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.wrapXOFConstructorWithOpts = exports2.wrapConstructorWithOpts = exports2.wrapConstructor = exports2.Hash = exports2.nextTick = exports2.swap32IfBE = exports2.byteSwapIfBE = exports2.swap8IfBE = exports2.isLE = undefined;
  exports2.isBytes = isBytes;
  exports2.anumber = anumber;
  exports2.abytes = abytes;
  exports2.ahash = ahash;
  exports2.aexists = aexists;
  exports2.aoutput = aoutput;
  exports2.u8 = u8;
  exports2.u32 = u32;
  exports2.clean = clean;
  exports2.createView = createView;
  exports2.rotr = rotr;
  exports2.rotl = rotl;
  exports2.byteSwap = byteSwap;
  exports2.byteSwap32 = byteSwap32;
  exports2.bytesToHex = bytesToHex;
  exports2.hexToBytes = hexToBytes;
  exports2.asyncLoop = asyncLoop;
  exports2.utf8ToBytes = utf8ToBytes;
  exports2.bytesToUtf8 = bytesToUtf8;
  exports2.toBytes = toBytes;
  exports2.kdfInputToBytes = kdfInputToBytes;
  exports2.concatBytes = concatBytes;
  exports2.checkOpts = checkOpts;
  exports2.createHasher = createHasher;
  exports2.createOptHasher = createOptHasher;
  exports2.createXOFer = createXOFer;
  exports2.randomBytes = randomBytes;
  var crypto_1 = require_cryptoNode2();
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("positive integer expected, got " + n);
  }
  function abytes(b, ...lengths) {
    if (!isBytes(b))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b.length))
      throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new Error("Hash should be wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error("digestInto() expects output buffer of length at least " + min);
    }
  }
  function u8(arr) {
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean(...arrays) {
    for (let i = 0;i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function rotl(word, shift) {
    return word << shift | word >>> 32 - shift >>> 0;
  }
  exports2.isLE = (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  function byteSwap(word) {
    return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
  }
  exports2.swap8IfBE = exports2.isLE ? (n) => n : (n) => byteSwap(n);
  exports2.byteSwapIfBE = exports2.swap8IfBE;
  function byteSwap32(arr) {
    for (let i = 0;i < arr.length; i++) {
      arr[i] = byteSwap(arr[i]);
    }
    return arr;
  }
  exports2.swap32IfBE = exports2.isLE ? (u) => u : byteSwap32;
  var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i = 0;i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }
  var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
  function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
      return ch - asciis._0;
    if (ch >= asciis.A && ch <= asciis.F)
      return ch - (asciis.A - 10);
    if (ch >= asciis.a && ch <= asciis.f)
      return ch - (asciis.a - 10);
    return;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    if (hasHexBuiltin)
      return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new Error("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === undefined || n2 === undefined) {
        const char = hex[hi] + hex[hi + 1];
        throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  var nextTick = async () => {};
  exports2.nextTick = nextTick;
  async function asyncLoop(iters, tick, cb) {
    let ts = Date.now();
    for (let i = 0;i < iters; i++) {
      cb(i);
      const diff = Date.now() - ts;
      if (diff >= 0 && diff < tick)
        continue;
      await (0, exports2.nextTick)();
      ts += diff;
    }
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  function kdfInputToBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0;i < arrays.length; i++) {
      const a = arrays[i];
      abytes(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0;i < arrays.length; i++) {
      const a = arrays[i];
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  }
  function checkOpts(defaults, opts) {
    if (opts !== undefined && {}.toString.call(opts) !== "[object Object]")
      throw new Error("options should be object or undefined");
    const merged = Object.assign(defaults, opts);
    return merged;
  }

  class Hash {
  }
  exports2.Hash = Hash;
  function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
  }
  function createOptHasher(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
  }
  function createXOFer(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
  }
  exports2.wrapConstructor = createHasher;
  exports2.wrapConstructorWithOpts = createOptHasher;
  exports2.wrapXOFConstructorWithOpts = createXOFer;
  function randomBytes(bytesLength = 32) {
    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === "function") {
      return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
    }
    if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === "function") {
      return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
    }
    throw new Error("crypto.getRandomValues must be defined");
  }
});

// node_modules/@noble/hashes/_md.js
var require__md = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.SHA512_IV = exports2.SHA384_IV = exports2.SHA224_IV = exports2.SHA256_IV = exports2.HashMD = undefined;
  exports2.setBigUint64 = setBigUint64;
  exports2.Chi = Chi;
  exports2.Maj = Maj;
  var utils_ts_1 = require_utils2();
  function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE);
    const _32n = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
  }
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }

  class HashMD extends utils_ts_1.Hash {
    constructor(blockLen, outputLen, padOffset, isLE) {
      super();
      this.finished = false;
      this.length = 0;
      this.pos = 0;
      this.destroyed = false;
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = (0, utils_ts_1.createView)(this.buffer);
    }
    update(data) {
      (0, utils_ts_1.aexists)(this);
      data = (0, utils_ts_1.toBytes)(data);
      (0, utils_ts_1.abytes)(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0;pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = (0, utils_ts_1.createView)(data);
          for (;blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      (0, utils_ts_1.aexists)(this);
      (0, utils_ts_1.aoutput)(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      (0, utils_ts_1.clean)(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i = pos;i < blockLen; i++)
        buffer[i] = 0;
      setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
      this.process(view, 0);
      const oview = (0, utils_ts_1.createView)(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen should be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i = 0;i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to || (to = new this.constructor);
      to.set(...this.get());
      const { blockLen, buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (length % blockLen)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  }
  exports2.HashMD = HashMD;
  exports2.SHA256_IV = Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  exports2.SHA224_IV = Uint32Array.from([
    3238371032,
    914150663,
    812702999,
    4144912697,
    4290775857,
    1750603025,
    1694076839,
    3204075428
  ]);
  exports2.SHA384_IV = Uint32Array.from([
    3418070365,
    3238371032,
    1654270250,
    914150663,
    2438529370,
    812702999,
    355462360,
    4144912697,
    1731405415,
    4290775857,
    2394180231,
    1750603025,
    3675008525,
    1694076839,
    1203062813,
    3204075428
  ]);
  exports2.SHA512_IV = Uint32Array.from([
    1779033703,
    4089235720,
    3144134277,
    2227873595,
    1013904242,
    4271175723,
    2773480762,
    1595750129,
    1359893119,
    2917565137,
    2600822924,
    725511199,
    528734635,
    4215389547,
    1541459225,
    327033209
  ]);
});

// node_modules/@noble/hashes/_u64.js
var require__u64 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.toBig = exports2.shrSL = exports2.shrSH = exports2.rotrSL = exports2.rotrSH = exports2.rotrBL = exports2.rotrBH = exports2.rotr32L = exports2.rotr32H = exports2.rotlSL = exports2.rotlSH = exports2.rotlBL = exports2.rotlBH = exports2.add5L = exports2.add5H = exports2.add4L = exports2.add4H = exports2.add3L = exports2.add3H = undefined;
  exports2.add = add;
  exports2.fromBig = fromBig;
  exports2.split = split;
  var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
  var _32n = /* @__PURE__ */ BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0;i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0);
  exports2.toBig = toBig;
  var shrSH = (h, _l, s) => h >>> s;
  exports2.shrSH = shrSH;
  var shrSL = (h, l, s) => h << 32 - s | l >>> s;
  exports2.shrSL = shrSL;
  var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
  exports2.rotrSH = rotrSH;
  var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
  exports2.rotrSL = rotrSL;
  var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
  exports2.rotrBH = rotrBH;
  var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
  exports2.rotrBL = rotrBL;
  var rotr32H = (_h, l) => l;
  exports2.rotr32H = rotr32H;
  var rotr32L = (h, _l) => h;
  exports2.rotr32L = rotr32L;
  var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
  exports2.rotlSH = rotlSH;
  var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
  exports2.rotlSL = rotlSL;
  var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
  exports2.rotlBH = rotlBH;
  var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
  exports2.rotlBL = rotlBL;
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
  exports2.add3L = add3L;
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
  exports2.add3H = add3H;
  var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
  exports2.add4L = add4L;
  var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
  exports2.add4H = add4H;
  var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
  exports2.add5L = add5L;
  var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
  exports2.add5H = add5H;
  var u64 = {
    fromBig,
    split,
    toBig,
    shrSH,
    shrSL,
    rotrSH,
    rotrSL,
    rotrBH,
    rotrBL,
    rotr32H,
    rotr32L,
    rotlSH,
    rotlSL,
    rotlBH,
    rotlBL,
    add,
    add3L,
    add3H,
    add4L,
    add4H,
    add5H,
    add5L
  };
  exports2.default = u64;
});

// node_modules/@noble/hashes/sha2.js
var require_sha2 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.sha512_224 = exports2.sha512_256 = exports2.sha384 = exports2.sha512 = exports2.sha224 = exports2.sha256 = exports2.SHA512_256 = exports2.SHA512_224 = exports2.SHA384 = exports2.SHA512 = exports2.SHA224 = exports2.SHA256 = undefined;
  var _md_ts_1 = require__md();
  var u64 = require__u64();
  var utils_ts_1 = require_utils2();
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);

  class SHA256 extends _md_ts_1.HashMD {
    constructor(outputLen = 32) {
      super(64, outputLen, 8, false);
      this.A = _md_ts_1.SHA256_IV[0] | 0;
      this.B = _md_ts_1.SHA256_IV[1] | 0;
      this.C = _md_ts_1.SHA256_IV[2] | 0;
      this.D = _md_ts_1.SHA256_IV[3] | 0;
      this.E = _md_ts_1.SHA256_IV[4] | 0;
      this.F = _md_ts_1.SHA256_IV[5] | 0;
      this.G = _md_ts_1.SHA256_IV[6] | 0;
      this.H = _md_ts_1.SHA256_IV[7] | 0;
    }
    get() {
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i = 0;i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16;i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ W15 >>> 3;
        const s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i = 0;i < 64; i++) {
        const sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25);
        const T1 = H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = (0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22);
        const T2 = sigma0 + (0, _md_ts_1.Maj)(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      (0, utils_ts_1.clean)(SHA256_W);
    }
    destroy() {
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      (0, utils_ts_1.clean)(this.buffer);
    }
  }
  exports2.SHA256 = SHA256;

  class SHA224 extends SHA256 {
    constructor() {
      super(28);
      this.A = _md_ts_1.SHA224_IV[0] | 0;
      this.B = _md_ts_1.SHA224_IV[1] | 0;
      this.C = _md_ts_1.SHA224_IV[2] | 0;
      this.D = _md_ts_1.SHA224_IV[3] | 0;
      this.E = _md_ts_1.SHA224_IV[4] | 0;
      this.F = _md_ts_1.SHA224_IV[5] | 0;
      this.G = _md_ts_1.SHA224_IV[6] | 0;
      this.H = _md_ts_1.SHA224_IV[7] | 0;
    }
  }
  exports2.SHA224 = SHA224;
  var K512 = /* @__PURE__ */ (() => u64.split([
    "0x428a2f98d728ae22",
    "0x7137449123ef65cd",
    "0xb5c0fbcfec4d3b2f",
    "0xe9b5dba58189dbbc",
    "0x3956c25bf348b538",
    "0x59f111f1b605d019",
    "0x923f82a4af194f9b",
    "0xab1c5ed5da6d8118",
    "0xd807aa98a3030242",
    "0x12835b0145706fbe",
    "0x243185be4ee4b28c",
    "0x550c7dc3d5ffb4e2",
    "0x72be5d74f27b896f",
    "0x80deb1fe3b1696b1",
    "0x9bdc06a725c71235",
    "0xc19bf174cf692694",
    "0xe49b69c19ef14ad2",
    "0xefbe4786384f25e3",
    "0x0fc19dc68b8cd5b5",
    "0x240ca1cc77ac9c65",
    "0x2de92c6f592b0275",
    "0x4a7484aa6ea6e483",
    "0x5cb0a9dcbd41fbd4",
    "0x76f988da831153b5",
    "0x983e5152ee66dfab",
    "0xa831c66d2db43210",
    "0xb00327c898fb213f",
    "0xbf597fc7beef0ee4",
    "0xc6e00bf33da88fc2",
    "0xd5a79147930aa725",
    "0x06ca6351e003826f",
    "0x142929670a0e6e70",
    "0x27b70a8546d22ffc",
    "0x2e1b21385c26c926",
    "0x4d2c6dfc5ac42aed",
    "0x53380d139d95b3df",
    "0x650a73548baf63de",
    "0x766a0abb3c77b2a8",
    "0x81c2c92e47edaee6",
    "0x92722c851482353b",
    "0xa2bfe8a14cf10364",
    "0xa81a664bbc423001",
    "0xc24b8b70d0f89791",
    "0xc76c51a30654be30",
    "0xd192e819d6ef5218",
    "0xd69906245565a910",
    "0xf40e35855771202a",
    "0x106aa07032bbd1b8",
    "0x19a4c116b8d2d0c8",
    "0x1e376c085141ab53",
    "0x2748774cdf8eeb99",
    "0x34b0bcb5e19b48a8",
    "0x391c0cb3c5c95a63",
    "0x4ed8aa4ae3418acb",
    "0x5b9cca4f7763e373",
    "0x682e6ff3d6b2b8a3",
    "0x748f82ee5defb2fc",
    "0x78a5636f43172f60",
    "0x84c87814a1f0ab72",
    "0x8cc702081a6439ec",
    "0x90befffa23631e28",
    "0xa4506cebde82bde9",
    "0xbef9a3f7b2c67915",
    "0xc67178f2e372532b",
    "0xca273eceea26619c",
    "0xd186b8c721c0c207",
    "0xeada7dd6cde0eb1e",
    "0xf57d4f7fee6ed178",
    "0x06f067aa72176fba",
    "0x0a637dc5a2c898a6",
    "0x113f9804bef90dae",
    "0x1b710b35131c471b",
    "0x28db77f523047d84",
    "0x32caab7b40c72493",
    "0x3c9ebe0a15c9bebc",
    "0x431d67c49c100d4c",
    "0x4cc5d4becb3e42b6",
    "0x597f299cfc657e2a",
    "0x5fcb6fab3ad6faec",
    "0x6c44198c4a475817"
  ].map((n) => BigInt(n))))();
  var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
  var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
  var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
  var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);

  class SHA512 extends _md_ts_1.HashMD {
    constructor(outputLen = 64) {
      super(128, outputLen, 16, false);
      this.Ah = _md_ts_1.SHA512_IV[0] | 0;
      this.Al = _md_ts_1.SHA512_IV[1] | 0;
      this.Bh = _md_ts_1.SHA512_IV[2] | 0;
      this.Bl = _md_ts_1.SHA512_IV[3] | 0;
      this.Ch = _md_ts_1.SHA512_IV[4] | 0;
      this.Cl = _md_ts_1.SHA512_IV[5] | 0;
      this.Dh = _md_ts_1.SHA512_IV[6] | 0;
      this.Dl = _md_ts_1.SHA512_IV[7] | 0;
      this.Eh = _md_ts_1.SHA512_IV[8] | 0;
      this.El = _md_ts_1.SHA512_IV[9] | 0;
      this.Fh = _md_ts_1.SHA512_IV[10] | 0;
      this.Fl = _md_ts_1.SHA512_IV[11] | 0;
      this.Gh = _md_ts_1.SHA512_IV[12] | 0;
      this.Gl = _md_ts_1.SHA512_IV[13] | 0;
      this.Hh = _md_ts_1.SHA512_IV[14] | 0;
      this.Hl = _md_ts_1.SHA512_IV[15] | 0;
    }
    get() {
      const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
      this.Ah = Ah | 0;
      this.Al = Al | 0;
      this.Bh = Bh | 0;
      this.Bl = Bl | 0;
      this.Ch = Ch | 0;
      this.Cl = Cl | 0;
      this.Dh = Dh | 0;
      this.Dl = Dl | 0;
      this.Eh = Eh | 0;
      this.El = El | 0;
      this.Fh = Fh | 0;
      this.Fl = Fl | 0;
      this.Gh = Gh | 0;
      this.Gl = Gl | 0;
      this.Hh = Hh | 0;
      this.Hl = Hl | 0;
    }
    process(view, offset) {
      for (let i = 0;i < 16; i++, offset += 4) {
        SHA512_W_H[i] = view.getUint32(offset);
        SHA512_W_L[i] = view.getUint32(offset += 4);
      }
      for (let i = 16;i < 80; i++) {
        const W15h = SHA512_W_H[i - 15] | 0;
        const W15l = SHA512_W_L[i - 15] | 0;
        const s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7);
        const s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i - 2] | 0;
        const W2l = SHA512_W_L[i - 2] | 0;
        const s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6);
        const s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6);
        const SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
        const SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
        SHA512_W_H[i] = SUMh | 0;
        SHA512_W_L[i] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i = 0;i < 80; i++) {
        const sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41);
        const sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
        const T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
        const T1l = T1ll | 0;
        const sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39);
        const sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39);
        const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
        const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
        Hh = Gh | 0;
        Hl = Gl | 0;
        Gh = Fh | 0;
        Gl = Fl | 0;
        Fh = Eh | 0;
        Fl = El | 0;
        ({ h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
        Dh = Ch | 0;
        Dl = Cl | 0;
        Ch = Bh | 0;
        Cl = Bl | 0;
        Bh = Ah | 0;
        Bl = Al | 0;
        const All = u64.add3L(T1l, sigma0l, MAJl);
        Ah = u64.add3H(All, T1h, sigma0h, MAJh);
        Al = All | 0;
      }
      ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
      ({ h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
      ({ h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
      ({ h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
      ({ h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
      ({ h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
      ({ h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
      ({ h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
      this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
      (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
      (0, utils_ts_1.clean)(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }
  exports2.SHA512 = SHA512;

  class SHA384 extends SHA512 {
    constructor() {
      super(48);
      this.Ah = _md_ts_1.SHA384_IV[0] | 0;
      this.Al = _md_ts_1.SHA384_IV[1] | 0;
      this.Bh = _md_ts_1.SHA384_IV[2] | 0;
      this.Bl = _md_ts_1.SHA384_IV[3] | 0;
      this.Ch = _md_ts_1.SHA384_IV[4] | 0;
      this.Cl = _md_ts_1.SHA384_IV[5] | 0;
      this.Dh = _md_ts_1.SHA384_IV[6] | 0;
      this.Dl = _md_ts_1.SHA384_IV[7] | 0;
      this.Eh = _md_ts_1.SHA384_IV[8] | 0;
      this.El = _md_ts_1.SHA384_IV[9] | 0;
      this.Fh = _md_ts_1.SHA384_IV[10] | 0;
      this.Fl = _md_ts_1.SHA384_IV[11] | 0;
      this.Gh = _md_ts_1.SHA384_IV[12] | 0;
      this.Gl = _md_ts_1.SHA384_IV[13] | 0;
      this.Hh = _md_ts_1.SHA384_IV[14] | 0;
      this.Hl = _md_ts_1.SHA384_IV[15] | 0;
    }
  }
  exports2.SHA384 = SHA384;
  var T224_IV = /* @__PURE__ */ Uint32Array.from([
    2352822216,
    424955298,
    1944164710,
    2312950998,
    502970286,
    855612546,
    1738396948,
    1479516111,
    258812777,
    2077511080,
    2011393907,
    79989058,
    1067287976,
    1780299464,
    286451373,
    2446758561
  ]);
  var T256_IV = /* @__PURE__ */ Uint32Array.from([
    573645204,
    4230739756,
    2673172387,
    3360449730,
    596883563,
    1867755857,
    2520282905,
    1497426621,
    2519219938,
    2827943907,
    3193839141,
    1401305490,
    721525244,
    746961066,
    246885852,
    2177182882
  ]);

  class SHA512_224 extends SHA512 {
    constructor() {
      super(28);
      this.Ah = T224_IV[0] | 0;
      this.Al = T224_IV[1] | 0;
      this.Bh = T224_IV[2] | 0;
      this.Bl = T224_IV[3] | 0;
      this.Ch = T224_IV[4] | 0;
      this.Cl = T224_IV[5] | 0;
      this.Dh = T224_IV[6] | 0;
      this.Dl = T224_IV[7] | 0;
      this.Eh = T224_IV[8] | 0;
      this.El = T224_IV[9] | 0;
      this.Fh = T224_IV[10] | 0;
      this.Fl = T224_IV[11] | 0;
      this.Gh = T224_IV[12] | 0;
      this.Gl = T224_IV[13] | 0;
      this.Hh = T224_IV[14] | 0;
      this.Hl = T224_IV[15] | 0;
    }
  }
  exports2.SHA512_224 = SHA512_224;

  class SHA512_256 extends SHA512 {
    constructor() {
      super(32);
      this.Ah = T256_IV[0] | 0;
      this.Al = T256_IV[1] | 0;
      this.Bh = T256_IV[2] | 0;
      this.Bl = T256_IV[3] | 0;
      this.Ch = T256_IV[4] | 0;
      this.Cl = T256_IV[5] | 0;
      this.Dh = T256_IV[6] | 0;
      this.Dl = T256_IV[7] | 0;
      this.Eh = T256_IV[8] | 0;
      this.El = T256_IV[9] | 0;
      this.Fh = T256_IV[10] | 0;
      this.Fl = T256_IV[11] | 0;
      this.Gh = T256_IV[12] | 0;
      this.Gl = T256_IV[13] | 0;
      this.Hh = T256_IV[14] | 0;
      this.Hl = T256_IV[15] | 0;
    }
  }
  exports2.SHA512_256 = SHA512_256;
  exports2.sha256 = (0, utils_ts_1.createHasher)(() => new SHA256);
  exports2.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224);
  exports2.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512);
  exports2.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384);
  exports2.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256);
  exports2.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224);
});

// node_modules/@noble/curves/utils.js
var require_utils3 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.notImplemented = exports2.bitMask = exports2.utf8ToBytes = exports2.randomBytes = exports2.isBytes = exports2.hexToBytes = exports2.concatBytes = exports2.bytesToUtf8 = exports2.bytesToHex = exports2.anumber = exports2.abytes = undefined;
  exports2.abool = abool;
  exports2._abool2 = _abool2;
  exports2._abytes2 = _abytes2;
  exports2.numberToHexUnpadded = numberToHexUnpadded;
  exports2.hexToNumber = hexToNumber;
  exports2.bytesToNumberBE = bytesToNumberBE;
  exports2.bytesToNumberLE = bytesToNumberLE;
  exports2.numberToBytesBE = numberToBytesBE;
  exports2.numberToBytesLE = numberToBytesLE;
  exports2.numberToVarBytesBE = numberToVarBytesBE;
  exports2.ensureBytes = ensureBytes;
  exports2.equalBytes = equalBytes;
  exports2.copyBytes = copyBytes;
  exports2.asciiToBytes = asciiToBytes;
  exports2.inRange = inRange;
  exports2.aInRange = aInRange;
  exports2.bitLen = bitLen;
  exports2.bitGet = bitGet;
  exports2.bitSet = bitSet;
  exports2.createHmacDrbg = createHmacDrbg;
  exports2.validateObject = validateObject;
  exports2.isHash = isHash;
  exports2._validateObject = _validateObject;
  exports2.memoized = memoized;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var utils_js_1 = require_utils2();
  var utils_js_2 = require_utils2();
  Object.defineProperty(exports2, "abytes", { enumerable: true, get: function() {
    return utils_js_2.abytes;
  } });
  Object.defineProperty(exports2, "anumber", { enumerable: true, get: function() {
    return utils_js_2.anumber;
  } });
  Object.defineProperty(exports2, "bytesToHex", { enumerable: true, get: function() {
    return utils_js_2.bytesToHex;
  } });
  Object.defineProperty(exports2, "bytesToUtf8", { enumerable: true, get: function() {
    return utils_js_2.bytesToUtf8;
  } });
  Object.defineProperty(exports2, "concatBytes", { enumerable: true, get: function() {
    return utils_js_2.concatBytes;
  } });
  Object.defineProperty(exports2, "hexToBytes", { enumerable: true, get: function() {
    return utils_js_2.hexToBytes;
  } });
  Object.defineProperty(exports2, "isBytes", { enumerable: true, get: function() {
    return utils_js_2.isBytes;
  } });
  Object.defineProperty(exports2, "randomBytes", { enumerable: true, get: function() {
    return utils_js_2.randomBytes;
  } });
  Object.defineProperty(exports2, "utf8ToBytes", { enumerable: true, get: function() {
    return utils_js_2.utf8ToBytes;
  } });
  var _0n = /* @__PURE__ */ BigInt(0);
  var _1n = /* @__PURE__ */ BigInt(1);
  function abool(title, value) {
    if (typeof value !== "boolean")
      throw new Error(title + " boolean expected, got " + value);
  }
  function _abool2(value, title = "") {
    if (typeof value !== "boolean") {
      const prefix = title && `"${title}"`;
      throw new Error(prefix + "expected boolean, got type=" + typeof value);
    }
    return value;
  }
  function _abytes2(value, length, title = "") {
    const bytes = (0, utils_js_1.isBytes)(value);
    const len = value?.length;
    const needsLen = length !== undefined;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
    }
    return value;
  }
  function numberToHexUnpadded(num) {
    const hex = num.toString(16);
    return hex.length & 1 ? "0" + hex : hex;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    return hex === "" ? _0n : BigInt("0x" + hex);
  }
  function bytesToNumberBE(bytes) {
    return hexToNumber((0, utils_js_1.bytesToHex)(bytes));
  }
  function bytesToNumberLE(bytes) {
    (0, utils_js_1.abytes)(bytes);
    return hexToNumber((0, utils_js_1.bytesToHex)(Uint8Array.from(bytes).reverse()));
  }
  function numberToBytesBE(n, len) {
    return (0, utils_js_1.hexToBytes)(n.toString(16).padStart(len * 2, "0"));
  }
  function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
  }
  function numberToVarBytesBE(n) {
    return (0, utils_js_1.hexToBytes)(numberToHexUnpadded(n));
  }
  function ensureBytes(title, hex, expectedLength) {
    let res;
    if (typeof hex === "string") {
      try {
        res = (0, utils_js_1.hexToBytes)(hex);
      } catch (e) {
        throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
      }
    } else if ((0, utils_js_1.isBytes)(hex)) {
      res = Uint8Array.from(hex);
    } else {
      throw new Error(title + " must be hex string or Uint8Array");
    }
    const len = res.length;
    if (typeof expectedLength === "number" && len !== expectedLength)
      throw new Error(title + " of length " + expectedLength + " expected, got " + len);
    return res;
  }
  function equalBytes(a, b) {
    if (a.length !== b.length)
      return false;
    let diff = 0;
    for (let i = 0;i < a.length; i++)
      diff |= a[i] ^ b[i];
    return diff === 0;
  }
  function copyBytes(bytes) {
    return Uint8Array.from(bytes);
  }
  function asciiToBytes(ascii) {
    return Uint8Array.from(ascii, (c, i) => {
      const charCode = c.charCodeAt(0);
      if (c.length !== 1 || charCode > 127) {
        throw new Error(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
      }
      return charCode;
    });
  }
  var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
  function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
  }
  function aInRange(title, n, min, max) {
    if (!inRange(n, min, max))
      throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
  function bitLen(n) {
    let len;
    for (len = 0;n > _0n; n >>= _1n, len += 1)
      ;
    return len;
  }
  function bitGet(n, pos) {
    return n >> BigInt(pos) & _1n;
  }
  function bitSet(n, pos, value) {
    return n | (value ? _1n : _0n) << BigInt(pos);
  }
  var bitMask = (n) => (_1n << BigInt(n)) - _1n;
  exports2.bitMask = bitMask;
  function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    if (typeof hashLen !== "number" || hashLen < 2)
      throw new Error("hashLen must be a number");
    if (typeof qByteLen !== "number" || qByteLen < 2)
      throw new Error("qByteLen must be a number");
    if (typeof hmacFn !== "function")
      throw new Error("hmacFn must be a function");
    const u8n = (len) => new Uint8Array(len);
    const u8of = (byte) => Uint8Array.of(byte);
    let v = u8n(hashLen);
    let k = u8n(hashLen);
    let i = 0;
    const reset = () => {
      v.fill(1);
      k.fill(0);
      i = 0;
    };
    const h = (...b) => hmacFn(k, v, ...b);
    const reseed = (seed = u8n(0)) => {
      k = h(u8of(0), seed);
      v = h();
      if (seed.length === 0)
        return;
      k = h(u8of(1), seed);
      v = h();
    };
    const gen = () => {
      if (i++ >= 1000)
        throw new Error("drbg: tried 1000 values");
      let len = 0;
      const out = [];
      while (len < qByteLen) {
        v = h();
        const sl = v.slice();
        out.push(sl);
        len += v.length;
      }
      return (0, utils_js_1.concatBytes)(...out);
    };
    const genUntil = (seed, pred) => {
      reset();
      reseed(seed);
      let res = undefined;
      while (!(res = pred(gen())))
        reseed();
      reset();
      return res;
    };
    return genUntil;
  }
  var validatorFns = {
    bigint: (val) => typeof val === "bigint",
    function: (val) => typeof val === "function",
    boolean: (val) => typeof val === "boolean",
    string: (val) => typeof val === "string",
    stringOrUint8Array: (val) => typeof val === "string" || (0, utils_js_1.isBytes)(val),
    isSafeInteger: (val) => Number.isSafeInteger(val),
    array: (val) => Array.isArray(val),
    field: (val, object) => object.Fp.isValid(val),
    hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
  };
  function validateObject(object, validators, optValidators = {}) {
    const checkField = (fieldName, type, isOptional) => {
      const checkVal = validatorFns[type];
      if (typeof checkVal !== "function")
        throw new Error("invalid validator function");
      const val = object[fieldName];
      if (isOptional && val === undefined)
        return;
      if (!checkVal(val, object)) {
        throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
      }
    };
    for (const [fieldName, type] of Object.entries(validators))
      checkField(fieldName, type, false);
    for (const [fieldName, type] of Object.entries(optValidators))
      checkField(fieldName, type, true);
    return object;
  }
  function isHash(val) {
    return typeof val === "function" && Number.isSafeInteger(val.outputLen);
  }
  function _validateObject(object, fields, optFields = {}) {
    if (!object || typeof object !== "object")
      throw new Error("expected valid options object");
    function checkField(fieldName, expectedType, isOpt) {
      const val = object[fieldName];
      if (isOpt && val === undefined)
        return;
      const current = typeof val;
      if (current !== expectedType || val === null)
        throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
    Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
  }
  var notImplemented = () => {
    throw new Error("not implemented");
  };
  exports2.notImplemented = notImplemented;
  function memoized(fn) {
    const map = new WeakMap;
    return (arg, ...args) => {
      const val = map.get(arg);
      if (val !== undefined)
        return val;
      const computed = fn(arg, ...args);
      map.set(arg, computed);
      return computed;
    };
  }
});

// node_modules/@noble/curves/abstract/modular.js
var require_modular = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.isNegativeLE = undefined;
  exports2.mod = mod;
  exports2.pow = pow;
  exports2.pow2 = pow2;
  exports2.invert = invert;
  exports2.tonelliShanks = tonelliShanks;
  exports2.FpSqrt = FpSqrt;
  exports2.validateField = validateField;
  exports2.FpPow = FpPow;
  exports2.FpInvertBatch = FpInvertBatch;
  exports2.FpDiv = FpDiv;
  exports2.FpLegendre = FpLegendre;
  exports2.FpIsSquare = FpIsSquare;
  exports2.nLength = nLength;
  exports2.Field = Field;
  exports2.FpSqrtOdd = FpSqrtOdd;
  exports2.FpSqrtEven = FpSqrtEven;
  exports2.hashToPrivateScalar = hashToPrivateScalar;
  exports2.getFieldBytesLength = getFieldBytesLength;
  exports2.getMinHashLength = getMinHashLength;
  exports2.mapHashToField = mapHashToField;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var utils_ts_1 = require_utils3();
  var _0n = BigInt(0);
  var _1n = BigInt(1);
  var _2n = /* @__PURE__ */ BigInt(2);
  var _3n = /* @__PURE__ */ BigInt(3);
  var _4n = /* @__PURE__ */ BigInt(4);
  var _5n = /* @__PURE__ */ BigInt(5);
  var _7n = /* @__PURE__ */ BigInt(7);
  var _8n = /* @__PURE__ */ BigInt(8);
  var _9n = /* @__PURE__ */ BigInt(9);
  var _16n = /* @__PURE__ */ BigInt(16);
  function mod(a, b) {
    const result = a % b;
    return result >= _0n ? result : b + result;
  }
  function pow(num, power, modulo) {
    return FpPow(Field(modulo), num, power);
  }
  function pow2(x, power, modulo) {
    let res = x;
    while (power-- > _0n) {
      res *= res;
      res %= modulo;
    }
    return res;
  }
  function invert(number, modulo) {
    if (number === _0n)
      throw new Error("invert: expected non-zero number");
    if (modulo <= _0n)
      throw new Error("invert: expected positive modulus, got " + modulo);
    let a = mod(number, modulo);
    let b = modulo;
    let x = _0n, y = _1n, u = _1n, v = _0n;
    while (a !== _0n) {
      const q = b / a;
      const r = b % a;
      const m = x - u * q;
      const n = y - v * q;
      b = a, a = r, x = u, y = v, u = m, v = n;
    }
    const gcd = b;
    if (gcd !== _1n)
      throw new Error("invert: does not exist");
    return mod(x, modulo);
  }
  function assertIsSquare(Fp, root, n) {
    if (!Fp.eql(Fp.sqr(root), n))
      throw new Error("Cannot find square root");
  }
  function sqrt3mod4(Fp, n) {
    const p1div4 = (Fp.ORDER + _1n) / _4n;
    const root = Fp.pow(n, p1div4);
    assertIsSquare(Fp, root, n);
    return root;
  }
  function sqrt5mod8(Fp, n) {
    const p5div8 = (Fp.ORDER - _5n) / _8n;
    const n2 = Fp.mul(n, _2n);
    const v = Fp.pow(n2, p5div8);
    const nv = Fp.mul(n, v);
    const i = Fp.mul(Fp.mul(nv, _2n), v);
    const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
    assertIsSquare(Fp, root, n);
    return root;
  }
  function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
    const c2 = tn(Fp_, c1);
    const c3 = tn(Fp_, Fp_.neg(c1));
    const c4 = (P + _7n) / _16n;
    return (Fp, n) => {
      let tv1 = Fp.pow(n, c4);
      let tv2 = Fp.mul(tv1, c1);
      const tv3 = Fp.mul(tv1, c2);
      const tv4 = Fp.mul(tv1, c3);
      const e1 = Fp.eql(Fp.sqr(tv2), n);
      const e2 = Fp.eql(Fp.sqr(tv3), n);
      tv1 = Fp.cmov(tv1, tv2, e1);
      tv2 = Fp.cmov(tv4, tv3, e2);
      const e3 = Fp.eql(Fp.sqr(tv2), n);
      const root = Fp.cmov(tv1, tv2, e3);
      assertIsSquare(Fp, root, n);
      return root;
    };
  }
  function tonelliShanks(P) {
    if (P < _3n)
      throw new Error("sqrt is not defined for small field");
    let Q = P - _1n;
    let S = 0;
    while (Q % _2n === _0n) {
      Q /= _2n;
      S++;
    }
    let Z = _2n;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
      if (Z++ > 1000)
        throw new Error("Cannot find square root: probably non-prime P");
    }
    if (S === 1)
      return sqrt3mod4;
    let cc = _Fp.pow(Z, Q);
    const Q1div2 = (Q + _1n) / _2n;
    return function tonelliSlow(Fp, n) {
      if (Fp.is0(n))
        return n;
      if (FpLegendre(Fp, n) !== 1)
        throw new Error("Cannot find square root");
      let M = S;
      let c = Fp.mul(Fp.ONE, cc);
      let t = Fp.pow(n, Q);
      let R = Fp.pow(n, Q1div2);
      while (!Fp.eql(t, Fp.ONE)) {
        if (Fp.is0(t))
          return Fp.ZERO;
        let i = 1;
        let t_tmp = Fp.sqr(t);
        while (!Fp.eql(t_tmp, Fp.ONE)) {
          i++;
          t_tmp = Fp.sqr(t_tmp);
          if (i === M)
            throw new Error("Cannot find square root");
        }
        const exponent = _1n << BigInt(M - i - 1);
        const b = Fp.pow(c, exponent);
        M = i;
        c = Fp.sqr(b);
        t = Fp.mul(t, c);
        R = Fp.mul(R, b);
      }
      return R;
    };
  }
  function FpSqrt(P) {
    if (P % _4n === _3n)
      return sqrt3mod4;
    if (P % _8n === _5n)
      return sqrt5mod8;
    if (P % _16n === _9n)
      return sqrt9mod16(P);
    return tonelliShanks(P);
  }
  var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n) === _1n;
  exports2.isNegativeLE = isNegativeLE;
  var FIELD_FIELDS = [
    "create",
    "isValid",
    "is0",
    "neg",
    "inv",
    "sqrt",
    "sqr",
    "eql",
    "add",
    "sub",
    "mul",
    "pow",
    "div",
    "addN",
    "subN",
    "mulN",
    "sqrN"
  ];
  function validateField(field) {
    const initial = {
      ORDER: "bigint",
      MASK: "bigint",
      BYTES: "number",
      BITS: "number"
    };
    const opts = FIELD_FIELDS.reduce((map, val) => {
      map[val] = "function";
      return map;
    }, initial);
    (0, utils_ts_1._validateObject)(field, opts);
    return field;
  }
  function FpPow(Fp, num, power) {
    if (power < _0n)
      throw new Error("invalid exponent, negatives unsupported");
    if (power === _0n)
      return Fp.ONE;
    if (power === _1n)
      return num;
    let p = Fp.ONE;
    let d = num;
    while (power > _0n) {
      if (power & _1n)
        p = Fp.mul(p, d);
      d = Fp.sqr(d);
      power >>= _1n;
    }
    return p;
  }
  function FpInvertBatch(Fp, nums, passZero = false) {
    const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : undefined);
    const multipliedAcc = nums.reduce((acc, num, i) => {
      if (Fp.is0(num))
        return acc;
      inverted[i] = acc;
      return Fp.mul(acc, num);
    }, Fp.ONE);
    const invertedAcc = Fp.inv(multipliedAcc);
    nums.reduceRight((acc, num, i) => {
      if (Fp.is0(num))
        return acc;
      inverted[i] = Fp.mul(acc, inverted[i]);
      return Fp.mul(acc, num);
    }, invertedAcc);
    return inverted;
  }
  function FpDiv(Fp, lhs, rhs) {
    return Fp.mul(lhs, typeof rhs === "bigint" ? invert(rhs, Fp.ORDER) : Fp.inv(rhs));
  }
  function FpLegendre(Fp, n) {
    const p1mod2 = (Fp.ORDER - _1n) / _2n;
    const powered = Fp.pow(n, p1mod2);
    const yes = Fp.eql(powered, Fp.ONE);
    const zero = Fp.eql(powered, Fp.ZERO);
    const no = Fp.eql(powered, Fp.neg(Fp.ONE));
    if (!yes && !zero && !no)
      throw new Error("invalid Legendre symbol result");
    return yes ? 1 : zero ? 0 : -1;
  }
  function FpIsSquare(Fp, n) {
    const l = FpLegendre(Fp, n);
    return l === 1;
  }
  function nLength(n, nBitLength) {
    if (nBitLength !== undefined)
      (0, utils_ts_1.anumber)(nBitLength);
    const _nBitLength = nBitLength !== undefined ? nBitLength : n.toString(2).length;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
  }
  function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
    if (ORDER <= _0n)
      throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
    let _nbitLength = undefined;
    let _sqrt = undefined;
    let modFromBytes = false;
    let allowedLengths = undefined;
    if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
      if (opts.sqrt || isLE)
        throw new Error("cannot specify opts in two arguments");
      const _opts = bitLenOrOpts;
      if (_opts.BITS)
        _nbitLength = _opts.BITS;
      if (_opts.sqrt)
        _sqrt = _opts.sqrt;
      if (typeof _opts.isLE === "boolean")
        isLE = _opts.isLE;
      if (typeof _opts.modFromBytes === "boolean")
        modFromBytes = _opts.modFromBytes;
      allowedLengths = _opts.allowedLengths;
    } else {
      if (typeof bitLenOrOpts === "number")
        _nbitLength = bitLenOrOpts;
      if (opts.sqrt)
        _sqrt = opts.sqrt;
    }
    const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
    if (BYTES > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    let sqrtP;
    const f = Object.freeze({
      ORDER,
      isLE,
      BITS,
      BYTES,
      MASK: (0, utils_ts_1.bitMask)(BITS),
      ZERO: _0n,
      ONE: _1n,
      allowedLengths,
      create: (num) => mod(num, ORDER),
      isValid: (num) => {
        if (typeof num !== "bigint")
          throw new Error("invalid field element: expected bigint, got " + typeof num);
        return _0n <= num && num < ORDER;
      },
      is0: (num) => num === _0n,
      isValidNot0: (num) => !f.is0(num) && f.isValid(num),
      isOdd: (num) => (num & _1n) === _1n,
      neg: (num) => mod(-num, ORDER),
      eql: (lhs, rhs) => lhs === rhs,
      sqr: (num) => mod(num * num, ORDER),
      add: (lhs, rhs) => mod(lhs + rhs, ORDER),
      sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
      mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
      pow: (num, power) => FpPow(f, num, power),
      div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
      sqrN: (num) => num * num,
      addN: (lhs, rhs) => lhs + rhs,
      subN: (lhs, rhs) => lhs - rhs,
      mulN: (lhs, rhs) => lhs * rhs,
      inv: (num) => invert(num, ORDER),
      sqrt: _sqrt || ((n) => {
        if (!sqrtP)
          sqrtP = FpSqrt(ORDER);
        return sqrtP(f, n);
      }),
      toBytes: (num) => isLE ? (0, utils_ts_1.numberToBytesLE)(num, BYTES) : (0, utils_ts_1.numberToBytesBE)(num, BYTES),
      fromBytes: (bytes, skipValidation = true) => {
        if (allowedLengths) {
          if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
            throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
          }
          const padded = new Uint8Array(BYTES);
          padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
          bytes = padded;
        }
        if (bytes.length !== BYTES)
          throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
        let scalar = isLE ? (0, utils_ts_1.bytesToNumberLE)(bytes) : (0, utils_ts_1.bytesToNumberBE)(bytes);
        if (modFromBytes)
          scalar = mod(scalar, ORDER);
        if (!skipValidation) {
          if (!f.isValid(scalar))
            throw new Error("invalid field element: outside of range 0..ORDER");
        }
        return scalar;
      },
      invertBatch: (lst) => FpInvertBatch(f, lst),
      cmov: (a, b, c) => c ? b : a
    });
    return Object.freeze(f);
  }
  function FpSqrtOdd(Fp, elm) {
    if (!Fp.isOdd)
      throw new Error("Field doesn't have isOdd");
    const root = Fp.sqrt(elm);
    return Fp.isOdd(root) ? root : Fp.neg(root);
  }
  function FpSqrtEven(Fp, elm) {
    if (!Fp.isOdd)
      throw new Error("Field doesn't have isOdd");
    const root = Fp.sqrt(elm);
    return Fp.isOdd(root) ? Fp.neg(root) : root;
  }
  function hashToPrivateScalar(hash, groupOrder, isLE = false) {
    hash = (0, utils_ts_1.ensureBytes)("privateHash", hash);
    const hashLen = hash.length;
    const minLen = nLength(groupOrder).nByteLength + 8;
    if (minLen < 24 || hashLen < minLen || hashLen > 1024)
      throw new Error("hashToPrivateScalar: expected " + minLen + "-1024 bytes of input, got " + hashLen);
    const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(hash) : (0, utils_ts_1.bytesToNumberBE)(hash);
    return mod(num, groupOrder - _1n) + _1n;
  }
  function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== "bigint")
      throw new Error("field order must be bigint");
    const bitLength = fieldOrder.toString(2).length;
    return Math.ceil(bitLength / 8);
  }
  function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
  }
  function mapHashToField(key, fieldOrder, isLE = false) {
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    if (len < 16 || len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(key) : (0, utils_ts_1.bytesToNumberBE)(key);
    const reduced = mod(num, fieldOrder - _1n) + _1n;
    return isLE ? (0, utils_ts_1.numberToBytesLE)(reduced, fieldLen) : (0, utils_ts_1.numberToBytesBE)(reduced, fieldLen);
  }
});

// node_modules/@noble/curves/abstract/curve.js
var require_curve = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.wNAF = undefined;
  exports2.negateCt = negateCt;
  exports2.normalizeZ = normalizeZ;
  exports2.mulEndoUnsafe = mulEndoUnsafe;
  exports2.pippenger = pippenger;
  exports2.precomputeMSMUnsafe = precomputeMSMUnsafe;
  exports2.validateBasic = validateBasic;
  exports2._createCurveFields = _createCurveFields;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var utils_ts_1 = require_utils3();
  var modular_ts_1 = require_modular();
  var _0n = BigInt(0);
  var _1n = BigInt(1);
  function negateCt(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
  }
  function normalizeZ(c, points) {
    const invertedZs = (0, modular_ts_1.FpInvertBatch)(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
  }
  function validateW(W, bits) {
    if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
      throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
  }
  function calcWOpts(W, scalarBits) {
    validateW(W, scalarBits);
    const windows = Math.ceil(scalarBits / W) + 1;
    const windowSize = 2 ** (W - 1);
    const maxNumber = 2 ** W;
    const mask = (0, utils_ts_1.bitMask)(W);
    const shiftBy = BigInt(W);
    return { windows, windowSize, mask, maxNumber, shiftBy };
  }
  function calcOffsets(n, window, wOpts) {
    const { windowSize, mask, maxNumber, shiftBy } = wOpts;
    let wbits = Number(n & mask);
    let nextN = n >> shiftBy;
    if (wbits > windowSize) {
      wbits -= maxNumber;
      nextN += _1n;
    }
    const offsetStart = window * windowSize;
    const offset = offsetStart + Math.abs(wbits) - 1;
    const isZero = wbits === 0;
    const isNeg = wbits < 0;
    const isNegF = window % 2 !== 0;
    const offsetF = offsetStart;
    return { nextN, offset, isZero, isNeg, isNegF, offsetF };
  }
  function validateMSMPoints(points, c) {
    if (!Array.isArray(points))
      throw new Error("array expected");
    points.forEach((p, i) => {
      if (!(p instanceof c))
        throw new Error("invalid point at index " + i);
    });
  }
  function validateMSMScalars(scalars, field) {
    if (!Array.isArray(scalars))
      throw new Error("array of scalars expected");
    scalars.forEach((s, i) => {
      if (!field.isValid(s))
        throw new Error("invalid scalar at index " + i);
    });
  }
  var pointPrecomputes = new WeakMap;
  var pointWindowSizes = new WeakMap;
  function getW(P) {
    return pointWindowSizes.get(P) || 1;
  }
  function assert0(n) {
    if (n !== _0n)
      throw new Error("invalid wNAF");
  }

  class wNAF {
    constructor(Point, bits) {
      this.BASE = Point.BASE;
      this.ZERO = Point.ZERO;
      this.Fn = Point.Fn;
      this.bits = bits;
    }
    _unsafeLadder(elm, n, p = this.ZERO) {
      let d = elm;
      while (n > _0n) {
        if (n & _1n)
          p = p.add(d);
        d = d.double();
        n >>= _1n;
      }
      return p;
    }
    precomputeWindow(point, W) {
      const { windows, windowSize } = calcWOpts(W, this.bits);
      const points = [];
      let p = point;
      let base = p;
      for (let window = 0;window < windows; window++) {
        base = p;
        points.push(base);
        for (let i = 1;i < windowSize; i++) {
          base = base.add(p);
          points.push(base);
        }
        p = base.double();
      }
      return points;
    }
    wNAF(W, precomputes, n) {
      if (!this.Fn.isValid(n))
        throw new Error("invalid scalar");
      let p = this.ZERO;
      let f = this.BASE;
      const wo = calcWOpts(W, this.bits);
      for (let window = 0;window < wo.windows; window++) {
        const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
        n = nextN;
        if (isZero) {
          f = f.add(negateCt(isNegF, precomputes[offsetF]));
        } else {
          p = p.add(negateCt(isNeg, precomputes[offset]));
        }
      }
      assert0(n);
      return { p, f };
    }
    wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
      const wo = calcWOpts(W, this.bits);
      for (let window = 0;window < wo.windows; window++) {
        if (n === _0n)
          break;
        const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
        n = nextN;
        if (isZero) {
          continue;
        } else {
          const item = precomputes[offset];
          acc = acc.add(isNeg ? item.negate() : item);
        }
      }
      assert0(n);
      return acc;
    }
    getPrecomputes(W, point, transform) {
      let comp = pointPrecomputes.get(point);
      if (!comp) {
        comp = this.precomputeWindow(point, W);
        if (W !== 1) {
          if (typeof transform === "function")
            comp = transform(comp);
          pointPrecomputes.set(point, comp);
        }
      }
      return comp;
    }
    cached(point, scalar, transform) {
      const W = getW(point);
      return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
    }
    unsafe(point, scalar, transform, prev) {
      const W = getW(point);
      if (W === 1)
        return this._unsafeLadder(point, scalar, prev);
      return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
    }
    createCache(P, W) {
      validateW(W, this.bits);
      pointWindowSizes.set(P, W);
      pointPrecomputes.delete(P);
    }
    hasCache(elm) {
      return getW(elm) !== 1;
    }
  }
  exports2.wNAF = wNAF;
  function mulEndoUnsafe(Point, point, k1, k2) {
    let acc = point;
    let p1 = Point.ZERO;
    let p2 = Point.ZERO;
    while (k1 > _0n || k2 > _0n) {
      if (k1 & _1n)
        p1 = p1.add(acc);
      if (k2 & _1n)
        p2 = p2.add(acc);
      acc = acc.double();
      k1 >>= _1n;
      k2 >>= _1n;
    }
    return { p1, p2 };
  }
  function pippenger(c, fieldN, points, scalars) {
    validateMSMPoints(points, c);
    validateMSMScalars(scalars, fieldN);
    const plength = points.length;
    const slength = scalars.length;
    if (plength !== slength)
      throw new Error("arrays of points and scalars must have equal length");
    const zero = c.ZERO;
    const wbits = (0, utils_ts_1.bitLen)(BigInt(plength));
    let windowSize = 1;
    if (wbits > 12)
      windowSize = wbits - 3;
    else if (wbits > 4)
      windowSize = wbits - 2;
    else if (wbits > 0)
      windowSize = 2;
    const MASK = (0, utils_ts_1.bitMask)(windowSize);
    const buckets = new Array(Number(MASK) + 1).fill(zero);
    const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
    let sum = zero;
    for (let i = lastBits;i >= 0; i -= windowSize) {
      buckets.fill(zero);
      for (let j = 0;j < slength; j++) {
        const scalar = scalars[j];
        const wbits2 = Number(scalar >> BigInt(i) & MASK);
        buckets[wbits2] = buckets[wbits2].add(points[j]);
      }
      let resI = zero;
      for (let j = buckets.length - 1, sumI = zero;j > 0; j--) {
        sumI = sumI.add(buckets[j]);
        resI = resI.add(sumI);
      }
      sum = sum.add(resI);
      if (i !== 0)
        for (let j = 0;j < windowSize; j++)
          sum = sum.double();
    }
    return sum;
  }
  function precomputeMSMUnsafe(c, fieldN, points, windowSize) {
    validateW(windowSize, fieldN.BITS);
    validateMSMPoints(points, c);
    const zero = c.ZERO;
    const tableSize = 2 ** windowSize - 1;
    const chunks = Math.ceil(fieldN.BITS / windowSize);
    const MASK = (0, utils_ts_1.bitMask)(windowSize);
    const tables = points.map((p) => {
      const res = [];
      for (let i = 0, acc = p;i < tableSize; i++) {
        res.push(acc);
        acc = acc.add(p);
      }
      return res;
    });
    return (scalars) => {
      validateMSMScalars(scalars, fieldN);
      if (scalars.length > points.length)
        throw new Error("array of scalars must be smaller than array of points");
      let res = zero;
      for (let i = 0;i < chunks; i++) {
        if (res !== zero)
          for (let j = 0;j < windowSize; j++)
            res = res.double();
        const shiftBy = BigInt(chunks * windowSize - (i + 1) * windowSize);
        for (let j = 0;j < scalars.length; j++) {
          const n = scalars[j];
          const curr = Number(n >> shiftBy & MASK);
          if (!curr)
            continue;
          res = res.add(tables[j][curr - 1]);
        }
      }
      return res;
    };
  }
  function validateBasic(curve) {
    (0, modular_ts_1.validateField)(curve.Fp);
    (0, utils_ts_1.validateObject)(curve, {
      n: "bigint",
      h: "bigint",
      Gx: "field",
      Gy: "field"
    }, {
      nBitLength: "isSafeInteger",
      nByteLength: "isSafeInteger"
    });
    return Object.freeze({
      ...(0, modular_ts_1.nLength)(curve.n, curve.nBitLength),
      ...curve,
      ...{ p: curve.Fp.ORDER }
    });
  }
  function createField(order, field, isLE) {
    if (field) {
      if (field.ORDER !== order)
        throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
      (0, modular_ts_1.validateField)(field);
      return field;
    } else {
      return (0, modular_ts_1.Field)(order, { isLE });
    }
  }
  function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (FpFnLE === undefined)
      FpFnLE = type === "edwards";
    if (!CURVE || typeof CURVE !== "object")
      throw new Error(`expected valid ${type} CURVE object`);
    for (const p of ["p", "n", "h"]) {
      const val = CURVE[p];
      if (!(typeof val === "bigint" && val > _0n))
        throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === "weierstrass" ? "b" : "d";
    const params = ["Gx", "Gy", "a", _b];
    for (const p of params) {
      if (!Fp.isValid(CURVE[p]))
        throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn };
  }
});

// node_modules/@noble/curves/abstract/edwards.js
var require_edwards = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.PrimeEdwardsPoint = undefined;
  exports2.edwards = edwards;
  exports2.eddsa = eddsa;
  exports2.twistedEdwards = twistedEdwards;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var utils_ts_1 = require_utils3();
  var curve_ts_1 = require_curve();
  var modular_ts_1 = require_modular();
  var _0n = BigInt(0);
  var _1n = BigInt(1);
  var _2n = BigInt(2);
  var _8n = BigInt(8);
  function isEdValidXY(Fp, CURVE, x, y) {
    const x2 = Fp.sqr(x);
    const y2 = Fp.sqr(y);
    const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
    const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
    return Fp.eql(left, right);
  }
  function edwards(params, extraOpts = {}) {
    const validated = (0, curve_ts_1._createCurveFields)("edwards", params, extraOpts, extraOpts.FpFnLE);
    const { Fp, Fn } = validated;
    let CURVE = validated.CURVE;
    const { h: cofactor } = CURVE;
    (0, utils_ts_1._validateObject)(extraOpts, {}, { uvRatio: "function" });
    const MASK = _2n << BigInt(Fn.BYTES * 8) - _1n;
    const modP = (n) => Fp.create(n);
    const uvRatio = extraOpts.uvRatio || ((u, v) => {
      try {
        return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
      } catch (e) {
        return { isValid: false, value: _0n };
      }
    });
    if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
      throw new Error("bad curve params: generator point");
    function acoord(title, n, banZero = false) {
      const min = banZero ? _1n : _0n;
      (0, utils_ts_1.aInRange)("coordinate " + title, n, min, MASK);
      return n;
    }
    function aextpoint(other) {
      if (!(other instanceof Point))
        throw new Error("ExtendedPoint expected");
    }
    const toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? _8n : Fp.inv(Z);
      const x = modP(X * iz);
      const y = modP(Y * iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: _0n, y: _1n };
      if (zz !== _1n)
        throw new Error("invZ was invalid");
      return { x, y };
    });
    const assertValidMemo = (0, utils_ts_1.memoized)((p) => {
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = modP(X * X);
      const Y2 = modP(Y * Y);
      const Z2 = modP(Z * Z);
      const Z4 = modP(Z2 * Z2);
      const aX2 = modP(X2 * a);
      const left = modP(Z2 * modP(aX2 + Y2));
      const right = modP(Z4 + modP(d * modP(X2 * Y2)));
      if (left !== right)
        throw new Error("bad point: equation left != right (1)");
      const XY = modP(X * Y);
      const ZT = modP(Z * T);
      if (XY !== ZT)
        throw new Error("bad point: equation left != right (2)");
      return true;
    });

    class Point {
      constructor(X, Y, Z, T) {
        this.X = acoord("x", X);
        this.Y = acoord("y", Y);
        this.Z = acoord("z", Z, true);
        this.T = acoord("t", T);
        Object.freeze(this);
      }
      static CURVE() {
        return CURVE;
      }
      static fromAffine(p) {
        if (p instanceof Point)
          throw new Error("extended point not allowed");
        const { x, y } = p || {};
        acoord("x", x);
        acoord("y", y);
        return new Point(x, y, _1n, modP(x * y));
      }
      static fromBytes(bytes, zip215 = false) {
        const len = Fp.BYTES;
        const { a, d } = CURVE;
        bytes = (0, utils_ts_1.copyBytes)((0, utils_ts_1._abytes2)(bytes, len, "point"));
        (0, utils_ts_1._abool2)(zip215, "zip215");
        const normed = (0, utils_ts_1.copyBytes)(bytes);
        const lastByte = bytes[len - 1];
        normed[len - 1] = lastByte & ~128;
        const y = (0, utils_ts_1.bytesToNumberLE)(normed);
        const max = zip215 ? MASK : Fp.ORDER;
        (0, utils_ts_1.aInRange)("point.y", y, _0n, max);
        const y2 = modP(y * y);
        const u = modP(y2 - _1n);
        const v = modP(d * y2 - a);
        let { isValid: isValid2, value: x } = uvRatio(u, v);
        if (!isValid2)
          throw new Error("bad point: invalid y coordinate");
        const isXOdd = (x & _1n) === _1n;
        const isLastByteOdd = (lastByte & 128) !== 0;
        if (!zip215 && x === _0n && isLastByteOdd)
          throw new Error("bad point: x=0 and x_0=1");
        if (isLastByteOdd !== isXOdd)
          x = modP(-x);
        return Point.fromAffine({ x, y });
      }
      static fromHex(bytes, zip215 = false) {
        return Point.fromBytes((0, utils_ts_1.ensureBytes)("point", bytes), zip215);
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      precompute(windowSize = 8, isLazy = true) {
        wnaf.createCache(this, windowSize);
        if (!isLazy)
          this.multiply(_2n);
        return this;
      }
      assertValidity() {
        assertValidMemo(this);
      }
      equals(other) {
        aextpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        const X1Z2 = modP(X1 * Z2);
        const X2Z1 = modP(X2 * Z1);
        const Y1Z2 = modP(Y1 * Z2);
        const Y2Z1 = modP(Y2 * Z1);
        return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
      }
      is0() {
        return this.equals(Point.ZERO);
      }
      negate() {
        return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
      }
      double() {
        const { a } = CURVE;
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const A = modP(X1 * X1);
        const B = modP(Y1 * Y1);
        const C = modP(_2n * modP(Z1 * Z1));
        const D = modP(a * A);
        const x1y1 = X1 + Y1;
        const E = modP(modP(x1y1 * x1y1) - A - B);
        const G = D + B;
        const F = G - C;
        const H = D - B;
        const X3 = modP(E * F);
        const Y3 = modP(G * H);
        const T3 = modP(E * H);
        const Z3 = modP(F * G);
        return new Point(X3, Y3, Z3, T3);
      }
      add(other) {
        aextpoint(other);
        const { a, d } = CURVE;
        const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
        const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
        const A = modP(X1 * X2);
        const B = modP(Y1 * Y2);
        const C = modP(T1 * d * T2);
        const D = modP(Z1 * Z2);
        const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
        const F = D - C;
        const G = D + C;
        const H = modP(B - a * A);
        const X3 = modP(E * F);
        const Y3 = modP(G * H);
        const T3 = modP(E * H);
        const Z3 = modP(F * G);
        return new Point(X3, Y3, Z3, T3);
      }
      subtract(other) {
        return this.add(other.negate());
      }
      multiply(scalar) {
        if (!Fn.isValidNot0(scalar))
          throw new Error("invalid scalar: expected 1 <= sc < curve.n");
        const { p, f } = wnaf.cached(this, scalar, (p2) => (0, curve_ts_1.normalizeZ)(Point, p2));
        return (0, curve_ts_1.normalizeZ)(Point, [p, f])[0];
      }
      multiplyUnsafe(scalar, acc = Point.ZERO) {
        if (!Fn.isValid(scalar))
          throw new Error("invalid scalar: expected 0 <= sc < curve.n");
        if (scalar === _0n)
          return Point.ZERO;
        if (this.is0() || scalar === _1n)
          return this;
        return wnaf.unsafe(this, scalar, (p) => (0, curve_ts_1.normalizeZ)(Point, p), acc);
      }
      isSmallOrder() {
        return this.multiplyUnsafe(cofactor).is0();
      }
      isTorsionFree() {
        return wnaf.unsafe(this, CURVE.n).is0();
      }
      toAffine(invertedZ) {
        return toAffineMemo(this, invertedZ);
      }
      clearCofactor() {
        if (cofactor === _1n)
          return this;
        return this.multiplyUnsafe(cofactor);
      }
      toBytes() {
        const { x, y } = this.toAffine();
        const bytes = Fp.toBytes(y);
        bytes[bytes.length - 1] |= x & _1n ? 128 : 0;
        return bytes;
      }
      toHex() {
        return (0, utils_ts_1.bytesToHex)(this.toBytes());
      }
      toString() {
        return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
      }
      get ex() {
        return this.X;
      }
      get ey() {
        return this.Y;
      }
      get ez() {
        return this.Z;
      }
      get et() {
        return this.T;
      }
      static normalizeZ(points) {
        return (0, curve_ts_1.normalizeZ)(Point, points);
      }
      static msm(points, scalars) {
        return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
      }
      _setWindowSize(windowSize) {
        this.precompute(windowSize);
      }
      toRawBytes() {
        return this.toBytes();
      }
    }
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n, modP(CURVE.Gx * CURVE.Gy));
    Point.ZERO = new Point(_0n, _1n, _1n, _0n);
    Point.Fp = Fp;
    Point.Fn = Fn;
    const wnaf = new curve_ts_1.wNAF(Point, Fn.BITS);
    Point.BASE.precompute(8);
    return Point;
  }

  class PrimeEdwardsPoint {
    constructor(ep) {
      this.ep = ep;
    }
    static fromBytes(_bytes) {
      (0, utils_ts_1.notImplemented)();
    }
    static fromHex(_hex) {
      (0, utils_ts_1.notImplemented)();
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    clearCofactor() {
      return this;
    }
    assertValidity() {
      this.ep.assertValidity();
    }
    toAffine(invertedZ) {
      return this.ep.toAffine(invertedZ);
    }
    toHex() {
      return (0, utils_ts_1.bytesToHex)(this.toBytes());
    }
    toString() {
      return this.toHex();
    }
    isTorsionFree() {
      return true;
    }
    isSmallOrder() {
      return false;
    }
    add(other) {
      this.assertSame(other);
      return this.init(this.ep.add(other.ep));
    }
    subtract(other) {
      this.assertSame(other);
      return this.init(this.ep.subtract(other.ep));
    }
    multiply(scalar) {
      return this.init(this.ep.multiply(scalar));
    }
    multiplyUnsafe(scalar) {
      return this.init(this.ep.multiplyUnsafe(scalar));
    }
    double() {
      return this.init(this.ep.double());
    }
    negate() {
      return this.init(this.ep.negate());
    }
    precompute(windowSize, isLazy) {
      return this.init(this.ep.precompute(windowSize, isLazy));
    }
    toRawBytes() {
      return this.toBytes();
    }
  }
  exports2.PrimeEdwardsPoint = PrimeEdwardsPoint;
  function eddsa(Point, cHash, eddsaOpts = {}) {
    if (typeof cHash !== "function")
      throw new Error('"hash" function param is required');
    (0, utils_ts_1._validateObject)(eddsaOpts, {}, {
      adjustScalarBytes: "function",
      randomBytes: "function",
      domain: "function",
      prehash: "function",
      mapToCurve: "function"
    });
    const { prehash } = eddsaOpts;
    const { BASE, Fp, Fn } = Point;
    const randomBytes = eddsaOpts.randomBytes || utils_ts_1.randomBytes;
    const adjustScalarBytes = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
    const domain = eddsaOpts.domain || ((data, ctx, phflag) => {
      (0, utils_ts_1._abool2)(phflag, "phflag");
      if (ctx.length || phflag)
        throw new Error("Contexts/pre-hash are not supported");
      return data;
    });
    function modN_LE(hash) {
      return Fn.create((0, utils_ts_1.bytesToNumberLE)(hash));
    }
    function getPrivateScalar(key) {
      const len = lengths.secretKey;
      key = (0, utils_ts_1.ensureBytes)("private key", key, len);
      const hashed = (0, utils_ts_1.ensureBytes)("hashed private key", cHash(key), 2 * len);
      const head = adjustScalarBytes(hashed.slice(0, len));
      const prefix = hashed.slice(len, 2 * len);
      const scalar = modN_LE(head);
      return { head, prefix, scalar };
    }
    function getExtendedPublicKey(secretKey) {
      const { head, prefix, scalar } = getPrivateScalar(secretKey);
      const point = BASE.multiply(scalar);
      const pointBytes = point.toBytes();
      return { head, prefix, scalar, point, pointBytes };
    }
    function getPublicKey(secretKey) {
      return getExtendedPublicKey(secretKey).pointBytes;
    }
    function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
      const msg = (0, utils_ts_1.concatBytes)(...msgs);
      return modN_LE(cHash(domain(msg, (0, utils_ts_1.ensureBytes)("context", context), !!prehash)));
    }
    function sign(msg, secretKey, options = {}) {
      msg = (0, utils_ts_1.ensureBytes)("message", msg);
      if (prehash)
        msg = prehash(msg);
      const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
      const r = hashDomainToScalar(options.context, prefix, msg);
      const R = BASE.multiply(r).toBytes();
      const k = hashDomainToScalar(options.context, R, pointBytes, msg);
      const s = Fn.create(r + k * scalar);
      if (!Fn.isValid(s))
        throw new Error("sign failed: invalid s");
      const rs = (0, utils_ts_1.concatBytes)(R, Fn.toBytes(s));
      return (0, utils_ts_1._abytes2)(rs, lengths.signature, "result");
    }
    const verifyOpts = { zip215: true };
    function verify(sig, msg, publicKey, options = verifyOpts) {
      const { context, zip215 } = options;
      const len = lengths.signature;
      sig = (0, utils_ts_1.ensureBytes)("signature", sig, len);
      msg = (0, utils_ts_1.ensureBytes)("message", msg);
      publicKey = (0, utils_ts_1.ensureBytes)("publicKey", publicKey, lengths.publicKey);
      if (zip215 !== undefined)
        (0, utils_ts_1._abool2)(zip215, "zip215");
      if (prehash)
        msg = prehash(msg);
      const mid = len / 2;
      const r = sig.subarray(0, mid);
      const s = (0, utils_ts_1.bytesToNumberLE)(sig.subarray(mid, len));
      let A, R, SB;
      try {
        A = Point.fromBytes(publicKey, zip215);
        R = Point.fromBytes(r, zip215);
        SB = BASE.multiplyUnsafe(s);
      } catch (error) {
        return false;
      }
      if (!zip215 && A.isSmallOrder())
        return false;
      const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
      const RkA = R.add(A.multiplyUnsafe(k));
      return RkA.subtract(SB).clearCofactor().is0();
    }
    const _size = Fp.BYTES;
    const lengths = {
      secretKey: _size,
      publicKey: _size,
      signature: 2 * _size,
      seed: _size
    };
    function randomSecretKey(seed = randomBytes(lengths.seed)) {
      return (0, utils_ts_1._abytes2)(seed, lengths.seed, "seed");
    }
    function keygen(seed) {
      const secretKey = utils.randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey(secretKey) };
    }
    function isValidSecretKey(key) {
      return (0, utils_ts_1.isBytes)(key) && key.length === Fn.BYTES;
    }
    function isValidPublicKey(key, zip215) {
      try {
        return !!Point.fromBytes(key, zip215);
      } catch (error) {
        return false;
      }
    }
    const utils = {
      getExtendedPublicKey,
      randomSecretKey,
      isValidSecretKey,
      isValidPublicKey,
      toMontgomery(publicKey) {
        const { y } = Point.fromBytes(publicKey);
        const size = lengths.publicKey;
        const is25519 = size === 32;
        if (!is25519 && size !== 57)
          throw new Error("only defined for 25519 and 448");
        const u = is25519 ? Fp.div(_1n + y, _1n - y) : Fp.div(y - _1n, y + _1n);
        return Fp.toBytes(u);
      },
      toMontgomerySecret(secretKey) {
        const size = lengths.secretKey;
        (0, utils_ts_1._abytes2)(secretKey, size);
        const hashed = cHash(secretKey.subarray(0, size));
        return adjustScalarBytes(hashed).subarray(0, size);
      },
      randomPrivateKey: randomSecretKey,
      precompute(windowSize = 8, point = Point.BASE) {
        return point.precompute(windowSize, false);
      }
    };
    return Object.freeze({
      keygen,
      getPublicKey,
      sign,
      verify,
      utils,
      Point,
      lengths
    });
  }
  function _eddsa_legacy_opts_to_new(c) {
    const CURVE = {
      a: c.a,
      d: c.d,
      p: c.Fp.ORDER,
      n: c.n,
      h: c.h,
      Gx: c.Gx,
      Gy: c.Gy
    };
    const Fp = c.Fp;
    const Fn = (0, modular_ts_1.Field)(CURVE.n, c.nBitLength, true);
    const curveOpts = { Fp, Fn, uvRatio: c.uvRatio };
    const eddsaOpts = {
      randomBytes: c.randomBytes,
      adjustScalarBytes: c.adjustScalarBytes,
      domain: c.domain,
      prehash: c.prehash,
      mapToCurve: c.mapToCurve
    };
    return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
  }
  function _eddsa_new_output_to_legacy(c, eddsa2) {
    const Point = eddsa2.Point;
    const legacy = Object.assign({}, eddsa2, {
      ExtendedPoint: Point,
      CURVE: c,
      nBitLength: Point.Fn.BITS,
      nByteLength: Point.Fn.BYTES
    });
    return legacy;
  }
  function twistedEdwards(c) {
    const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
    const Point = edwards(CURVE, curveOpts);
    const EDDSA = eddsa(Point, hash, eddsaOpts);
    return _eddsa_new_output_to_legacy(c, EDDSA);
  }
});

// node_modules/@noble/curves/abstract/hash-to-curve.js
var require_hash_to_curve = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2._DST_scalar = undefined;
  exports2.expand_message_xmd = expand_message_xmd;
  exports2.expand_message_xof = expand_message_xof;
  exports2.hash_to_field = hash_to_field;
  exports2.isogenyMap = isogenyMap;
  exports2.createHasher = createHasher;
  var utils_ts_1 = require_utils3();
  var modular_ts_1 = require_modular();
  var os2ip = utils_ts_1.bytesToNumberBE;
  function i2osp(value, length) {
    anum(value);
    anum(length);
    if (value < 0 || value >= 1 << 8 * length)
      throw new Error("invalid I2OSP input: " + value);
    const res = Array.from({ length }).fill(0);
    for (let i = length - 1;i >= 0; i--) {
      res[i] = value & 255;
      value >>>= 8;
    }
    return new Uint8Array(res);
  }
  function strxor(a, b) {
    const arr = new Uint8Array(a.length);
    for (let i = 0;i < a.length; i++) {
      arr[i] = a[i] ^ b[i];
    }
    return arr;
  }
  function anum(item) {
    if (!Number.isSafeInteger(item))
      throw new Error("number expected");
  }
  function normDST(DST) {
    if (!(0, utils_ts_1.isBytes)(DST) && typeof DST !== "string")
      throw new Error("DST must be Uint8Array or string");
    return typeof DST === "string" ? (0, utils_ts_1.utf8ToBytes)(DST) : DST;
  }
  function expand_message_xmd(msg, DST, lenInBytes, H) {
    (0, utils_ts_1.abytes)(msg);
    anum(lenInBytes);
    DST = normDST(DST);
    if (DST.length > 255)
      DST = H((0, utils_ts_1.concatBytes)((0, utils_ts_1.utf8ToBytes)("H2C-OVERSIZE-DST-"), DST));
    const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
    const ell = Math.ceil(lenInBytes / b_in_bytes);
    if (lenInBytes > 65535 || ell > 255)
      throw new Error("expand_message_xmd: invalid lenInBytes");
    const DST_prime = (0, utils_ts_1.concatBytes)(DST, i2osp(DST.length, 1));
    const Z_pad = i2osp(0, r_in_bytes);
    const l_i_b_str = i2osp(lenInBytes, 2);
    const b = new Array(ell);
    const b_0 = H((0, utils_ts_1.concatBytes)(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
    b[0] = H((0, utils_ts_1.concatBytes)(b_0, i2osp(1, 1), DST_prime));
    for (let i = 1;i <= ell; i++) {
      const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
      b[i] = H((0, utils_ts_1.concatBytes)(...args));
    }
    const pseudo_random_bytes = (0, utils_ts_1.concatBytes)(...b);
    return pseudo_random_bytes.slice(0, lenInBytes);
  }
  function expand_message_xof(msg, DST, lenInBytes, k, H) {
    (0, utils_ts_1.abytes)(msg);
    anum(lenInBytes);
    DST = normDST(DST);
    if (DST.length > 255) {
      const dkLen = Math.ceil(2 * k / 8);
      DST = H.create({ dkLen }).update((0, utils_ts_1.utf8ToBytes)("H2C-OVERSIZE-DST-")).update(DST).digest();
    }
    if (lenInBytes > 65535 || DST.length > 255)
      throw new Error("expand_message_xof: invalid lenInBytes");
    return H.create({ dkLen: lenInBytes }).update(msg).update(i2osp(lenInBytes, 2)).update(DST).update(i2osp(DST.length, 1)).digest();
  }
  function hash_to_field(msg, count, options) {
    (0, utils_ts_1._validateObject)(options, {
      p: "bigint",
      m: "number",
      k: "number",
      hash: "function"
    });
    const { p, k, m, hash, expand, DST } = options;
    if (!(0, utils_ts_1.isHash)(options.hash))
      throw new Error("expected valid hash");
    (0, utils_ts_1.abytes)(msg);
    anum(count);
    const log2p = p.toString(2).length;
    const L = Math.ceil((log2p + k) / 8);
    const len_in_bytes = count * m * L;
    let prb;
    if (expand === "xmd") {
      prb = expand_message_xmd(msg, DST, len_in_bytes, hash);
    } else if (expand === "xof") {
      prb = expand_message_xof(msg, DST, len_in_bytes, k, hash);
    } else if (expand === "_internal_pass") {
      prb = msg;
    } else {
      throw new Error('expand must be "xmd" or "xof"');
    }
    const u = new Array(count);
    for (let i = 0;i < count; i++) {
      const e = new Array(m);
      for (let j = 0;j < m; j++) {
        const elm_offset = L * (j + i * m);
        const tv = prb.subarray(elm_offset, elm_offset + L);
        e[j] = (0, modular_ts_1.mod)(os2ip(tv), p);
      }
      u[i] = e;
    }
    return u;
  }
  function isogenyMap(field, map) {
    const coeff = map.map((i) => Array.from(i).reverse());
    return (x, y) => {
      const [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i)));
      const [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(field, [xd, yd], true);
      x = field.mul(xn, xd_inv);
      y = field.mul(y, field.mul(yn, yd_inv));
      return { x, y };
    };
  }
  exports2._DST_scalar = (0, utils_ts_1.utf8ToBytes)("HashToScalar-");
  function createHasher(Point, mapToCurve, defaults) {
    if (typeof mapToCurve !== "function")
      throw new Error("mapToCurve() must be defined");
    function map(num) {
      return Point.fromAffine(mapToCurve(num));
    }
    function clear(initial) {
      const P = initial.clearCofactor();
      if (P.equals(Point.ZERO))
        return Point.ZERO;
      P.assertValidity();
      return P;
    }
    return {
      defaults,
      hashToCurve(msg, options) {
        const opts = Object.assign({}, defaults, options);
        const u = hash_to_field(msg, 2, opts);
        const u0 = map(u[0]);
        const u1 = map(u[1]);
        return clear(u0.add(u1));
      },
      encodeToCurve(msg, options) {
        const optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {};
        const opts = Object.assign({}, defaults, optsDst, options);
        const u = hash_to_field(msg, 1, opts);
        const u0 = map(u[0]);
        return clear(u0);
      },
      mapToCurve(scalars) {
        if (!Array.isArray(scalars))
          throw new Error("expected array of bigints");
        for (const i of scalars)
          if (typeof i !== "bigint")
            throw new Error("expected array of bigints");
        return clear(map(scalars));
      },
      hashToScalar(msg, options) {
        const N = Point.Fn.ORDER;
        const opts = Object.assign({}, defaults, { p: N, m: 1, DST: exports2._DST_scalar }, options);
        return hash_to_field(msg, 1, opts)[0][0];
      }
    };
  }
});

// node_modules/@noble/curves/abstract/montgomery.js
var require_montgomery = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.montgomery = montgomery;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var utils_ts_1 = require_utils3();
  var modular_ts_1 = require_modular();
  var _0n = BigInt(0);
  var _1n = BigInt(1);
  var _2n = BigInt(2);
  function validateOpts(curve) {
    (0, utils_ts_1._validateObject)(curve, {
      adjustScalarBytes: "function",
      powPminus2: "function"
    });
    return Object.freeze({ ...curve });
  }
  function montgomery(curveDef) {
    const CURVE = validateOpts(curveDef);
    const { P, type, adjustScalarBytes, powPminus2, randomBytes: rand } = CURVE;
    const is25519 = type === "x25519";
    if (!is25519 && type !== "x448")
      throw new Error("invalid type");
    const randomBytes_ = rand || utils_ts_1.randomBytes;
    const montgomeryBits = is25519 ? 255 : 448;
    const fieldLen = is25519 ? 32 : 56;
    const Gu = is25519 ? BigInt(9) : BigInt(5);
    const a24 = is25519 ? BigInt(121665) : BigInt(39081);
    const minScalar = is25519 ? _2n ** BigInt(254) : _2n ** BigInt(447);
    const maxAdded = is25519 ? BigInt(8) * _2n ** BigInt(251) - _1n : BigInt(4) * _2n ** BigInt(445) - _1n;
    const maxScalar = minScalar + maxAdded + _1n;
    const modP = (n) => (0, modular_ts_1.mod)(n, P);
    const GuBytes = encodeU(Gu);
    function encodeU(u) {
      return (0, utils_ts_1.numberToBytesLE)(modP(u), fieldLen);
    }
    function decodeU(u) {
      const _u = (0, utils_ts_1.ensureBytes)("u coordinate", u, fieldLen);
      if (is25519)
        _u[31] &= 127;
      return modP((0, utils_ts_1.bytesToNumberLE)(_u));
    }
    function decodeScalar(scalar) {
      return (0, utils_ts_1.bytesToNumberLE)(adjustScalarBytes((0, utils_ts_1.ensureBytes)("scalar", scalar, fieldLen)));
    }
    function scalarMult(scalar, u) {
      const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
      if (pu === _0n)
        throw new Error("invalid private or public key received");
      return encodeU(pu);
    }
    function scalarMultBase(scalar) {
      return scalarMult(scalar, GuBytes);
    }
    function cswap(swap, x_2, x_3) {
      const dummy = modP(swap * (x_2 - x_3));
      x_2 = modP(x_2 - dummy);
      x_3 = modP(x_3 + dummy);
      return { x_2, x_3 };
    }
    function montgomeryLadder(u, scalar) {
      (0, utils_ts_1.aInRange)("u", u, _0n, P);
      (0, utils_ts_1.aInRange)("scalar", scalar, minScalar, maxScalar);
      const k = scalar;
      const x_1 = u;
      let x_2 = _1n;
      let z_2 = _0n;
      let x_3 = u;
      let z_3 = _1n;
      let swap = _0n;
      for (let t = BigInt(montgomeryBits - 1);t >= _0n; t--) {
        const k_t = k >> t & _1n;
        swap ^= k_t;
        ({ x_2, x_3 } = cswap(swap, x_2, x_3));
        ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
        swap = k_t;
        const A = x_2 + z_2;
        const AA = modP(A * A);
        const B = x_2 - z_2;
        const BB = modP(B * B);
        const E = AA - BB;
        const C = x_3 + z_3;
        const D = x_3 - z_3;
        const DA = modP(D * A);
        const CB = modP(C * B);
        const dacb = DA + CB;
        const da_cb = DA - CB;
        x_3 = modP(dacb * dacb);
        z_3 = modP(x_1 * modP(da_cb * da_cb));
        x_2 = modP(AA * BB);
        z_2 = modP(E * (AA + modP(a24 * E)));
      }
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      const z2 = powPminus2(z_2);
      return modP(x_2 * z2);
    }
    const lengths = {
      secretKey: fieldLen,
      publicKey: fieldLen,
      seed: fieldLen
    };
    const randomSecretKey = (seed = randomBytes_(fieldLen)) => {
      (0, utils_ts_1.abytes)(seed, lengths.seed);
      return seed;
    };
    function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: scalarMultBase(secretKey) };
    }
    const utils = {
      randomSecretKey,
      randomPrivateKey: randomSecretKey
    };
    return {
      keygen,
      getSharedSecret: (secretKey, publicKey) => scalarMult(secretKey, publicKey),
      getPublicKey: (secretKey) => scalarMultBase(secretKey),
      scalarMult,
      scalarMultBase,
      utils,
      GuBytes: GuBytes.slice(),
      lengths
    };
  }
});

// node_modules/@noble/curves/ed25519.js
var require_ed25519 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.hash_to_ristretto255 = exports2.hashToRistretto255 = exports2.encodeToCurve = exports2.hashToCurve = exports2.RistrettoPoint = exports2.edwardsToMontgomery = exports2.ED25519_TORSION_SUBGROUP = exports2.ristretto255_hasher = exports2.ristretto255 = exports2.ed25519_hasher = exports2.x25519 = exports2.ed25519ph = exports2.ed25519ctx = exports2.ed25519 = undefined;
  exports2.edwardsToMontgomeryPub = edwardsToMontgomeryPub;
  exports2.edwardsToMontgomeryPriv = edwardsToMontgomeryPriv;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var sha2_js_1 = require_sha2();
  var utils_js_1 = require_utils2();
  var curve_ts_1 = require_curve();
  var edwards_ts_1 = require_edwards();
  var hash_to_curve_ts_1 = require_hash_to_curve();
  var modular_ts_1 = require_modular();
  var montgomery_ts_1 = require_montgomery();
  var utils_ts_1 = require_utils3();
  var _0n = /* @__PURE__ */ BigInt(0);
  var _1n = BigInt(1);
  var _2n = BigInt(2);
  var _3n = BigInt(3);
  var _5n = BigInt(5);
  var _8n = BigInt(8);
  var ed25519_CURVE_p = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
  var ed25519_CURVE = /* @__PURE__ */ (() => ({
    p: ed25519_CURVE_p,
    n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
    h: _8n,
    a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
    d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
    Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
    Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
  }))();
  function ed25519_pow_2_252_3(x) {
    const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
    const P = ed25519_CURVE_p;
    const x2 = x * x % P;
    const b2 = x2 * x % P;
    const b4 = (0, modular_ts_1.pow2)(b2, _2n, P) * b2 % P;
    const b5 = (0, modular_ts_1.pow2)(b4, _1n, P) * x % P;
    const b10 = (0, modular_ts_1.pow2)(b5, _5n, P) * b5 % P;
    const b20 = (0, modular_ts_1.pow2)(b10, _10n, P) * b10 % P;
    const b40 = (0, modular_ts_1.pow2)(b20, _20n, P) * b20 % P;
    const b80 = (0, modular_ts_1.pow2)(b40, _40n, P) * b40 % P;
    const b160 = (0, modular_ts_1.pow2)(b80, _80n, P) * b80 % P;
    const b240 = (0, modular_ts_1.pow2)(b160, _80n, P) * b80 % P;
    const b250 = (0, modular_ts_1.pow2)(b240, _10n, P) * b10 % P;
    const pow_p_5_8 = (0, modular_ts_1.pow2)(b250, _2n, P) * x % P;
    return { pow_p_5_8, b2 };
  }
  function adjustScalarBytes(bytes) {
    bytes[0] &= 248;
    bytes[31] &= 127;
    bytes[31] |= 64;
    return bytes;
  }
  var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
  function uvRatio(u, v) {
    const P = ed25519_CURVE_p;
    const v3 = (0, modular_ts_1.mod)(v * v * v, P);
    const v7 = (0, modular_ts_1.mod)(v3 * v3 * v, P);
    const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
    let x = (0, modular_ts_1.mod)(u * v3 * pow, P);
    const vx2 = (0, modular_ts_1.mod)(v * x * x, P);
    const root1 = x;
    const root2 = (0, modular_ts_1.mod)(x * ED25519_SQRT_M1, P);
    const useRoot1 = vx2 === u;
    const useRoot2 = vx2 === (0, modular_ts_1.mod)(-u, P);
    const noRoot = vx2 === (0, modular_ts_1.mod)(-u * ED25519_SQRT_M1, P);
    if (useRoot1)
      x = root1;
    if (useRoot2 || noRoot)
      x = root2;
    if ((0, modular_ts_1.isNegativeLE)(x, P))
      x = (0, modular_ts_1.mod)(-x, P);
    return { isValid: useRoot1 || useRoot2, value: x };
  }
  var Fp = /* @__PURE__ */ (() => (0, modular_ts_1.Field)(ed25519_CURVE.p, { isLE: true }))();
  var Fn = /* @__PURE__ */ (() => (0, modular_ts_1.Field)(ed25519_CURVE.n, { isLE: true }))();
  var ed25519Defaults = /* @__PURE__ */ (() => ({
    ...ed25519_CURVE,
    Fp,
    hash: sha2_js_1.sha512,
    adjustScalarBytes,
    uvRatio
  }))();
  exports2.ed25519 = (() => (0, edwards_ts_1.twistedEdwards)(ed25519Defaults))();
  function ed25519_domain(data, ctx, phflag) {
    if (ctx.length > 255)
      throw new Error("Context is too big");
    return (0, utils_js_1.concatBytes)((0, utils_js_1.utf8ToBytes)("SigEd25519 no Ed25519 collisions"), new Uint8Array([phflag ? 1 : 0, ctx.length]), ctx, data);
  }
  exports2.ed25519ctx = (() => (0, edwards_ts_1.twistedEdwards)({
    ...ed25519Defaults,
    domain: ed25519_domain
  }))();
  exports2.ed25519ph = (() => (0, edwards_ts_1.twistedEdwards)(Object.assign({}, ed25519Defaults, {
    domain: ed25519_domain,
    prehash: sha2_js_1.sha512
  })))();
  exports2.x25519 = (() => {
    const P = Fp.ORDER;
    return (0, montgomery_ts_1.montgomery)({
      P,
      type: "x25519",
      powPminus2: (x) => {
        const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
        return (0, modular_ts_1.mod)((0, modular_ts_1.pow2)(pow_p_5_8, _3n, P) * b2, P);
      },
      adjustScalarBytes
    });
  })();
  var ELL2_C1 = /* @__PURE__ */ (() => (ed25519_CURVE_p + _3n) / _8n)();
  var ELL2_C2 = /* @__PURE__ */ (() => Fp.pow(_2n, ELL2_C1))();
  var ELL2_C3 = /* @__PURE__ */ (() => Fp.sqrt(Fp.neg(Fp.ONE)))();
  function map_to_curve_elligator2_curve25519(u) {
    const ELL2_C4 = (ed25519_CURVE_p - _5n) / _8n;
    const ELL2_J = BigInt(486662);
    let tv1 = Fp.sqr(u);
    tv1 = Fp.mul(tv1, _2n);
    let xd = Fp.add(tv1, Fp.ONE);
    let x1n = Fp.neg(ELL2_J);
    let tv2 = Fp.sqr(xd);
    let gxd = Fp.mul(tv2, xd);
    let gx1 = Fp.mul(tv1, ELL2_J);
    gx1 = Fp.mul(gx1, x1n);
    gx1 = Fp.add(gx1, tv2);
    gx1 = Fp.mul(gx1, x1n);
    let tv3 = Fp.sqr(gxd);
    tv2 = Fp.sqr(tv3);
    tv3 = Fp.mul(tv3, gxd);
    tv3 = Fp.mul(tv3, gx1);
    tv2 = Fp.mul(tv2, tv3);
    let y11 = Fp.pow(tv2, ELL2_C4);
    y11 = Fp.mul(y11, tv3);
    let y12 = Fp.mul(y11, ELL2_C3);
    tv2 = Fp.sqr(y11);
    tv2 = Fp.mul(tv2, gxd);
    let e1 = Fp.eql(tv2, gx1);
    let y1 = Fp.cmov(y12, y11, e1);
    let x2n = Fp.mul(x1n, tv1);
    let y21 = Fp.mul(y11, u);
    y21 = Fp.mul(y21, ELL2_C2);
    let y22 = Fp.mul(y21, ELL2_C3);
    let gx2 = Fp.mul(gx1, tv1);
    tv2 = Fp.sqr(y21);
    tv2 = Fp.mul(tv2, gxd);
    let e2 = Fp.eql(tv2, gx2);
    let y2 = Fp.cmov(y22, y21, e2);
    tv2 = Fp.sqr(y1);
    tv2 = Fp.mul(tv2, gxd);
    let e3 = Fp.eql(tv2, gx1);
    let xn = Fp.cmov(x2n, x1n, e3);
    let y = Fp.cmov(y2, y1, e3);
    let e4 = Fp.isOdd(y);
    y = Fp.cmov(y, Fp.neg(y), e3 !== e4);
    return { xMn: xn, xMd: xd, yMn: y, yMd: _1n };
  }
  var ELL2_C1_EDWARDS = /* @__PURE__ */ (() => (0, modular_ts_1.FpSqrtEven)(Fp, Fp.neg(BigInt(486664))))();
  function map_to_curve_elligator2_edwards25519(u) {
    const { xMn, xMd, yMn, yMd } = map_to_curve_elligator2_curve25519(u);
    let xn = Fp.mul(xMn, yMd);
    xn = Fp.mul(xn, ELL2_C1_EDWARDS);
    let xd = Fp.mul(xMd, yMn);
    let yn = Fp.sub(xMn, xMd);
    let yd = Fp.add(xMn, xMd);
    let tv1 = Fp.mul(xd, yd);
    let e = Fp.eql(tv1, Fp.ZERO);
    xn = Fp.cmov(xn, Fp.ZERO, e);
    xd = Fp.cmov(xd, Fp.ONE, e);
    yn = Fp.cmov(yn, Fp.ONE, e);
    yd = Fp.cmov(yd, Fp.ONE, e);
    const [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(Fp, [xd, yd], true);
    return { x: Fp.mul(xn, xd_inv), y: Fp.mul(yn, yd_inv) };
  }
  exports2.ed25519_hasher = (() => (0, hash_to_curve_ts_1.createHasher)(exports2.ed25519.Point, (scalars) => map_to_curve_elligator2_edwards25519(scalars[0]), {
    DST: "edwards25519_XMD:SHA-512_ELL2_RO_",
    encodeDST: "edwards25519_XMD:SHA-512_ELL2_NU_",
    p: ed25519_CURVE_p,
    m: 1,
    k: 128,
    expand: "xmd",
    hash: sha2_js_1.sha512
  }))();
  var SQRT_M1 = ED25519_SQRT_M1;
  var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
  var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
  var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
  var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
  var invertSqrt = (number) => uvRatio(_1n, number);
  var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  var bytes255ToNumberLE = (bytes) => exports2.ed25519.Point.Fp.create((0, utils_ts_1.bytesToNumberLE)(bytes) & MAX_255B);
  function calcElligatorRistrettoMap(r0) {
    const { d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod = (n) => Fp.create(n);
    const r = mod(SQRT_M1 * r0 * r0);
    const Ns = mod((r + _1n) * ONE_MINUS_D_SQ);
    let c = BigInt(-1);
    const D = mod((c - d * r) * mod(r + d));
    let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
    let s_ = mod(s * r0);
    if (!(0, modular_ts_1.isNegativeLE)(s_, P))
      s_ = mod(-s_);
    if (!Ns_D_is_sq)
      s = s_;
    if (!Ns_D_is_sq)
      c = r;
    const Nt = mod(c * (r - _1n) * D_MINUS_ONE_SQ - D);
    const s2 = s * s;
    const W0 = mod((s + s) * D);
    const W1 = mod(Nt * SQRT_AD_MINUS_ONE);
    const W2 = mod(_1n - s2);
    const W3 = mod(_1n + s2);
    return new exports2.ed25519.Point(mod(W0 * W3), mod(W2 * W1), mod(W1 * W3), mod(W0 * W2));
  }
  function ristretto255_map(bytes) {
    (0, utils_js_1.abytes)(bytes, 64);
    const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
    const R1 = calcElligatorRistrettoMap(r1);
    const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
    const R2 = calcElligatorRistrettoMap(r2);
    return new _RistrettoPoint(R1.add(R2));
  }

  class _RistrettoPoint extends edwards_ts_1.PrimeEdwardsPoint {
    constructor(ep) {
      super(ep);
    }
    static fromAffine(ap) {
      return new _RistrettoPoint(exports2.ed25519.Point.fromAffine(ap));
    }
    assertSame(other) {
      if (!(other instanceof _RistrettoPoint))
        throw new Error("RistrettoPoint expected");
    }
    init(ep) {
      return new _RistrettoPoint(ep);
    }
    static hashToCurve(hex) {
      return ristretto255_map((0, utils_ts_1.ensureBytes)("ristrettoHash", hex, 64));
    }
    static fromBytes(bytes) {
      (0, utils_js_1.abytes)(bytes, 32);
      const { a, d } = ed25519_CURVE;
      const P = ed25519_CURVE_p;
      const mod = (n) => Fp.create(n);
      const s = bytes255ToNumberLE(bytes);
      if (!(0, utils_ts_1.equalBytes)(Fp.toBytes(s), bytes) || (0, modular_ts_1.isNegativeLE)(s, P))
        throw new Error("invalid ristretto255 encoding 1");
      const s2 = mod(s * s);
      const u1 = mod(_1n + a * s2);
      const u2 = mod(_1n - a * s2);
      const u1_2 = mod(u1 * u1);
      const u2_2 = mod(u2 * u2);
      const v = mod(a * d * u1_2 - u2_2);
      const { isValid: isValid2, value: I } = invertSqrt(mod(v * u2_2));
      const Dx = mod(I * u2);
      const Dy = mod(I * Dx * v);
      let x = mod((s + s) * Dx);
      if ((0, modular_ts_1.isNegativeLE)(x, P))
        x = mod(-x);
      const y = mod(u1 * Dy);
      const t = mod(x * y);
      if (!isValid2 || (0, modular_ts_1.isNegativeLE)(t, P) || y === _0n)
        throw new Error("invalid ristretto255 encoding 2");
      return new _RistrettoPoint(new exports2.ed25519.Point(x, y, _1n, t));
    }
    static fromHex(hex) {
      return _RistrettoPoint.fromBytes((0, utils_ts_1.ensureBytes)("ristrettoHex", hex, 32));
    }
    static msm(points, scalars) {
      return (0, curve_ts_1.pippenger)(_RistrettoPoint, exports2.ed25519.Point.Fn, points, scalars);
    }
    toBytes() {
      let { X, Y, Z, T } = this.ep;
      const P = ed25519_CURVE_p;
      const mod = (n) => Fp.create(n);
      const u1 = mod(mod(Z + Y) * mod(Z - Y));
      const u2 = mod(X * Y);
      const u2sq = mod(u2 * u2);
      const { value: invsqrt } = invertSqrt(mod(u1 * u2sq));
      const D1 = mod(invsqrt * u1);
      const D2 = mod(invsqrt * u2);
      const zInv = mod(D1 * D2 * T);
      let D;
      if ((0, modular_ts_1.isNegativeLE)(T * zInv, P)) {
        let _x = mod(Y * SQRT_M1);
        let _y = mod(X * SQRT_M1);
        X = _x;
        Y = _y;
        D = mod(D1 * INVSQRT_A_MINUS_D);
      } else {
        D = D2;
      }
      if ((0, modular_ts_1.isNegativeLE)(X * zInv, P))
        Y = mod(-Y);
      let s = mod((Z - Y) * D);
      if ((0, modular_ts_1.isNegativeLE)(s, P))
        s = mod(-s);
      return Fp.toBytes(s);
    }
    equals(other) {
      this.assertSame(other);
      const { X: X1, Y: Y1 } = this.ep;
      const { X: X2, Y: Y2 } = other.ep;
      const mod = (n) => Fp.create(n);
      const one = mod(X1 * Y2) === mod(Y1 * X2);
      const two = mod(Y1 * Y2) === mod(X1 * X2);
      return one || two;
    }
    is0() {
      return this.equals(_RistrettoPoint.ZERO);
    }
  }
  _RistrettoPoint.BASE = /* @__PURE__ */ (() => new _RistrettoPoint(exports2.ed25519.Point.BASE))();
  _RistrettoPoint.ZERO = /* @__PURE__ */ (() => new _RistrettoPoint(exports2.ed25519.Point.ZERO))();
  _RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp)();
  _RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();
  exports2.ristretto255 = { Point: _RistrettoPoint };
  exports2.ristretto255_hasher = {
    hashToCurve(msg, options) {
      const DST = options?.DST || "ristretto255_XMD:SHA-512_R255MAP_RO_";
      const xmd = (0, hash_to_curve_ts_1.expand_message_xmd)(msg, DST, 64, sha2_js_1.sha512);
      return ristretto255_map(xmd);
    },
    hashToScalar(msg, options = { DST: hash_to_curve_ts_1._DST_scalar }) {
      const xmd = (0, hash_to_curve_ts_1.expand_message_xmd)(msg, options.DST, 64, sha2_js_1.sha512);
      return Fn.create((0, utils_ts_1.bytesToNumberLE)(xmd));
    }
  };
  exports2.ED25519_TORSION_SUBGROUP = [
    "0100000000000000000000000000000000000000000000000000000000000000",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "0000000000000000000000000000000000000000000000000000000000000080",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa"
  ];
  function edwardsToMontgomeryPub(edwardsPub) {
    return exports2.ed25519.utils.toMontgomery((0, utils_ts_1.ensureBytes)("pub", edwardsPub));
  }
  exports2.edwardsToMontgomery = edwardsToMontgomeryPub;
  function edwardsToMontgomeryPriv(edwardsPriv) {
    return exports2.ed25519.utils.toMontgomerySecret((0, utils_ts_1.ensureBytes)("pub", edwardsPriv));
  }
  exports2.RistrettoPoint = _RistrettoPoint;
  exports2.hashToCurve = (() => exports2.ed25519_hasher.hashToCurve)();
  exports2.encodeToCurve = (() => exports2.ed25519_hasher.encodeToCurve)();
  exports2.hashToRistretto255 = (() => exports2.ristretto255_hasher.hashToCurve)();
  exports2.hash_to_ristretto255 = (() => exports2.ristretto255_hasher.hashToCurve)();
});

// node_modules/@noble/hashes/hmac.js
var require_hmac = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.hmac = exports2.HMAC = undefined;
  var utils_ts_1 = require_utils2();

  class HMAC extends utils_ts_1.Hash {
    constructor(hash, _key) {
      super();
      this.finished = false;
      this.destroyed = false;
      (0, utils_ts_1.ahash)(hash);
      const key = (0, utils_ts_1.toBytes)(_key);
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function")
        throw new Error("Expected instance of class which extends utils.Hash");
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0;i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0;i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      (0, utils_ts_1.clean)(pad);
    }
    update(buf) {
      (0, utils_ts_1.aexists)(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      (0, utils_ts_1.aexists)(this);
      (0, utils_ts_1.abytes)(out, this.outputLen);
      this.finished = true;
      this.iHash.digestInto(out);
      this.oHash.update(out);
      this.oHash.digestInto(out);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to || (to = Object.create(Object.getPrototypeOf(this), {}));
      const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.oHash = oHash._cloneInto(to.oHash);
      to.iHash = iHash._cloneInto(to.iHash);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  }
  exports2.HMAC = HMAC;
  var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
  exports2.hmac = hmac;
  exports2.hmac.create = (hash, key) => new HMAC(hash, key);
});

// node_modules/@noble/curves/abstract/weierstrass.js
var require_weierstrass = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.DER = exports2.DERErr = undefined;
  exports2._splitEndoScalar = _splitEndoScalar;
  exports2._normFnElement = _normFnElement;
  exports2.weierstrassN = weierstrassN;
  exports2.SWUFpSqrtRatio = SWUFpSqrtRatio;
  exports2.mapToCurveSimpleSWU = mapToCurveSimpleSWU;
  exports2.ecdh = ecdh;
  exports2.ecdsa = ecdsa;
  exports2.weierstrassPoints = weierstrassPoints;
  exports2._legacyHelperEquat = _legacyHelperEquat;
  exports2.weierstrass = weierstrass;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var hmac_js_1 = require_hmac();
  var utils_1 = require_utils2();
  var utils_ts_1 = require_utils3();
  var curve_ts_1 = require_curve();
  var modular_ts_1 = require_modular();
  var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n) / den;
  function _splitEndoScalar(k, basis, n) {
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k, n);
    const c2 = divNearest(-b1 * k, n);
    let k1 = k - c1 * a1 - c2 * a2;
    let k2 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n;
    const k2neg = k2 < _0n;
    if (k1neg)
      k1 = -k1;
    if (k2neg)
      k2 = -k2;
    const MAX_NUM = (0, utils_ts_1.bitMask)(Math.ceil((0, utils_ts_1.bitLen)(n) / 2)) + _1n;
    if (k1 < _0n || k1 >= MAX_NUM || k2 < _0n || k2 >= MAX_NUM) {
      throw new Error("splitScalar (endomorphism): failed, k=" + k);
    }
    return { k1neg, k1, k2neg, k2 };
  }
  function validateSigFormat(format) {
    if (!["compact", "recovered", "der"].includes(format))
      throw new Error('Signature format must be "compact", "recovered", or "der"');
    return format;
  }
  function validateSigOpts(opts, def) {
    const optsn = {};
    for (let optName of Object.keys(def)) {
      optsn[optName] = opts[optName] === undefined ? def[optName] : opts[optName];
    }
    (0, utils_ts_1._abool2)(optsn.lowS, "lowS");
    (0, utils_ts_1._abool2)(optsn.prehash, "prehash");
    if (optsn.format !== undefined)
      validateSigFormat(optsn.format);
    return optsn;
  }

  class DERErr extends Error {
    constructor(m = "") {
      super(m);
    }
  }
  exports2.DERErr = DERErr;
  exports2.DER = {
    Err: DERErr,
    _tlv: {
      encode: (tag, data) => {
        const { Err: E } = exports2.DER;
        if (tag < 0 || tag > 256)
          throw new E("tlv.encode: wrong tag");
        if (data.length & 1)
          throw new E("tlv.encode: unpadded data");
        const dataLen = data.length / 2;
        const len = (0, utils_ts_1.numberToHexUnpadded)(dataLen);
        if (len.length / 2 & 128)
          throw new E("tlv.encode: long form length too big");
        const lenLen = dataLen > 127 ? (0, utils_ts_1.numberToHexUnpadded)(len.length / 2 | 128) : "";
        const t = (0, utils_ts_1.numberToHexUnpadded)(tag);
        return t + lenLen + len + data;
      },
      decode(tag, data) {
        const { Err: E } = exports2.DER;
        let pos = 0;
        if (tag < 0 || tag > 256)
          throw new E("tlv.encode: wrong tag");
        if (data.length < 2 || data[pos++] !== tag)
          throw new E("tlv.decode: wrong tlv");
        const first = data[pos++];
        const isLong = !!(first & 128);
        let length = 0;
        if (!isLong)
          length = first;
        else {
          const lenLen = first & 127;
          if (!lenLen)
            throw new E("tlv.decode(long): indefinite length not supported");
          if (lenLen > 4)
            throw new E("tlv.decode(long): byte length is too big");
          const lengthBytes = data.subarray(pos, pos + lenLen);
          if (lengthBytes.length !== lenLen)
            throw new E("tlv.decode: length bytes not complete");
          if (lengthBytes[0] === 0)
            throw new E("tlv.decode(long): zero leftmost byte");
          for (const b of lengthBytes)
            length = length << 8 | b;
          pos += lenLen;
          if (length < 128)
            throw new E("tlv.decode(long): not minimal encoding");
        }
        const v = data.subarray(pos, pos + length);
        if (v.length !== length)
          throw new E("tlv.decode: wrong value length");
        return { v, l: data.subarray(pos + length) };
      }
    },
    _int: {
      encode(num) {
        const { Err: E } = exports2.DER;
        if (num < _0n)
          throw new E("integer: negative integers are not allowed");
        let hex = (0, utils_ts_1.numberToHexUnpadded)(num);
        if (Number.parseInt(hex[0], 16) & 8)
          hex = "00" + hex;
        if (hex.length & 1)
          throw new E("unexpected DER parsing assertion: unpadded hex");
        return hex;
      },
      decode(data) {
        const { Err: E } = exports2.DER;
        if (data[0] & 128)
          throw new E("invalid signature integer: negative");
        if (data[0] === 0 && !(data[1] & 128))
          throw new E("invalid signature integer: unnecessary leading zero");
        return (0, utils_ts_1.bytesToNumberBE)(data);
      }
    },
    toSig(hex) {
      const { Err: E, _int: int, _tlv: tlv } = exports2.DER;
      const data = (0, utils_ts_1.ensureBytes)("signature", hex);
      const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
      if (seqLeftBytes.length)
        throw new E("invalid signature: left bytes after parsing");
      const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
      const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
      if (sLeftBytes.length)
        throw new E("invalid signature: left bytes after parsing");
      return { r: int.decode(rBytes), s: int.decode(sBytes) };
    },
    hexFromSig(sig) {
      const { _tlv: tlv, _int: int } = exports2.DER;
      const rs = tlv.encode(2, int.encode(sig.r));
      const ss = tlv.encode(2, int.encode(sig.s));
      const seq = rs + ss;
      return tlv.encode(48, seq);
    }
  };
  var _0n = BigInt(0);
  var _1n = BigInt(1);
  var _2n = BigInt(2);
  var _3n = BigInt(3);
  var _4n = BigInt(4);
  function _normFnElement(Fn, key) {
    const { BYTES: expected } = Fn;
    let num;
    if (typeof key === "bigint") {
      num = key;
    } else {
      let bytes = (0, utils_ts_1.ensureBytes)("private key", key);
      try {
        num = Fn.fromBytes(bytes);
      } catch (error) {
        throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
      }
    }
    if (!Fn.isValidNot0(num))
      throw new Error("invalid private key: out of range [1..N-1]");
    return num;
  }
  function weierstrassN(params, extraOpts = {}) {
    const validated = (0, curve_ts_1._createCurveFields)("weierstrass", params, extraOpts);
    const { Fp, Fn } = validated;
    let CURVE = validated.CURVE;
    const { h: cofactor, n: CURVE_ORDER } = CURVE;
    (0, utils_ts_1._validateObject)(extraOpts, {}, {
      allowInfinityPoint: "boolean",
      clearCofactor: "function",
      isTorsionFree: "function",
      fromBytes: "function",
      toBytes: "function",
      endo: "object",
      wrapPrivateKey: "boolean"
    });
    const { endo } = extraOpts;
    if (endo) {
      if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
        throw new Error('invalid endo: expected "beta": bigint and "basises": array');
      }
    }
    const lengths = getWLengths(Fp, Fn);
    function assertCompressionIsSupported() {
      if (!Fp.isOdd)
        throw new Error("compression is not supported: Field does not have .isOdd()");
    }
    function pointToBytes(_c, point, isCompressed) {
      const { x, y } = point.toAffine();
      const bx = Fp.toBytes(x);
      (0, utils_ts_1._abool2)(isCompressed, "isCompressed");
      if (isCompressed) {
        assertCompressionIsSupported();
        const hasEvenY = !Fp.isOdd(y);
        return (0, utils_ts_1.concatBytes)(pprefix(hasEvenY), bx);
      } else {
        return (0, utils_ts_1.concatBytes)(Uint8Array.of(4), bx, Fp.toBytes(y));
      }
    }
    function pointFromBytes(bytes) {
      (0, utils_ts_1._abytes2)(bytes, undefined, "Point");
      const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
      const length = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (length === comp && (head === 2 || head === 3)) {
        const x = Fp.fromBytes(tail);
        if (!Fp.isValid(x))
          throw new Error("bad point: is not on curve, wrong x");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("bad point: is not on curve, sqrt error" + err);
        }
        assertCompressionIsSupported();
        const isYOdd = Fp.isOdd(y);
        const isHeadOdd = (head & 1) === 1;
        if (isHeadOdd !== isYOdd)
          y = Fp.neg(y);
        return { x, y };
      } else if (length === uncomp && head === 4) {
        const L = Fp.BYTES;
        const x = Fp.fromBytes(tail.subarray(0, L));
        const y = Fp.fromBytes(tail.subarray(L, L * 2));
        if (!isValidXY(x, y))
          throw new Error("bad point: is not on curve");
        return { x, y };
      } else {
        throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
      }
    }
    const encodePoint = extraOpts.toBytes || pointToBytes;
    const decodePoint = extraOpts.fromBytes || pointFromBytes;
    function weierstrassEquation(x) {
      const x2 = Fp.sqr(x);
      const x3 = Fp.mul(x2, x);
      return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
    }
    function isValidXY(x, y) {
      const left = Fp.sqr(y);
      const right = weierstrassEquation(x);
      return Fp.eql(left, right);
    }
    if (!isValidXY(CURVE.Gx, CURVE.Gy))
      throw new Error("bad curve params: generator point");
    const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n), _4n);
    const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
    if (Fp.is0(Fp.add(_4a3, _27b2)))
      throw new Error("bad curve params: a or b");
    function acoord(title, n, banZero = false) {
      if (!Fp.isValid(n) || banZero && Fp.is0(n))
        throw new Error(`bad point coordinate ${title}`);
      return n;
    }
    function aprjpoint(other) {
      if (!(other instanceof Point))
        throw new Error("ProjectivePoint expected");
    }
    function splitEndoScalarN(k) {
      if (!endo || !endo.basises)
        throw new Error("no endo");
      return _splitEndoScalar(k, endo.basises, Fn.ORDER);
    }
    const toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    });
    const assertValidMemo = (0, utils_ts_1.memoized)((p) => {
      if (p.is0()) {
        if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
          return;
        throw new Error("bad point: ZERO");
      }
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      return true;
    });
    function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
      k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
      k1p = (0, curve_ts_1.negateCt)(k1neg, k1p);
      k2p = (0, curve_ts_1.negateCt)(k2neg, k2p);
      return k1p.add(k2p);
    }

    class Point {
      constructor(X, Y, Z) {
        this.X = acoord("x", X);
        this.Y = acoord("y", Y, true);
        this.Z = acoord("z", Z);
        Object.freeze(this);
      }
      static CURVE() {
        return CURVE;
      }
      static fromAffine(p) {
        const { x, y } = p || {};
        if (!p || !Fp.isValid(x) || !Fp.isValid(y))
          throw new Error("invalid affine point");
        if (p instanceof Point)
          throw new Error("projective point not allowed");
        if (Fp.is0(x) && Fp.is0(y))
          return Point.ZERO;
        return new Point(x, y, Fp.ONE);
      }
      static fromBytes(bytes) {
        const P = Point.fromAffine(decodePoint((0, utils_ts_1._abytes2)(bytes, undefined, "point")));
        P.assertValidity();
        return P;
      }
      static fromHex(hex) {
        return Point.fromBytes((0, utils_ts_1.ensureBytes)("pointHex", hex));
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      precompute(windowSize = 8, isLazy = true) {
        wnaf.createCache(this, windowSize);
        if (!isLazy)
          this.multiply(_3n);
        return this;
      }
      assertValidity() {
        assertValidMemo(this);
      }
      hasEvenY() {
        const { y } = this.toAffine();
        if (!Fp.isOdd)
          throw new Error("Field doesn't support isOdd");
        return !Fp.isOdd(y);
      }
      equals(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
        const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
        return U1 && U2;
      }
      negate() {
        return new Point(this.X, Fp.neg(this.Y), this.Z);
      }
      double() {
        const { a, b } = CURVE;
        const b3 = Fp.mul(b, _3n);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
        let t0 = Fp.mul(X1, X1);
        let t1 = Fp.mul(Y1, Y1);
        let t2 = Fp.mul(Z1, Z1);
        let t3 = Fp.mul(X1, Y1);
        t3 = Fp.add(t3, t3);
        Z3 = Fp.mul(X1, Z1);
        Z3 = Fp.add(Z3, Z3);
        X3 = Fp.mul(a, Z3);
        Y3 = Fp.mul(b3, t2);
        Y3 = Fp.add(X3, Y3);
        X3 = Fp.sub(t1, Y3);
        Y3 = Fp.add(t1, Y3);
        Y3 = Fp.mul(X3, Y3);
        X3 = Fp.mul(t3, X3);
        Z3 = Fp.mul(b3, Z3);
        t2 = Fp.mul(a, t2);
        t3 = Fp.sub(t0, t2);
        t3 = Fp.mul(a, t3);
        t3 = Fp.add(t3, Z3);
        Z3 = Fp.add(t0, t0);
        t0 = Fp.add(Z3, t0);
        t0 = Fp.add(t0, t2);
        t0 = Fp.mul(t0, t3);
        Y3 = Fp.add(Y3, t0);
        t2 = Fp.mul(Y1, Z1);
        t2 = Fp.add(t2, t2);
        t0 = Fp.mul(t2, t3);
        X3 = Fp.sub(X3, t0);
        Z3 = Fp.mul(t2, t1);
        Z3 = Fp.add(Z3, Z3);
        Z3 = Fp.add(Z3, Z3);
        return new Point(X3, Y3, Z3);
      }
      add(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
        const a = CURVE.a;
        const b3 = Fp.mul(CURVE.b, _3n);
        let t0 = Fp.mul(X1, X2);
        let t1 = Fp.mul(Y1, Y2);
        let t2 = Fp.mul(Z1, Z2);
        let t3 = Fp.add(X1, Y1);
        let t4 = Fp.add(X2, Y2);
        t3 = Fp.mul(t3, t4);
        t4 = Fp.add(t0, t1);
        t3 = Fp.sub(t3, t4);
        t4 = Fp.add(X1, Z1);
        let t5 = Fp.add(X2, Z2);
        t4 = Fp.mul(t4, t5);
        t5 = Fp.add(t0, t2);
        t4 = Fp.sub(t4, t5);
        t5 = Fp.add(Y1, Z1);
        X3 = Fp.add(Y2, Z2);
        t5 = Fp.mul(t5, X3);
        X3 = Fp.add(t1, t2);
        t5 = Fp.sub(t5, X3);
        Z3 = Fp.mul(a, t4);
        X3 = Fp.mul(b3, t2);
        Z3 = Fp.add(X3, Z3);
        X3 = Fp.sub(t1, Z3);
        Z3 = Fp.add(t1, Z3);
        Y3 = Fp.mul(X3, Z3);
        t1 = Fp.add(t0, t0);
        t1 = Fp.add(t1, t0);
        t2 = Fp.mul(a, t2);
        t4 = Fp.mul(b3, t4);
        t1 = Fp.add(t1, t2);
        t2 = Fp.sub(t0, t2);
        t2 = Fp.mul(a, t2);
        t4 = Fp.add(t4, t2);
        t0 = Fp.mul(t1, t4);
        Y3 = Fp.add(Y3, t0);
        t0 = Fp.mul(t5, t4);
        X3 = Fp.mul(t3, X3);
        X3 = Fp.sub(X3, t0);
        t0 = Fp.mul(t3, t1);
        Z3 = Fp.mul(t5, Z3);
        Z3 = Fp.add(Z3, t0);
        return new Point(X3, Y3, Z3);
      }
      subtract(other) {
        return this.add(other.negate());
      }
      is0() {
        return this.equals(Point.ZERO);
      }
      multiply(scalar) {
        const { endo: endo2 } = extraOpts;
        if (!Fn.isValidNot0(scalar))
          throw new Error("invalid scalar: out of range");
        let point, fake;
        const mul = (n) => wnaf.cached(this, n, (p) => (0, curve_ts_1.normalizeZ)(Point, p));
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
          const { p: k1p, f: k1f } = mul(k1);
          const { p: k2p, f: k2f } = mul(k2);
          fake = k1f.add(k2f);
          point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
        } else {
          const { p, f } = mul(scalar);
          point = p;
          fake = f;
        }
        return (0, curve_ts_1.normalizeZ)(Point, [point, fake])[0];
      }
      multiplyUnsafe(sc) {
        const { endo: endo2 } = extraOpts;
        const p = this;
        if (!Fn.isValid(sc))
          throw new Error("invalid scalar: out of range");
        if (sc === _0n || p.is0())
          return Point.ZERO;
        if (sc === _1n)
          return p;
        if (wnaf.hasCache(this))
          return this.multiply(sc);
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
          const { p1, p2 } = (0, curve_ts_1.mulEndoUnsafe)(Point, p, k1, k2);
          return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
        } else {
          return wnaf.unsafe(p, sc);
        }
      }
      multiplyAndAddUnsafe(Q, a, b) {
        const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
        return sum.is0() ? undefined : sum;
      }
      toAffine(invertedZ) {
        return toAffineMemo(this, invertedZ);
      }
      isTorsionFree() {
        const { isTorsionFree } = extraOpts;
        if (cofactor === _1n)
          return true;
        if (isTorsionFree)
          return isTorsionFree(Point, this);
        return wnaf.unsafe(this, CURVE_ORDER).is0();
      }
      clearCofactor() {
        const { clearCofactor } = extraOpts;
        if (cofactor === _1n)
          return this;
        if (clearCofactor)
          return clearCofactor(Point, this);
        return this.multiplyUnsafe(cofactor);
      }
      isSmallOrder() {
        return this.multiplyUnsafe(cofactor).is0();
      }
      toBytes(isCompressed = true) {
        (0, utils_ts_1._abool2)(isCompressed, "isCompressed");
        this.assertValidity();
        return encodePoint(Point, this, isCompressed);
      }
      toHex(isCompressed = true) {
        return (0, utils_ts_1.bytesToHex)(this.toBytes(isCompressed));
      }
      toString() {
        return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
      }
      get px() {
        return this.X;
      }
      get py() {
        return this.X;
      }
      get pz() {
        return this.Z;
      }
      toRawBytes(isCompressed = true) {
        return this.toBytes(isCompressed);
      }
      _setWindowSize(windowSize) {
        this.precompute(windowSize);
      }
      static normalizeZ(points) {
        return (0, curve_ts_1.normalizeZ)(Point, points);
      }
      static msm(points, scalars) {
        return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
      }
      static fromPrivateKey(privateKey) {
        return Point.BASE.multiply(_normFnElement(Fn, privateKey));
      }
    }
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    Point.Fp = Fp;
    Point.Fn = Fn;
    const bits = Fn.BITS;
    const wnaf = new curve_ts_1.wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
    Point.BASE.precompute(8);
    return Point;
  }
  function pprefix(hasEvenY) {
    return Uint8Array.of(hasEvenY ? 2 : 3);
  }
  function SWUFpSqrtRatio(Fp, Z) {
    const q = Fp.ORDER;
    let l = _0n;
    for (let o = q - _1n;o % _2n === _0n; o /= _2n)
      l += _1n;
    const c1 = l;
    const _2n_pow_c1_1 = _2n << c1 - _1n - _1n;
    const _2n_pow_c1 = _2n_pow_c1_1 * _2n;
    const c2 = (q - _1n) / _2n_pow_c1;
    const c3 = (c2 - _1n) / _2n;
    const c4 = _2n_pow_c1 - _1n;
    const c5 = _2n_pow_c1_1;
    const c6 = Fp.pow(Z, c2);
    const c7 = Fp.pow(Z, (c2 + _1n) / _2n);
    let sqrtRatio = (u, v) => {
      let tv1 = c6;
      let tv2 = Fp.pow(v, c4);
      let tv3 = Fp.sqr(tv2);
      tv3 = Fp.mul(tv3, v);
      let tv5 = Fp.mul(u, tv3);
      tv5 = Fp.pow(tv5, c3);
      tv5 = Fp.mul(tv5, tv2);
      tv2 = Fp.mul(tv5, v);
      tv3 = Fp.mul(tv5, u);
      let tv4 = Fp.mul(tv3, tv2);
      tv5 = Fp.pow(tv4, c5);
      let isQR = Fp.eql(tv5, Fp.ONE);
      tv2 = Fp.mul(tv3, c7);
      tv5 = Fp.mul(tv4, tv1);
      tv3 = Fp.cmov(tv2, tv3, isQR);
      tv4 = Fp.cmov(tv5, tv4, isQR);
      for (let i = c1;i > _1n; i--) {
        let tv52 = i - _2n;
        tv52 = _2n << tv52 - _1n;
        let tvv5 = Fp.pow(tv4, tv52);
        const e1 = Fp.eql(tvv5, Fp.ONE);
        tv2 = Fp.mul(tv3, tv1);
        tv1 = Fp.mul(tv1, tv1);
        tvv5 = Fp.mul(tv4, tv1);
        tv3 = Fp.cmov(tv2, tv3, e1);
        tv4 = Fp.cmov(tvv5, tv4, e1);
      }
      return { isValid: isQR, value: tv3 };
    };
    if (Fp.ORDER % _4n === _3n) {
      const c12 = (Fp.ORDER - _3n) / _4n;
      const c22 = Fp.sqrt(Fp.neg(Z));
      sqrtRatio = (u, v) => {
        let tv1 = Fp.sqr(v);
        const tv2 = Fp.mul(u, v);
        tv1 = Fp.mul(tv1, tv2);
        let y1 = Fp.pow(tv1, c12);
        y1 = Fp.mul(y1, tv2);
        const y2 = Fp.mul(y1, c22);
        const tv3 = Fp.mul(Fp.sqr(y1), v);
        const isQR = Fp.eql(tv3, u);
        let y = Fp.cmov(y2, y1, isQR);
        return { isValid: isQR, value: y };
      };
    }
    return sqrtRatio;
  }
  function mapToCurveSimpleSWU(Fp, opts) {
    (0, modular_ts_1.validateField)(Fp);
    const { A, B, Z } = opts;
    if (!Fp.isValid(A) || !Fp.isValid(B) || !Fp.isValid(Z))
      throw new Error("mapToCurveSimpleSWU: invalid opts");
    const sqrtRatio = SWUFpSqrtRatio(Fp, Z);
    if (!Fp.isOdd)
      throw new Error("Field does not have .isOdd()");
    return (u) => {
      let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
      tv1 = Fp.sqr(u);
      tv1 = Fp.mul(tv1, Z);
      tv2 = Fp.sqr(tv1);
      tv2 = Fp.add(tv2, tv1);
      tv3 = Fp.add(tv2, Fp.ONE);
      tv3 = Fp.mul(tv3, B);
      tv4 = Fp.cmov(Z, Fp.neg(tv2), !Fp.eql(tv2, Fp.ZERO));
      tv4 = Fp.mul(tv4, A);
      tv2 = Fp.sqr(tv3);
      tv6 = Fp.sqr(tv4);
      tv5 = Fp.mul(tv6, A);
      tv2 = Fp.add(tv2, tv5);
      tv2 = Fp.mul(tv2, tv3);
      tv6 = Fp.mul(tv6, tv4);
      tv5 = Fp.mul(tv6, B);
      tv2 = Fp.add(tv2, tv5);
      x = Fp.mul(tv1, tv3);
      const { isValid: isValid2, value } = sqrtRatio(tv2, tv6);
      y = Fp.mul(tv1, u);
      y = Fp.mul(y, value);
      x = Fp.cmov(x, tv3, isValid2);
      y = Fp.cmov(y, value, isValid2);
      const e1 = Fp.isOdd(u) === Fp.isOdd(y);
      y = Fp.cmov(Fp.neg(y), y, e1);
      const tv4_inv = (0, modular_ts_1.FpInvertBatch)(Fp, [tv4], true)[0];
      x = Fp.mul(x, tv4_inv);
      return { x, y };
    };
  }
  function getWLengths(Fp, Fn) {
    return {
      secretKey: Fn.BYTES,
      publicKey: 1 + Fp.BYTES,
      publicKeyUncompressed: 1 + 2 * Fp.BYTES,
      publicKeyHasPrefix: true,
      signature: 2 * Fn.BYTES
    };
  }
  function ecdh(Point, ecdhOpts = {}) {
    const { Fn } = Point;
    const randomBytes_ = ecdhOpts.randomBytes || utils_ts_1.randomBytes;
    const lengths = Object.assign(getWLengths(Point.Fp, Fn), { seed: (0, modular_ts_1.getMinHashLength)(Fn.ORDER) });
    function isValidSecretKey(secretKey) {
      try {
        return !!_normFnElement(Fn, secretKey);
      } catch (error) {
        return false;
      }
    }
    function isValidPublicKey(publicKey, isCompressed) {
      const { publicKey: comp, publicKeyUncompressed } = lengths;
      try {
        const l = publicKey.length;
        if (isCompressed === true && l !== comp)
          return false;
        if (isCompressed === false && l !== publicKeyUncompressed)
          return false;
        return !!Point.fromBytes(publicKey);
      } catch (error) {
        return false;
      }
    }
    function randomSecretKey(seed = randomBytes_(lengths.seed)) {
      return (0, modular_ts_1.mapHashToField)((0, utils_ts_1._abytes2)(seed, lengths.seed, "seed"), Fn.ORDER);
    }
    function getPublicKey(secretKey, isCompressed = true) {
      return Point.BASE.multiply(_normFnElement(Fn, secretKey)).toBytes(isCompressed);
    }
    function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey(secretKey) };
    }
    function isProbPub(item) {
      if (typeof item === "bigint")
        return false;
      if (item instanceof Point)
        return true;
      const { secretKey, publicKey, publicKeyUncompressed } = lengths;
      if (Fn.allowedLengths || secretKey === publicKey)
        return;
      const l = (0, utils_ts_1.ensureBytes)("key", item).length;
      return l === publicKey || l === publicKeyUncompressed;
    }
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
      if (isProbPub(secretKeyA) === true)
        throw new Error("first arg must be private key");
      if (isProbPub(publicKeyB) === false)
        throw new Error("second arg must be public key");
      const s = _normFnElement(Fn, secretKeyA);
      const b = Point.fromHex(publicKeyB);
      return b.multiply(s).toBytes(isCompressed);
    }
    const utils = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey,
      isValidPrivateKey: isValidSecretKey,
      randomPrivateKey: randomSecretKey,
      normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
      precompute(windowSize = 8, point = Point.BASE) {
        return point.precompute(windowSize, false);
      }
    };
    return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
  }
  function ecdsa(Point, hash, ecdsaOpts = {}) {
    (0, utils_1.ahash)(hash);
    (0, utils_ts_1._validateObject)(ecdsaOpts, {}, {
      hmac: "function",
      lowS: "boolean",
      randomBytes: "function",
      bits2int: "function",
      bits2int_modN: "function"
    });
    const randomBytes = ecdsaOpts.randomBytes || utils_ts_1.randomBytes;
    const hmac = ecdsaOpts.hmac || ((key, ...msgs) => (0, hmac_js_1.hmac)(hash, key, (0, utils_ts_1.concatBytes)(...msgs)));
    const { Fp, Fn } = Point;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
    const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
    const defaultSigOpts = {
      prehash: false,
      lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : false,
      format: undefined,
      extraEntropy: false
    };
    const defaultSigOpts_format = "compact";
    function isBiggerThanHalfOrder(number) {
      const HALF = CURVE_ORDER >> _1n;
      return number > HALF;
    }
    function validateRS(title, num) {
      if (!Fn.isValidNot0(num))
        throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
      return num;
    }
    function validateSigLength(bytes, format) {
      validateSigFormat(format);
      const size = lengths.signature;
      const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : undefined;
      return (0, utils_ts_1._abytes2)(bytes, sizer, `${format} signature`);
    }

    class Signature {
      constructor(r, s, recovery) {
        this.r = validateRS("r", r);
        this.s = validateRS("s", s);
        if (recovery != null)
          this.recovery = recovery;
        Object.freeze(this);
      }
      static fromBytes(bytes, format = defaultSigOpts_format) {
        validateSigLength(bytes, format);
        let recid;
        if (format === "der") {
          const { r: r2, s: s2 } = exports2.DER.toSig((0, utils_ts_1._abytes2)(bytes));
          return new Signature(r2, s2);
        }
        if (format === "recovered") {
          recid = bytes[0];
          format = "compact";
          bytes = bytes.subarray(1);
        }
        const L = Fn.BYTES;
        const r = bytes.subarray(0, L);
        const s = bytes.subarray(L, L * 2);
        return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
      }
      static fromHex(hex, format) {
        return this.fromBytes((0, utils_ts_1.hexToBytes)(hex), format);
      }
      addRecoveryBit(recovery) {
        return new Signature(this.r, this.s, recovery);
      }
      recoverPublicKey(messageHash) {
        const FIELD_ORDER = Fp.ORDER;
        const { r, s, recovery: rec } = this;
        if (rec == null || ![0, 1, 2, 3].includes(rec))
          throw new Error("recovery id invalid");
        const hasCofactor = CURVE_ORDER * _2n < FIELD_ORDER;
        if (hasCofactor && rec > 1)
          throw new Error("recovery id is ambiguous for h>1 curve");
        const radj = rec === 2 || rec === 3 ? r + CURVE_ORDER : r;
        if (!Fp.isValid(radj))
          throw new Error("recovery id 2 or 3 invalid");
        const x = Fp.toBytes(radj);
        const R = Point.fromBytes((0, utils_ts_1.concatBytes)(pprefix((rec & 1) === 0), x));
        const ir = Fn.inv(radj);
        const h = bits2int_modN((0, utils_ts_1.ensureBytes)("msgHash", messageHash));
        const u1 = Fn.create(-h * ir);
        const u2 = Fn.create(s * ir);
        const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
        if (Q.is0())
          throw new Error("point at infinify");
        Q.assertValidity();
        return Q;
      }
      hasHighS() {
        return isBiggerThanHalfOrder(this.s);
      }
      toBytes(format = defaultSigOpts_format) {
        validateSigFormat(format);
        if (format === "der")
          return (0, utils_ts_1.hexToBytes)(exports2.DER.hexFromSig(this));
        const r = Fn.toBytes(this.r);
        const s = Fn.toBytes(this.s);
        if (format === "recovered") {
          if (this.recovery == null)
            throw new Error("recovery bit must be present");
          return (0, utils_ts_1.concatBytes)(Uint8Array.of(this.recovery), r, s);
        }
        return (0, utils_ts_1.concatBytes)(r, s);
      }
      toHex(format) {
        return (0, utils_ts_1.bytesToHex)(this.toBytes(format));
      }
      assertValidity() {}
      static fromCompact(hex) {
        return Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", hex), "compact");
      }
      static fromDER(hex) {
        return Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", hex), "der");
      }
      normalizeS() {
        return this.hasHighS() ? new Signature(this.r, Fn.neg(this.s), this.recovery) : this;
      }
      toDERRawBytes() {
        return this.toBytes("der");
      }
      toDERHex() {
        return (0, utils_ts_1.bytesToHex)(this.toBytes("der"));
      }
      toCompactRawBytes() {
        return this.toBytes("compact");
      }
      toCompactHex() {
        return (0, utils_ts_1.bytesToHex)(this.toBytes("compact"));
      }
    }
    const bits2int = ecdsaOpts.bits2int || function bits2int_def(bytes) {
      if (bytes.length > 8192)
        throw new Error("input is too large");
      const num = (0, utils_ts_1.bytesToNumberBE)(bytes);
      const delta = bytes.length * 8 - fnBits;
      return delta > 0 ? num >> BigInt(delta) : num;
    };
    const bits2int_modN = ecdsaOpts.bits2int_modN || function bits2int_modN_def(bytes) {
      return Fn.create(bits2int(bytes));
    };
    const ORDER_MASK = (0, utils_ts_1.bitMask)(fnBits);
    function int2octets(num) {
      (0, utils_ts_1.aInRange)("num < 2^" + fnBits, num, _0n, ORDER_MASK);
      return Fn.toBytes(num);
    }
    function validateMsgAndHash(message, prehash) {
      (0, utils_ts_1._abytes2)(message, undefined, "message");
      return prehash ? (0, utils_ts_1._abytes2)(hash(message), undefined, "prehashed message") : message;
    }
    function prepSig(message, privateKey, opts) {
      if (["recovered", "canonical"].some((k) => (k in opts)))
        throw new Error("sign() legacy options not supported");
      const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
      message = validateMsgAndHash(message, prehash);
      const h1int = bits2int_modN(message);
      const d = _normFnElement(Fn, privateKey);
      const seedArgs = [int2octets(d), int2octets(h1int)];
      if (extraEntropy != null && extraEntropy !== false) {
        const e = extraEntropy === true ? randomBytes(lengths.secretKey) : extraEntropy;
        seedArgs.push((0, utils_ts_1.ensureBytes)("extraEntropy", e));
      }
      const seed = (0, utils_ts_1.concatBytes)(...seedArgs);
      const m = h1int;
      function k2sig(kBytes) {
        const k = bits2int(kBytes);
        if (!Fn.isValidNot0(k))
          return;
        const ik = Fn.inv(k);
        const q = Point.BASE.multiply(k).toAffine();
        const r = Fn.create(q.x);
        if (r === _0n)
          return;
        const s = Fn.create(ik * Fn.create(m + r * d));
        if (s === _0n)
          return;
        let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n);
        let normS = s;
        if (lowS && isBiggerThanHalfOrder(s)) {
          normS = Fn.neg(s);
          recovery ^= 1;
        }
        return new Signature(r, normS, recovery);
      }
      return { seed, k2sig };
    }
    function sign(message, secretKey, opts = {}) {
      message = (0, utils_ts_1.ensureBytes)("message", message);
      const { seed, k2sig } = prepSig(message, secretKey, opts);
      const drbg = (0, utils_ts_1.createHmacDrbg)(hash.outputLen, Fn.BYTES, hmac);
      const sig = drbg(seed, k2sig);
      return sig;
    }
    function tryParsingSig(sg) {
      let sig = undefined;
      const isHex = typeof sg === "string" || (0, utils_ts_1.isBytes)(sg);
      const isObj = !isHex && sg !== null && typeof sg === "object" && typeof sg.r === "bigint" && typeof sg.s === "bigint";
      if (!isHex && !isObj)
        throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
      if (isObj) {
        sig = new Signature(sg.r, sg.s);
      } else if (isHex) {
        try {
          sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", sg), "der");
        } catch (derError) {
          if (!(derError instanceof exports2.DER.Err))
            throw derError;
        }
        if (!sig) {
          try {
            sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", sg), "compact");
          } catch (error) {
            return false;
          }
        }
      }
      if (!sig)
        return false;
      return sig;
    }
    function verify(signature, message, publicKey, opts = {}) {
      const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
      publicKey = (0, utils_ts_1.ensureBytes)("publicKey", publicKey);
      message = validateMsgAndHash((0, utils_ts_1.ensureBytes)("message", message), prehash);
      if ("strict" in opts)
        throw new Error("options.strict was renamed to lowS");
      const sig = format === undefined ? tryParsingSig(signature) : Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", signature), format);
      if (sig === false)
        return false;
      try {
        const P = Point.fromBytes(publicKey);
        if (lowS && sig.hasHighS())
          return false;
        const { r, s } = sig;
        const h = bits2int_modN(message);
        const is = Fn.inv(s);
        const u1 = Fn.create(h * is);
        const u2 = Fn.create(r * is);
        const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
        if (R.is0())
          return false;
        const v = Fn.create(R.x);
        return v === r;
      } catch (e) {
        return false;
      }
    }
    function recoverPublicKey(signature, message, opts = {}) {
      const { prehash } = validateSigOpts(opts, defaultSigOpts);
      message = validateMsgAndHash(message, prehash);
      return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
    }
    return Object.freeze({
      keygen,
      getPublicKey,
      getSharedSecret,
      utils,
      lengths,
      Point,
      sign,
      verify,
      recoverPublicKey,
      Signature,
      hash
    });
  }
  function weierstrassPoints(c) {
    const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
    const Point = weierstrassN(CURVE, curveOpts);
    return _weierstrass_new_output_to_legacy(c, Point);
  }
  function _weierstrass_legacy_opts_to_new(c) {
    const CURVE = {
      a: c.a,
      b: c.b,
      p: c.Fp.ORDER,
      n: c.n,
      h: c.h,
      Gx: c.Gx,
      Gy: c.Gy
    };
    const Fp = c.Fp;
    let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : undefined;
    const Fn = (0, modular_ts_1.Field)(CURVE.n, {
      BITS: c.nBitLength,
      allowedLengths,
      modFromBytes: c.wrapPrivateKey
    });
    const curveOpts = {
      Fp,
      Fn,
      allowInfinityPoint: c.allowInfinityPoint,
      endo: c.endo,
      isTorsionFree: c.isTorsionFree,
      clearCofactor: c.clearCofactor,
      fromBytes: c.fromBytes,
      toBytes: c.toBytes
    };
    return { CURVE, curveOpts };
  }
  function _ecdsa_legacy_opts_to_new(c) {
    const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
    const ecdsaOpts = {
      hmac: c.hmac,
      randomBytes: c.randomBytes,
      lowS: c.lowS,
      bits2int: c.bits2int,
      bits2int_modN: c.bits2int_modN
    };
    return { CURVE, curveOpts, hash: c.hash, ecdsaOpts };
  }
  function _legacyHelperEquat(Fp, a, b) {
    function weierstrassEquation(x) {
      const x2 = Fp.sqr(x);
      const x3 = Fp.mul(x2, x);
      return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
    }
    return weierstrassEquation;
  }
  function _weierstrass_new_output_to_legacy(c, Point) {
    const { Fp, Fn } = Point;
    function isWithinCurveOrder(num) {
      return (0, utils_ts_1.inRange)(num, _1n, Fn.ORDER);
    }
    const weierstrassEquation = _legacyHelperEquat(Fp, c.a, c.b);
    return Object.assign({}, {
      CURVE: c,
      Point,
      ProjectivePoint: Point,
      normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
      weierstrassEquation,
      isWithinCurveOrder
    });
  }
  function _ecdsa_new_output_to_legacy(c, _ecdsa) {
    const Point = _ecdsa.Point;
    return Object.assign({}, _ecdsa, {
      ProjectivePoint: Point,
      CURVE: Object.assign({}, c, (0, modular_ts_1.nLength)(Point.Fn.ORDER, Point.Fn.BITS))
    });
  }
  function weierstrass(c) {
    const { CURVE, curveOpts, hash, ecdsaOpts } = _ecdsa_legacy_opts_to_new(c);
    const Point = weierstrassN(CURVE, curveOpts);
    const signs = ecdsa(Point, hash, ecdsaOpts);
    return _ecdsa_new_output_to_legacy(c, signs);
  }
});

// node_modules/@noble/curves/_shortw_utils.js
var require__shortw_utils = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.getHash = getHash;
  exports2.createCurve = createCurve;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var weierstrass_ts_1 = require_weierstrass();
  function getHash(hash) {
    return { hash };
  }
  function createCurve(curveDef, defHash) {
    const create = (hash) => (0, weierstrass_ts_1.weierstrass)({ ...curveDef, hash });
    return { ...create(defHash), create };
  }
});

// node_modules/@noble/curves/secp256k1.js
var require_secp256k1 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.encodeToCurve = exports2.hashToCurve = exports2.secp256k1_hasher = exports2.schnorr = exports2.secp256k1 = undefined;
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var sha2_js_1 = require_sha2();
  var utils_js_1 = require_utils2();
  var _shortw_utils_ts_1 = require__shortw_utils();
  var hash_to_curve_ts_1 = require_hash_to_curve();
  var modular_ts_1 = require_modular();
  var weierstrass_ts_1 = require_weierstrass();
  var utils_ts_1 = require_utils3();
  var secp256k1_CURVE = {
    p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
    n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
    h: BigInt(1),
    a: BigInt(0),
    b: BigInt(7),
    Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
    Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
  };
  var secp256k1_ENDO = {
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    basises: [
      [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
      [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
    ]
  };
  var _0n = /* @__PURE__ */ BigInt(0);
  var _1n = /* @__PURE__ */ BigInt(1);
  var _2n = /* @__PURE__ */ BigInt(2);
  function sqrtMod(y) {
    const P = secp256k1_CURVE.p;
    const _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
    const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
    const b2 = y * y * y % P;
    const b3 = b2 * b2 * y % P;
    const b6 = (0, modular_ts_1.pow2)(b3, _3n, P) * b3 % P;
    const b9 = (0, modular_ts_1.pow2)(b6, _3n, P) * b3 % P;
    const b11 = (0, modular_ts_1.pow2)(b9, _2n, P) * b2 % P;
    const b22 = (0, modular_ts_1.pow2)(b11, _11n, P) * b11 % P;
    const b44 = (0, modular_ts_1.pow2)(b22, _22n, P) * b22 % P;
    const b88 = (0, modular_ts_1.pow2)(b44, _44n, P) * b44 % P;
    const b176 = (0, modular_ts_1.pow2)(b88, _88n, P) * b88 % P;
    const b220 = (0, modular_ts_1.pow2)(b176, _44n, P) * b44 % P;
    const b223 = (0, modular_ts_1.pow2)(b220, _3n, P) * b3 % P;
    const t1 = (0, modular_ts_1.pow2)(b223, _23n, P) * b22 % P;
    const t2 = (0, modular_ts_1.pow2)(t1, _6n, P) * b2 % P;
    const root = (0, modular_ts_1.pow2)(t2, _2n, P);
    if (!Fpk1.eql(Fpk1.sqr(root), y))
      throw new Error("Cannot find square root");
    return root;
  }
  var Fpk1 = (0, modular_ts_1.Field)(secp256k1_CURVE.p, { sqrt: sqrtMod });
  exports2.secp256k1 = (0, _shortw_utils_ts_1.createCurve)({ ...secp256k1_CURVE, Fp: Fpk1, lowS: true, endo: secp256k1_ENDO }, sha2_js_1.sha256);
  var TAGGED_HASH_PREFIXES = {};
  function taggedHash(tag, ...messages) {
    let tagP = TAGGED_HASH_PREFIXES[tag];
    if (tagP === undefined) {
      const tagH = (0, sha2_js_1.sha256)((0, utils_ts_1.utf8ToBytes)(tag));
      tagP = (0, utils_ts_1.concatBytes)(tagH, tagH);
      TAGGED_HASH_PREFIXES[tag] = tagP;
    }
    return (0, sha2_js_1.sha256)((0, utils_ts_1.concatBytes)(tagP, ...messages));
  }
  var pointToBytes = (point) => point.toBytes(true).slice(1);
  var Pointk1 = /* @__PURE__ */ (() => exports2.secp256k1.Point)();
  var hasEven = (y) => y % _2n === _0n;
  function schnorrGetExtPubKey(priv) {
    const { Fn, BASE } = Pointk1;
    const d_ = (0, weierstrass_ts_1._normFnElement)(Fn, priv);
    const p = BASE.multiply(d_);
    const scalar = hasEven(p.y) ? d_ : Fn.neg(d_);
    return { scalar, bytes: pointToBytes(p) };
  }
  function lift_x(x) {
    const Fp = Fpk1;
    if (!Fp.isValidNot0(x))
      throw new Error("invalid x: Fail if x ≥ p");
    const xx = Fp.create(x * x);
    const c = Fp.create(xx * x + BigInt(7));
    let y = Fp.sqrt(c);
    if (!hasEven(y))
      y = Fp.neg(y);
    const p = Pointk1.fromAffine({ x, y });
    p.assertValidity();
    return p;
  }
  var num = utils_ts_1.bytesToNumberBE;
  function challenge(...args) {
    return Pointk1.Fn.create(num(taggedHash("BIP0340/challenge", ...args)));
  }
  function schnorrGetPublicKey(secretKey) {
    return schnorrGetExtPubKey(secretKey).bytes;
  }
  function schnorrSign(message, secretKey, auxRand = (0, utils_js_1.randomBytes)(32)) {
    const { Fn } = Pointk1;
    const m = (0, utils_ts_1.ensureBytes)("message", message);
    const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey);
    const a = (0, utils_ts_1.ensureBytes)("auxRand", auxRand, 32);
    const t = Fn.toBytes(d ^ num(taggedHash("BIP0340/aux", a)));
    const rand = taggedHash("BIP0340/nonce", t, px, m);
    const { bytes: rx, scalar: k } = schnorrGetExtPubKey(rand);
    const e = challenge(rx, px, m);
    const sig = new Uint8Array(64);
    sig.set(rx, 0);
    sig.set(Fn.toBytes(Fn.create(k + e * d)), 32);
    if (!schnorrVerify(sig, m, px))
      throw new Error("sign: Invalid signature produced");
    return sig;
  }
  function schnorrVerify(signature, message, publicKey) {
    const { Fn, BASE } = Pointk1;
    const sig = (0, utils_ts_1.ensureBytes)("signature", signature, 64);
    const m = (0, utils_ts_1.ensureBytes)("message", message);
    const pub = (0, utils_ts_1.ensureBytes)("publicKey", publicKey, 32);
    try {
      const P = lift_x(num(pub));
      const r = num(sig.subarray(0, 32));
      if (!(0, utils_ts_1.inRange)(r, _1n, secp256k1_CURVE.p))
        return false;
      const s = num(sig.subarray(32, 64));
      if (!(0, utils_ts_1.inRange)(s, _1n, secp256k1_CURVE.n))
        return false;
      const e = challenge(Fn.toBytes(r), pointToBytes(P), m);
      const R = BASE.multiplyUnsafe(s).add(P.multiplyUnsafe(Fn.neg(e)));
      const { x, y } = R.toAffine();
      if (R.is0() || !hasEven(y) || x !== r)
        return false;
      return true;
    } catch (error) {
      return false;
    }
  }
  exports2.schnorr = (() => {
    const size = 32;
    const seedLength = 48;
    const randomSecretKey = (seed = (0, utils_js_1.randomBytes)(seedLength)) => {
      return (0, modular_ts_1.mapHashToField)(seed, secp256k1_CURVE.n);
    };
    exports2.secp256k1.utils.randomSecretKey;
    function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: schnorrGetPublicKey(secretKey) };
    }
    return {
      keygen,
      getPublicKey: schnorrGetPublicKey,
      sign: schnorrSign,
      verify: schnorrVerify,
      Point: Pointk1,
      utils: {
        randomSecretKey,
        randomPrivateKey: randomSecretKey,
        taggedHash,
        lift_x,
        pointToBytes,
        numberToBytesBE: utils_ts_1.numberToBytesBE,
        bytesToNumberBE: utils_ts_1.bytesToNumberBE,
        mod: modular_ts_1.mod
      },
      lengths: {
        secretKey: size,
        publicKey: size,
        publicKeyHasPrefix: false,
        signature: size * 2,
        seed: seedLength
      }
    };
  })();
  var isoMap = /* @__PURE__ */ (() => (0, hash_to_curve_ts_1.isogenyMap)(Fpk1, [
    [
      "0x8e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38daaaaa8c7",
      "0x7d3d4c80bc321d5b9f315cea7fd44c5d595d2fc0bf63b92dfff1044f17c6581",
      "0x534c328d23f234e6e2a413deca25caece4506144037c40314ecbd0b53d9dd262",
      "0x8e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38daaaaa88c"
    ],
    [
      "0xd35771193d94918a9ca34ccbb7b640dd86cd409542f8487d9fe6b745781eb49b",
      "0xedadc6f64383dc1df7c4b2d51b54225406d36b641f5e41bbc52a56612a8c6d14",
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    ],
    [
      "0x4bda12f684bda12f684bda12f684bda12f684bda12f684bda12f684b8e38e23c",
      "0xc75e0c32d5cb7c0fa9d0a54b12a0a6d5647ab046d686da6fdffc90fc201d71a3",
      "0x29a6194691f91a73715209ef6512e576722830a201be2018a765e85a9ecee931",
      "0x2f684bda12f684bda12f684bda12f684bda12f684bda12f684bda12f38e38d84"
    ],
    [
      "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffff93b",
      "0x7a06534bb8bdb49fd5e9e6632722c2989467c1bfc8e8d978dfb425d2685c2573",
      "0x6484aa716545ca2cf3a70c3fa8fe337e0a3d21162f0d6299a7bf8192bfd2a76f",
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    ]
  ].map((i) => i.map((j) => BigInt(j)))))();
  var mapSWU = /* @__PURE__ */ (() => (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fpk1, {
    A: BigInt("0x3f8731abdd661adca08a5558f0f5d272e953d363cb6f0e5d405447c01a444533"),
    B: BigInt("1771"),
    Z: Fpk1.create(BigInt("-11"))
  }))();
  exports2.secp256k1_hasher = (() => (0, hash_to_curve_ts_1.createHasher)(exports2.secp256k1.Point, (scalars) => {
    const { x, y } = mapSWU(Fpk1.create(scalars[0]));
    return isoMap(x, y);
  }, {
    DST: "secp256k1_XMD:SHA-256_SSWU_RO_",
    encodeDST: "secp256k1_XMD:SHA-256_SSWU_NU_",
    p: Fpk1.ORDER,
    m: 1,
    k: 128,
    expand: "xmd",
    hash: sha2_js_1.sha256
  }))();
  exports2.hashToCurve = (() => exports2.secp256k1_hasher.hashToCurve)();
  exports2.encodeToCurve = (() => exports2.secp256k1_hasher.encodeToCurve)();
});

// node_modules/eciesjs/dist/utils/hex.js
var require_hex = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.decodeHex = exports2.remove0x = undefined;
  var utils_1 = require_utils();
  var remove0x = function(hex) {
    return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  };
  exports2.remove0x = remove0x;
  var decodeHex = function(hex) {
    return (0, utils_1.hexToBytes)((0, exports2.remove0x)(hex));
  };
  exports2.decodeHex = decodeHex;
});

// node_modules/eciesjs/dist/utils/elliptic.js
var require_elliptic = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.hexToPublicKey = exports2.convertPublicKeyFormat = exports2.getSharedPoint = exports2.getPublicKey = exports2.isValidPrivateKey = exports2.getValidSecret = undefined;
  var webcrypto_1 = require_webcrypto();
  var ed25519_1 = require_ed25519();
  var secp256k1_1 = require_secp256k1();
  var config_js_1 = require_config();
  var consts_js_1 = require_consts();
  var hex_js_1 = require_hex();
  var getValidSecret = function(curve) {
    var key;
    do {
      key = (0, webcrypto_1.randomBytes)(consts_js_1.SECRET_KEY_LENGTH);
    } while (!(0, exports2.isValidPrivateKey)(key, curve));
    return key;
  };
  exports2.getValidSecret = getValidSecret;
  var isValidPrivateKey = function(secret, curve) {
    return _exec(curve, function(curve2) {
      return curve2.utils.isValidSecretKey(secret);
    }, function() {
      return true;
    }, function() {
      return true;
    });
  };
  exports2.isValidPrivateKey = isValidPrivateKey;
  var getPublicKey = function(secret, curve) {
    return _exec(curve, function(curve2) {
      return curve2.getPublicKey(secret);
    }, function(curve2) {
      return curve2.getPublicKey(secret);
    }, function(curve2) {
      return curve2.getPublicKey(secret);
    });
  };
  exports2.getPublicKey = getPublicKey;
  var getSharedPoint = function(sk, pk, compressed, curve) {
    return _exec(curve, function(curve2) {
      return curve2.getSharedSecret(sk, pk, compressed);
    }, function(curve2) {
      return curve2.getSharedSecret(sk, pk);
    }, function(curve2) {
      return getSharedPointOnEd25519(curve2, sk, pk);
    });
  };
  exports2.getSharedPoint = getSharedPoint;
  var convertPublicKeyFormat = function(pk, compressed, curve) {
    return _exec(curve, function(curve2) {
      return curve2.getSharedSecret(Uint8Array.from(Array(31).fill(0).concat([1])), pk, compressed);
    }, function() {
      return pk;
    }, function() {
      return pk;
    });
  };
  exports2.convertPublicKeyFormat = convertPublicKeyFormat;
  var hexToPublicKey = function(hex, curve) {
    var decoded = (0, hex_js_1.decodeHex)(hex);
    return _exec(curve, function() {
      return compatEthPublicKey(decoded);
    }, function() {
      return decoded;
    }, function() {
      return decoded;
    });
  };
  exports2.hexToPublicKey = hexToPublicKey;
  function _exec(curve, secp256k1Callback, x25519Callback, ed25519Callback) {
    var _curve = curve || config_js_1.ECIES_CONFIG.ellipticCurve;
    if (_curve === "secp256k1") {
      return secp256k1Callback(secp256k1_1.secp256k1);
    } else if (_curve === "x25519") {
      return x25519Callback(ed25519_1.x25519);
    } else if (_curve === "ed25519") {
      return ed25519Callback(ed25519_1.ed25519);
    } else {
      throw new Error("Not implemented");
    }
  }
  var compatEthPublicKey = function(pk) {
    if (pk.length === consts_js_1.ETH_PUBLIC_KEY_SIZE) {
      var fixed = new Uint8Array(1 + pk.length);
      fixed.set([4]);
      fixed.set(pk, 1);
      return fixed;
    }
    return pk;
  };
  var getSharedPointOnEd25519 = function(curve, sk, pk) {
    var scalar = curve.utils.getExtendedPublicKey(sk).scalar;
    var point = curve.Point.fromBytes(pk).multiply(scalar);
    return point.toBytes();
  };
});

// node_modules/@noble/hashes/hkdf.js
var require_hkdf = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.hkdf = undefined;
  exports2.extract = extract;
  exports2.expand = expand;
  var hmac_ts_1 = require_hmac();
  var utils_ts_1 = require_utils2();
  function extract(hash, ikm, salt) {
    (0, utils_ts_1.ahash)(hash);
    if (salt === undefined)
      salt = new Uint8Array(hash.outputLen);
    return (0, hmac_ts_1.hmac)(hash, (0, utils_ts_1.toBytes)(salt), (0, utils_ts_1.toBytes)(ikm));
  }
  var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.from([0]);
  var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
  function expand(hash, prk, info, length = 32) {
    (0, utils_ts_1.ahash)(hash);
    (0, utils_ts_1.anumber)(length);
    const olen = hash.outputLen;
    if (length > 255 * olen)
      throw new Error("Length should be <= 255*HashLen");
    const blocks = Math.ceil(length / olen);
    if (info === undefined)
      info = EMPTY_BUFFER;
    const okm = new Uint8Array(blocks * olen);
    const HMAC = hmac_ts_1.hmac.create(hash, prk);
    const HMACTmp = HMAC._cloneInto();
    const T = new Uint8Array(HMAC.outputLen);
    for (let counter = 0;counter < blocks; counter++) {
      HKDF_COUNTER[0] = counter + 1;
      HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
      okm.set(T, olen * counter);
      HMAC._cloneInto(HMACTmp);
    }
    HMAC.destroy();
    HMACTmp.destroy();
    (0, utils_ts_1.clean)(T, HKDF_COUNTER);
    return okm.slice(0, length);
  }
  var hkdf = (hash, ikm, salt, info, length) => expand(hash, extract(hash, ikm, salt), info, length);
  exports2.hkdf = hkdf;
});

// node_modules/eciesjs/dist/utils/hash.js
var require_hash = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.getSharedKey = exports2.deriveKey = undefined;
  var utils_1 = require_utils();
  var hkdf_1 = require_hkdf();
  var sha2_1 = require_sha2();
  var deriveKey = function(master, salt, info) {
    return (0, hkdf_1.hkdf)(sha2_1.sha256, master, salt, info, 32);
  };
  exports2.deriveKey = deriveKey;
  var getSharedKey = function() {
    var parts = [];
    for (var _i = 0;_i < arguments.length; _i++) {
      parts[_i] = arguments[_i];
    }
    return (0, exports2.deriveKey)(utils_1.concatBytes.apply(undefined, parts));
  };
  exports2.getSharedKey = getSharedKey;
});

// node_modules/@ecies/ciphers/dist/_node/compat.js
var require_compat = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2._compat = undefined;
  var node_crypto_1 = require("node:crypto");
  var utils_1 = require_utils();
  var AEAD_TAG_LENGTH = 16;
  var IS_DENO = globalThis.Deno !== undefined;
  var _compat = function(algorithm, key, nonce, AAD) {
    var isAEAD = algorithm === "aes-256-gcm" || algorithm === "chacha20-poly1305";
    var authTagLength = isAEAD ? AEAD_TAG_LENGTH : 0;
    var options = isAEAD ? { authTagLength } : undefined;
    var encrypt = function(plainText) {
      var cipher = (0, node_crypto_1.createCipheriv)(algorithm, key, nonce, options);
      if (isAEAD && AAD !== undefined) {
        cipher.setAAD(AAD);
      }
      var updated = cipher.update(plainText);
      var finalized = cipher.final();
      var tag = isAEAD ? cipher.getAuthTag() : new Uint8Array(0);
      return (0, utils_1.concatBytes)(updated, finalized, tag);
    };
    var decrypt = function(cipherText) {
      var rawCipherText = cipherText.subarray(0, cipherText.length - authTagLength);
      var tag = cipherText.subarray(cipherText.length - authTagLength);
      var decipher = (0, node_crypto_1.createDecipheriv)(algorithm, key, nonce, options);
      if (isAEAD) {
        if (AAD !== undefined) {
          decipher.setAAD(AAD);
        }
        decipher.setAuthTag(tag);
      }
      if (!isAEAD && IS_DENO) {
        decipher.setAutoPadding(false);
      }
      var updated = decipher.update(rawCipherText);
      var finalized = decipher.final();
      return (0, utils_1.concatBytes)(updated, finalized);
    };
    return {
      encrypt,
      decrypt
    };
  };
  exports2._compat = _compat;
});

// node_modules/@ecies/ciphers/dist/aes/node.js
var require_node = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.aes256cbc = exports2.aes256gcm = undefined;
  var compat_js_1 = require_compat();
  var aes256gcm = function(key, nonce, AAD) {
    return (0, compat_js_1._compat)("aes-256-gcm", key, nonce, AAD);
  };
  exports2.aes256gcm = aes256gcm;
  var aes256cbc = function(key, nonce, _AAD) {
    return (0, compat_js_1._compat)("aes-256-cbc", key, nonce);
  };
  exports2.aes256cbc = aes256cbc;
});

// node_modules/@ecies/ciphers/dist/_node/hchacha.js
var require_hchacha = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2._hchacha20 = undefined;
  var _hchacha20 = function(s, k, i, o32) {
    var x00 = s[0], x01 = s[1], x02 = s[2], x03 = s[3], x04 = k[0], x05 = k[1], x06 = k[2], x07 = k[3], x08 = k[4], x09 = k[5], x10 = k[6], x11 = k[7], x12 = i[0], x13 = i[1], x14 = i[2], x15 = i[3];
    for (var r = 0;r < 20; r += 2) {
      x00 = x00 + x04 | 0;
      x12 = rotl(x12 ^ x00, 16);
      x08 = x08 + x12 | 0;
      x04 = rotl(x04 ^ x08, 12);
      x00 = x00 + x04 | 0;
      x12 = rotl(x12 ^ x00, 8);
      x08 = x08 + x12 | 0;
      x04 = rotl(x04 ^ x08, 7);
      x01 = x01 + x05 | 0;
      x13 = rotl(x13 ^ x01, 16);
      x09 = x09 + x13 | 0;
      x05 = rotl(x05 ^ x09, 12);
      x01 = x01 + x05 | 0;
      x13 = rotl(x13 ^ x01, 8);
      x09 = x09 + x13 | 0;
      x05 = rotl(x05 ^ x09, 7);
      x02 = x02 + x06 | 0;
      x14 = rotl(x14 ^ x02, 16);
      x10 = x10 + x14 | 0;
      x06 = rotl(x06 ^ x10, 12);
      x02 = x02 + x06 | 0;
      x14 = rotl(x14 ^ x02, 8);
      x10 = x10 + x14 | 0;
      x06 = rotl(x06 ^ x10, 7);
      x03 = x03 + x07 | 0;
      x15 = rotl(x15 ^ x03, 16);
      x11 = x11 + x15 | 0;
      x07 = rotl(x07 ^ x11, 12);
      x03 = x03 + x07 | 0;
      x15 = rotl(x15 ^ x03, 8);
      x11 = x11 + x15 | 0;
      x07 = rotl(x07 ^ x11, 7);
      x00 = x00 + x05 | 0;
      x15 = rotl(x15 ^ x00, 16);
      x10 = x10 + x15 | 0;
      x05 = rotl(x05 ^ x10, 12);
      x00 = x00 + x05 | 0;
      x15 = rotl(x15 ^ x00, 8);
      x10 = x10 + x15 | 0;
      x05 = rotl(x05 ^ x10, 7);
      x01 = x01 + x06 | 0;
      x12 = rotl(x12 ^ x01, 16);
      x11 = x11 + x12 | 0;
      x06 = rotl(x06 ^ x11, 12);
      x01 = x01 + x06 | 0;
      x12 = rotl(x12 ^ x01, 8);
      x11 = x11 + x12 | 0;
      x06 = rotl(x06 ^ x11, 7);
      x02 = x02 + x07 | 0;
      x13 = rotl(x13 ^ x02, 16);
      x08 = x08 + x13 | 0;
      x07 = rotl(x07 ^ x08, 12);
      x02 = x02 + x07 | 0;
      x13 = rotl(x13 ^ x02, 8);
      x08 = x08 + x13 | 0;
      x07 = rotl(x07 ^ x08, 7);
      x03 = x03 + x04 | 0;
      x14 = rotl(x14 ^ x03, 16);
      x09 = x09 + x14 | 0;
      x04 = rotl(x04 ^ x09, 12);
      x03 = x03 + x04 | 0;
      x14 = rotl(x14 ^ x03, 8);
      x09 = x09 + x14 | 0;
      x04 = rotl(x04 ^ x09, 7);
    }
    var oi = 0;
    o32[oi++] = x00;
    o32[oi++] = x01;
    o32[oi++] = x02;
    o32[oi++] = x03;
    o32[oi++] = x12;
    o32[oi++] = x13;
    o32[oi++] = x14;
    o32[oi++] = x15;
  };
  exports2._hchacha20 = _hchacha20;
  var rotl = function(a, b) {
    return a << b | a >>> 32 - b;
  };
});

// node_modules/@ecies/ciphers/dist/chacha/node.js
var require_node2 = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.chacha20 = exports2.xchacha20 = undefined;
  var utils_1 = require_utils();
  var compat_js_1 = require_compat();
  var hchacha_js_1 = require_hchacha();
  var xchacha20 = function(key, nonce, AAD) {
    if (nonce.length !== 24) {
      throw new Error("xchacha20's nonce must be 24 bytes");
    }
    var constants = new Uint32Array([1634760805, 857760878, 2036477234, 1797285236]);
    var subKey = new Uint32Array(8);
    (0, hchacha_js_1._hchacha20)(constants, (0, utils_1.u32)(key), (0, utils_1.u32)(nonce.subarray(0, 16)), subKey);
    var subNonce = new Uint8Array(12);
    subNonce.set([0, 0, 0, 0]);
    subNonce.set(nonce.subarray(16), 4);
    return (0, compat_js_1._compat)("chacha20-poly1305", (0, utils_1.u8)(subKey), subNonce, AAD);
  };
  exports2.xchacha20 = xchacha20;
  var chacha20 = function(key, nonce, AAD) {
    if (nonce.length !== 12) {
      throw new Error("chacha20's nonce must be 12 bytes");
    }
    return (0, compat_js_1._compat)("chacha20-poly1305", key, nonce, AAD);
  };
  exports2.chacha20 = chacha20;
});

// node_modules/eciesjs/dist/utils/symmetric.js
var require_symmetric = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.aesDecrypt = exports2.aesEncrypt = exports2.symDecrypt = exports2.symEncrypt = undefined;
  var aes_1 = require_node();
  var chacha_1 = require_node2();
  var utils_1 = require_utils();
  var webcrypto_1 = require_webcrypto();
  var config_js_1 = require_config();
  var consts_js_1 = require_consts();
  var symEncrypt = function(key, plainText, AAD) {
    return _exec(_encrypt, config_js_1.ECIES_CONFIG.symmetricAlgorithm, config_js_1.ECIES_CONFIG.symmetricNonceLength, key, plainText, AAD);
  };
  exports2.symEncrypt = symEncrypt;
  var symDecrypt = function(key, cipherText, AAD) {
    return _exec(_decrypt, config_js_1.ECIES_CONFIG.symmetricAlgorithm, config_js_1.ECIES_CONFIG.symmetricNonceLength, key, cipherText, AAD);
  };
  exports2.symDecrypt = symDecrypt;
  exports2.aesEncrypt = exports2.symEncrypt;
  exports2.aesDecrypt = exports2.symDecrypt;
  function _exec(callback, algorithm, nonceLength, key, data, AAD) {
    if (algorithm === "aes-256-gcm") {
      return callback(aes_1.aes256gcm, key, data, nonceLength, consts_js_1.AEAD_TAG_LENGTH, AAD);
    } else if (algorithm === "xchacha20") {
      return callback(chacha_1.xchacha20, key, data, consts_js_1.XCHACHA20_NONCE_LENGTH, consts_js_1.AEAD_TAG_LENGTH, AAD);
    } else if (algorithm === "aes-256-cbc") {
      return callback(aes_1.aes256cbc, key, data, 16, 0);
    } else {
      throw new Error("Not implemented");
    }
  }
  function _encrypt(func, key, data, nonceLength, tagLength, AAD) {
    var nonce = (0, webcrypto_1.randomBytes)(nonceLength);
    var cipher = func(key, nonce, AAD);
    var encrypted = cipher.encrypt(data);
    if (tagLength === 0) {
      return (0, utils_1.concatBytes)(nonce, encrypted);
    }
    var cipherTextLength = encrypted.length - tagLength;
    var cipherText = encrypted.subarray(0, cipherTextLength);
    var tag = encrypted.subarray(cipherTextLength);
    return (0, utils_1.concatBytes)(nonce, tag, cipherText);
  }
  function _decrypt(func, key, data, nonceLength, tagLength, AAD) {
    var nonce = data.subarray(0, nonceLength);
    var cipher = func(key, Uint8Array.from(nonce), AAD);
    var encrypted = data.subarray(nonceLength);
    if (tagLength === 0) {
      return cipher.decrypt(encrypted);
    }
    var tag = encrypted.subarray(0, tagLength);
    var cipherText = encrypted.subarray(tagLength);
    return cipher.decrypt((0, utils_1.concatBytes)(cipherText, tag));
  }
});

// node_modules/eciesjs/dist/utils/index.js
var require_utils4 = __commonJS((exports2) => {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p))
        __createBinding(exports3, m, p);
  };
  Object.defineProperty(exports2, "__esModule", { value: true });
  __exportStar(require_elliptic(), exports2);
  __exportStar(require_hash(), exports2);
  __exportStar(require_hex(), exports2);
  __exportStar(require_symmetric(), exports2);
});

// node_modules/eciesjs/dist/keys/PublicKey.js
var require_PublicKey = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.PublicKey = undefined;
  var utils_1 = require_utils();
  var index_js_1 = require_utils4();
  var PublicKey = function() {
    function PublicKey2(data, curve) {
      var compressed = (0, index_js_1.convertPublicKeyFormat)(data, true, curve);
      var uncompressed = (0, index_js_1.convertPublicKeyFormat)(data, false, curve);
      this.data = compressed;
      this.dataUncompressed = compressed.length !== uncompressed.length ? uncompressed : null;
    }
    PublicKey2.fromHex = function(hex, curve) {
      return new PublicKey2((0, index_js_1.hexToPublicKey)(hex, curve), curve);
    };
    Object.defineProperty(PublicKey2.prototype, "_uncompressed", {
      get: function() {
        return this.dataUncompressed !== null ? this.dataUncompressed : this.data;
      },
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(PublicKey2.prototype, "uncompressed", {
      get: function() {
        return Buffer.from(this._uncompressed);
      },
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(PublicKey2.prototype, "compressed", {
      get: function() {
        return Buffer.from(this.data);
      },
      enumerable: false,
      configurable: true
    });
    PublicKey2.prototype.toBytes = function(compressed) {
      if (compressed === undefined) {
        compressed = true;
      }
      return compressed ? this.data : this._uncompressed;
    };
    PublicKey2.prototype.toHex = function(compressed) {
      if (compressed === undefined) {
        compressed = true;
      }
      return (0, utils_1.bytesToHex)(this.toBytes(compressed));
    };
    PublicKey2.prototype.decapsulate = function(sk, compressed) {
      if (compressed === undefined) {
        compressed = false;
      }
      var senderPoint = this.toBytes(compressed);
      var sharedPoint = sk.multiply(this, compressed);
      return (0, index_js_1.getSharedKey)(senderPoint, sharedPoint);
    };
    PublicKey2.prototype.equals = function(other) {
      return (0, utils_1.equalBytes)(this.data, other.data);
    };
    return PublicKey2;
  }();
  exports2.PublicKey = PublicKey;
});

// node_modules/eciesjs/dist/keys/PrivateKey.js
var require_PrivateKey = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.PrivateKey = undefined;
  var utils_1 = require_utils();
  var index_js_1 = require_utils4();
  var PublicKey_js_1 = require_PublicKey();
  var PrivateKey = function() {
    function PrivateKey2(secret, curve) {
      this.curve = curve;
      if (secret === undefined) {
        this.data = (0, index_js_1.getValidSecret)(curve);
      } else if ((0, index_js_1.isValidPrivateKey)(secret, curve)) {
        this.data = secret;
      } else {
        throw new Error("Invalid private key");
      }
      this.publicKey = new PublicKey_js_1.PublicKey((0, index_js_1.getPublicKey)(this.data, curve), curve);
    }
    PrivateKey2.fromHex = function(hex, curve) {
      return new PrivateKey2((0, index_js_1.decodeHex)(hex), curve);
    };
    Object.defineProperty(PrivateKey2.prototype, "secret", {
      get: function() {
        return Buffer.from(this.data);
      },
      enumerable: false,
      configurable: true
    });
    PrivateKey2.prototype.toHex = function() {
      return (0, utils_1.bytesToHex)(this.data);
    };
    PrivateKey2.prototype.encapsulate = function(pk, compressed) {
      if (compressed === undefined) {
        compressed = false;
      }
      var senderPoint = this.publicKey.toBytes(compressed);
      var sharedPoint = this.multiply(pk, compressed);
      return (0, index_js_1.getSharedKey)(senderPoint, sharedPoint);
    };
    PrivateKey2.prototype.multiply = function(pk, compressed) {
      if (compressed === undefined) {
        compressed = false;
      }
      return (0, index_js_1.getSharedPoint)(this.data, pk.toBytes(true), compressed, this.curve);
    };
    PrivateKey2.prototype.equals = function(other) {
      return (0, utils_1.equalBytes)(this.data, other.data);
    };
    return PrivateKey2;
  }();
  exports2.PrivateKey = PrivateKey;
});

// node_modules/eciesjs/dist/keys/index.js
var require_keys = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.PublicKey = exports2.PrivateKey = undefined;
  var PrivateKey_js_1 = require_PrivateKey();
  Object.defineProperty(exports2, "PrivateKey", { enumerable: true, get: function() {
    return PrivateKey_js_1.PrivateKey;
  } });
  var PublicKey_js_1 = require_PublicKey();
  Object.defineProperty(exports2, "PublicKey", { enumerable: true, get: function() {
    return PublicKey_js_1.PublicKey;
  } });
});

// node_modules/eciesjs/dist/index.js
var require_dist = __commonJS((exports2) => {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.utils = exports2.PublicKey = exports2.PrivateKey = exports2.ECIES_CONFIG = undefined;
  exports2.encrypt = encrypt;
  exports2.decrypt = decrypt;
  var utils_1 = require_utils();
  var config_js_1 = require_config();
  var index_js_1 = require_keys();
  var index_js_2 = require_utils4();
  function encrypt(receiverRawPK, data) {
    return Buffer.from(_encrypt(receiverRawPK, data, config_js_1.ECIES_CONFIG));
  }
  function _encrypt(receiverRawPK, data, config) {
    var curve = config.ellipticCurve;
    var ephemeralSK = new index_js_1.PrivateKey(undefined, curve);
    var receiverPK = receiverRawPK instanceof Uint8Array ? new index_js_1.PublicKey(receiverRawPK, curve) : index_js_1.PublicKey.fromHex(receiverRawPK, curve);
    var sharedKey = ephemeralSK.encapsulate(receiverPK, config.isHkdfKeyCompressed);
    var ephemeralPK = ephemeralSK.publicKey.toBytes(config.isEphemeralKeyCompressed);
    var encrypted = (0, index_js_2.symEncrypt)(sharedKey, data);
    return (0, utils_1.concatBytes)(ephemeralPK, encrypted);
  }
  function decrypt(receiverRawSK, data) {
    return Buffer.from(_decrypt(receiverRawSK, data));
  }
  function _decrypt(receiverRawSK, data, config) {
    if (config === undefined) {
      config = config_js_1.ECIES_CONFIG;
    }
    var curve = config.ellipticCurve;
    var receiverSK = receiverRawSK instanceof Uint8Array ? new index_js_1.PrivateKey(receiverRawSK, curve) : index_js_1.PrivateKey.fromHex(receiverRawSK, curve);
    var keySize = config.ephemeralKeySize;
    var ephemeralPK = new index_js_1.PublicKey(data.subarray(0, keySize), curve);
    var encrypted = data.subarray(keySize);
    var sharedKey = ephemeralPK.decapsulate(receiverSK, config.isHkdfKeyCompressed);
    return (0, index_js_2.symDecrypt)(sharedKey, encrypted);
  }
  var config_js_2 = require_config();
  Object.defineProperty(exports2, "ECIES_CONFIG", { enumerable: true, get: function() {
    return config_js_2.ECIES_CONFIG;
  } });
  var index_js_3 = require_keys();
  Object.defineProperty(exports2, "PrivateKey", { enumerable: true, get: function() {
    return index_js_3.PrivateKey;
  } });
  Object.defineProperty(exports2, "PublicKey", { enumerable: true, get: function() {
    return index_js_3.PublicKey;
  } });
  exports2.utils = {
    aesEncrypt: index_js_2.aesEncrypt,
    aesDecrypt: index_js_2.aesDecrypt,
    symEncrypt: index_js_2.symEncrypt,
    symDecrypt: index_js_2.symDecrypt,
    decodeHex: index_js_2.decodeHex,
    getValidSecret: index_js_2.getValidSecret,
    remove0x: index_js_2.remove0x
  };
});

// actions/diff/src/runtime.ts
var import_node_buffer4 = require("node:buffer");

// node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;

class ZodNativeEnum extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
// cli/src/schemas/environment.ts
var environmentSchema = exports_external.object({
  version: exports_external.number().optional(),
  keys: exports_external.array(exports_external.object({
    name: exports_external.string(),
    fingerprint: exports_external.string(),
    encryptedDataKey: exports_external.string(),
    algorithm: exports_external.enum(["rsa", "ed25519"])
  })),
  encryptedContent: exports_external.string()
});

// cli/src/schemas/environmentDiffReport.ts
var ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION = 1;
var ENVIRONMENT_DIFF_LIMITS = {
  maxFilesPerSide: 100,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxPathBytes: 1024,
  maxEnvironmentNameBytes: 255,
  maxJsonDepth: 16,
  maxRecipientsPerEnvironment: 256,
  maxRecipientNameBytes: 256,
  maxFingerprintBytes: 256,
  maxEncryptedDataKeyBytes: 16 * 1024,
  maxPlaintextBytes: 1024 * 1024,
  maxVariablesPerEnvironment: 4096,
  maxVariableNameBytes: 256
};

// cli/src/helpers/crypto.ts
var import_node_buffer = require("node:buffer");
var import_node_crypto = __toESM(require("node:crypto"));
var ALGORITHM = "aes-256-gcm";
var IV_LENGTH = 12;
var AUTH_TAG_LENGTH = 16;
async function decryptData(key, input, aad) {
  if (key.length !== 32) {
    throw new Error("Key must be 32 bytes (256 bits) for AES-256-GCM.");
  }
  if (input.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(`Encrypted input is too short (${input.length} bytes). Expected at least ${IV_LENGTH + AUTH_TAG_LENGTH} bytes.`);
  }
  const iv = input.subarray(0, IV_LENGTH);
  const authTag = input.subarray(input.length - AUTH_TAG_LENGTH);
  const ciphertext = input.subarray(IV_LENGTH, input.length - AUTH_TAG_LENGTH);
  try {
    const decipher = import_node_crypto.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    if (aad) {
      decipher.setAAD(aad);
    }
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    try {
      if (!import_node_buffer.isUtf8(decrypted)) {
        throw new Error("Decrypted content is not valid UTF-8.");
      }
      return decrypted.toString("utf-8");
    } finally {
      decrypted.fill(0);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("unable to authenticate")) {
      throw new Error(`Failed to decrypt file. This could be because:
` + `1. The encryption key may be incorrect
` + `2. The encrypted file may be corrupted
` + "3. The encrypted file may have been tampered with");
    }
    throw error;
  }
}

// cli/src/helpers/decryptDataKey.ts
var import_node_crypto2 = __toESM(require("node:crypto"));

// cli/src/helpers/ecies.ts
var import_eciesjs = __toESM(require_dist(), 1);
import_eciesjs.ECIES_CONFIG.ellipticCurve = "ed25519";
var eciesDecrypt = (privateKey, data) => import_eciesjs.decrypt(privateKey, data);

// cli/src/helpers/decryptDataKey.ts
var decryptDataKey = (keyInfo, encryptedDataKey) => {
  if (keyInfo.algorithm === "rsa") {
    return import_node_crypto2.default.privateDecrypt({
      key: keyInfo.privateKey,
      padding: import_node_crypto2.default.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    }, encryptedDataKey);
  }
  const privDer = keyInfo.privateKey.export({
    type: "pkcs8",
    format: "der"
  });
  const rawSeed = Buffer.from(privDer.subarray(privDer.length - 32));
  try {
    return eciesDecrypt(rawSeed, encryptedDataKey);
  } finally {
    rawSeed.fill(0);
    privDer.fill(0);
  }
};

// cli/src/helpers/decryptEnvironment.ts
var import_node_crypto7 = require("node:crypto");

// node_modules/chalk/source/vendor/ansi-styles/index.js
var ANSI_BACKGROUND_OFFSET = 10;
var wrapAnsi16 = (offset = 0) => (code) => `\x1B[${code + offset}m`;
var wrapAnsi256 = (offset = 0) => (code) => `\x1B[${38 + offset};5;${code}m`;
var wrapAnsi16m = (offset = 0) => (red, green, blue) => `\x1B[${38 + offset};2;${red};${green};${blue}m`;
var styles = {
  modifier: {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    overline: [53, 55],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29]
  },
  color: {
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],
    blackBright: [90, 39],
    gray: [90, 39],
    grey: [90, 39],
    redBright: [91, 39],
    greenBright: [92, 39],
    yellowBright: [93, 39],
    blueBright: [94, 39],
    magentaBright: [95, 39],
    cyanBright: [96, 39],
    whiteBright: [97, 39]
  },
  bgColor: {
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],
    bgBlackBright: [100, 49],
    bgGray: [100, 49],
    bgGrey: [100, 49],
    bgRedBright: [101, 49],
    bgGreenBright: [102, 49],
    bgYellowBright: [103, 49],
    bgBlueBright: [104, 49],
    bgMagentaBright: [105, 49],
    bgCyanBright: [106, 49],
    bgWhiteBright: [107, 49]
  }
};
var modifierNames = Object.keys(styles.modifier);
var foregroundColorNames = Object.keys(styles.color);
var backgroundColorNames = Object.keys(styles.bgColor);
var colorNames = [...foregroundColorNames, ...backgroundColorNames];
function assembleStyles() {
  const codes = new Map;
  for (const [groupName, group] of Object.entries(styles)) {
    for (const [styleName, style] of Object.entries(group)) {
      styles[styleName] = {
        open: `\x1B[${style[0]}m`,
        close: `\x1B[${style[1]}m`
      };
      group[styleName] = styles[styleName];
      codes.set(style[0], style[1]);
    }
    Object.defineProperty(styles, groupName, {
      value: group,
      enumerable: false
    });
  }
  Object.defineProperty(styles, "codes", {
    value: codes,
    enumerable: false
  });
  styles.color.close = "\x1B[39m";
  styles.bgColor.close = "\x1B[49m";
  styles.color.ansi = wrapAnsi16();
  styles.color.ansi256 = wrapAnsi256();
  styles.color.ansi16m = wrapAnsi16m();
  styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
  Object.defineProperties(styles, {
    rgbToAnsi256: {
      value(red, green, blue) {
        if (red === green && green === blue) {
          if (red < 8) {
            return 16;
          }
          if (red > 248) {
            return 231;
          }
          return Math.round((red - 8) / 247 * 24) + 232;
        }
        return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
      },
      enumerable: false
    },
    hexToRgb: {
      value(hex) {
        const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
        if (!matches) {
          return [0, 0, 0];
        }
        let [colorString] = matches;
        if (colorString.length === 3) {
          colorString = [...colorString].map((character) => character + character).join("");
        }
        const integer = Number.parseInt(colorString, 16);
        return [
          integer >> 16 & 255,
          integer >> 8 & 255,
          integer & 255
        ];
      },
      enumerable: false
    },
    hexToAnsi256: {
      value: (hex) => styles.rgbToAnsi256(...styles.hexToRgb(hex)),
      enumerable: false
    },
    ansi256ToAnsi: {
      value(code) {
        if (code < 8) {
          return 30 + code;
        }
        if (code < 16) {
          return 90 + (code - 8);
        }
        let red;
        let green;
        let blue;
        if (code >= 232) {
          red = ((code - 232) * 10 + 8) / 255;
          green = red;
          blue = red;
        } else {
          code -= 16;
          const remainder = code % 36;
          red = Math.floor(code / 36) / 5;
          green = Math.floor(remainder / 6) / 5;
          blue = remainder % 6 / 5;
        }
        const value = Math.max(red, green, blue) * 2;
        if (value === 0) {
          return 30;
        }
        let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
        if (value === 2) {
          result += 60;
        }
        return result;
      },
      enumerable: false
    },
    rgbToAnsi: {
      value: (red, green, blue) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red, green, blue)),
      enumerable: false
    },
    hexToAnsi: {
      value: (hex) => styles.ansi256ToAnsi(styles.hexToAnsi256(hex)),
      enumerable: false
    }
  });
  return styles;
}
var ansiStyles = assembleStyles();
var ansi_styles_default = ansiStyles;

// node_modules/chalk/source/vendor/supports-color/index.js
var import_node_process = __toESM(require("node:process"));
var import_node_os = __toESM(require("node:os"));
var import_node_tty = __toESM(require("node:tty"));
function hasFlag(flag, argv = globalThis.Deno ? globalThis.Deno.args : import_node_process.default.argv) {
  const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
  const position = argv.indexOf(prefix + flag);
  const terminatorPosition = argv.indexOf("--");
  return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}
var { env } = import_node_process.default;
var flagForceColor;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
  flagForceColor = 0;
} else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
  flagForceColor = 1;
}
function envForceColor() {
  if ("FORCE_COLOR" in env) {
    if (env.FORCE_COLOR === "true") {
      return 1;
    }
    if (env.FORCE_COLOR === "false") {
      return 0;
    }
    return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
  }
}
function translateLevel(level) {
  if (level === 0) {
    return false;
  }
  return {
    level,
    hasBasic: true,
    has256: level >= 2,
    has16m: level >= 3
  };
}
function _supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
  const noFlagForceColor = envForceColor();
  if (noFlagForceColor !== undefined) {
    flagForceColor = noFlagForceColor;
  }
  const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
  if (forceColor === 0) {
    return 0;
  }
  if (sniffFlags) {
    if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
      return 3;
    }
    if (hasFlag("color=256")) {
      return 2;
    }
  }
  if ("TF_BUILD" in env && "AGENT_NAME" in env) {
    return 1;
  }
  if (haveStream && !streamIsTTY && forceColor === undefined) {
    return 0;
  }
  const min = forceColor || 0;
  if (env.TERM === "dumb") {
    return min;
  }
  if (import_node_process.default.platform === "win32") {
    const osRelease = import_node_os.default.release().split(".");
    if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
      return Number(osRelease[2]) >= 14931 ? 3 : 2;
    }
    return 1;
  }
  if ("CI" in env) {
    if (["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"].some((key) => (key in env))) {
      return 3;
    }
    if (["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE"].some((sign) => (sign in env)) || env.CI_NAME === "codeship") {
      return 1;
    }
    return min;
  }
  if ("TEAMCITY_VERSION" in env) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
  }
  if (env.COLORTERM === "truecolor") {
    return 3;
  }
  if (env.TERM === "xterm-kitty") {
    return 3;
  }
  if (env.TERM === "xterm-ghostty") {
    return 3;
  }
  if (env.TERM === "wezterm") {
    return 3;
  }
  if ("TERM_PROGRAM" in env) {
    const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
    switch (env.TERM_PROGRAM) {
      case "iTerm.app": {
        return version >= 3 ? 3 : 2;
      }
      case "Apple_Terminal": {
        return 2;
      }
    }
  }
  if (/-256(color)?$/i.test(env.TERM)) {
    return 2;
  }
  if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
    return 1;
  }
  if ("COLORTERM" in env) {
    return 1;
  }
  return min;
}
function createSupportsColor(stream, options = {}) {
  const level = _supportsColor(stream, {
    streamIsTTY: stream && stream.isTTY,
    ...options
  });
  return translateLevel(level);
}
var supportsColor = {
  stdout: createSupportsColor({ isTTY: import_node_tty.default.isatty(1) }),
  stderr: createSupportsColor({ isTTY: import_node_tty.default.isatty(2) })
};
var supports_color_default = supportsColor;

// node_modules/chalk/source/utilities.js
function stringReplaceAll(string, substring, replacer) {
  let index = string.indexOf(substring);
  if (index === -1) {
    return string;
  }
  const substringLength = substring.length;
  let endIndex = 0;
  let returnValue = "";
  do {
    returnValue += string.slice(endIndex, index) + substring + replacer;
    endIndex = index + substringLength;
    index = string.indexOf(substring, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}
function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
  let endIndex = 0;
  let returnValue = "";
  do {
    const gotCR = string[index - 1] === "\r";
    returnValue += string.slice(endIndex, gotCR ? index - 1 : index) + prefix + (gotCR ? `\r
` : `
`) + postfix;
    endIndex = index + 1;
    index = string.indexOf(`
`, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}

// node_modules/chalk/source/index.js
var { stdout: stdoutColor, stderr: stderrColor } = supports_color_default;
var GENERATOR = Symbol("GENERATOR");
var STYLER = Symbol("STYLER");
var IS_EMPTY = Symbol("IS_EMPTY");
var levelMapping = [
  "ansi",
  "ansi",
  "ansi256",
  "ansi16m"
];
var styles2 = Object.create(null);
var applyOptions = (object, options = {}) => {
  if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
    throw new Error("The `level` option should be an integer from 0 to 3");
  }
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object.level = options.level === undefined ? colorLevel : options.level;
};
var chalkFactory = (options) => {
  const chalk = (...strings) => strings.join(" ");
  applyOptions(chalk, options);
  Object.setPrototypeOf(chalk, createChalk.prototype);
  return chalk;
};
function createChalk(options) {
  return chalkFactory(options);
}
Object.setPrototypeOf(createChalk.prototype, Function.prototype);
for (const [styleName, style] of Object.entries(ansi_styles_default)) {
  styles2[styleName] = {
    get() {
      const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
      Object.defineProperty(this, styleName, { value: builder });
      return builder;
    }
  };
}
styles2.visible = {
  get() {
    const builder = createBuilder(this, this[STYLER], true);
    Object.defineProperty(this, "visible", { value: builder });
    return builder;
  }
};
var getModelAnsi = (model, level, type, ...arguments_) => {
  if (model === "rgb") {
    if (level === "ansi16m") {
      return ansi_styles_default[type].ansi16m(...arguments_);
    }
    if (level === "ansi256") {
      return ansi_styles_default[type].ansi256(ansi_styles_default.rgbToAnsi256(...arguments_));
    }
    return ansi_styles_default[type].ansi(ansi_styles_default.rgbToAnsi(...arguments_));
  }
  if (model === "hex") {
    return getModelAnsi("rgb", level, type, ...ansi_styles_default.hexToRgb(...arguments_));
  }
  return ansi_styles_default[type][model](...arguments_);
};
var usedModels = ["rgb", "hex", "ansi256"];
for (const model of usedModels) {
  styles2[model] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "color", ...arguments_), ansi_styles_default.color.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
  const bgModel = "bg" + model[0].toUpperCase() + model.slice(1);
  styles2[bgModel] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "bgColor", ...arguments_), ansi_styles_default.bgColor.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
}
var proto = Object.defineProperties(() => {}, {
  ...styles2,
  level: {
    enumerable: true,
    get() {
      return this[GENERATOR].level;
    },
    set(level) {
      this[GENERATOR].level = level;
    }
  }
});
var createStyler = (open, close, parent) => {
  let openAll;
  let closeAll;
  if (parent === undefined) {
    openAll = open;
    closeAll = close;
  } else {
    openAll = parent.openAll + open;
    closeAll = close + parent.closeAll;
  }
  return {
    open,
    close,
    openAll,
    closeAll,
    parent
  };
};
var createBuilder = (self, _styler, _isEmpty) => {
  const builder = (...arguments_) => applyStyle(builder, arguments_.length === 1 ? "" + arguments_[0] : arguments_.join(" "));
  Object.setPrototypeOf(builder, proto);
  builder[GENERATOR] = self;
  builder[STYLER] = _styler;
  builder[IS_EMPTY] = _isEmpty;
  return builder;
};
var applyStyle = (self, string) => {
  if (self.level <= 0 || !string) {
    return self[IS_EMPTY] ? "" : string;
  }
  let styler = self[STYLER];
  if (styler === undefined) {
    return string;
  }
  const { openAll, closeAll } = styler;
  if (string.includes("\x1B")) {
    while (styler !== undefined) {
      string = stringReplaceAll(string, styler.close, styler.open);
      styler = styler.parent;
    }
  }
  const lfIndex = string.indexOf(`
`);
  if (lfIndex !== -1) {
    string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
  }
  return openAll + string + closeAll;
};
Object.defineProperties(createChalk.prototype, styles2);
var chalk = createChalk();
var chalkStderr = createChalk({ level: stderrColor ? stderrColor.level : 0 });
var source_default = chalk;

// cli/src/helpers/errors.ts
var passphraseProtectedKeyError = (keys) => `${source_default.red("Error:")} dotenc could not use passphrase-protected SSH keys.

Passphrase-protected keys found:
${keys.map((k) => `  - ${k}`).join(`
`)}

To use passphrase-protected keys directly, set:
  ${source_default.gray("DOTENC_PRIVATE_KEY_PASSPHRASE=<your-passphrase>")}

Or create/select a passwordless key for dotenc.`;

// cli/src/helpers/getEnvironmentByName.ts
var import_node_path = __toESM(require("node:path"));

// cli/src/helpers/getEnvironmentByPath.ts
var import_promises = __toESM(require("node:fs/promises"));
var getEnvironmentByPath = async (filePath) => {
  let environmentInput;
  try {
    environmentInput = await import_promises.default.readFile(filePath, "utf-8");
  } catch (_error) {
    throw new Error(`Environment file not found: ${filePath}`);
  }
  let environmentJson;
  try {
    const rawJson = JSON.parse(environmentInput);
    environmentJson = environmentSchema.parse(rawJson);
  } catch (_error) {
    throw new Error("Failed to parse the environment file. Please ensure it is a valid JSON file.");
  }
  return environmentJson;
};

// cli/src/helpers/getEnvironmentByName.ts
var getEnvironmentByName = async (name, dir) => {
  const resolvedDir = dir ?? process.cwd();
  return getEnvironmentByPath(import_node_path.default.join(resolvedDir, `.env.${name}.enc`));
};

// cli/src/helpers/getPrivateKeys.ts
var import_node_crypto6 = __toESM(require("node:crypto"));
var import_node_fs = require("node:fs");
var import_promises3 = __toESM(require("node:fs/promises"));
var import_node_os3 = __toESM(require("node:os"));
var import_node_path3 = __toESM(require("node:path"));

// cli/src/helpers/getKeyFingerprint.ts
var import_node_crypto3 = __toESM(require("node:crypto"));
var getKeyFingerprint = (keyInput) => {
  const publicKey = keyInput instanceof import_node_crypto3.default.KeyObject && keyInput.type === "public" ? keyInput : import_node_crypto3.default.createPublicKey(keyInput);
  const der = publicKey.export({ type: "spki", format: "der" });
  const hash = import_node_crypto3.default.createHash("sha256").update(der).digest("hex");
  return hash;
};

// cli/src/helpers/isPassphraseProtected.ts
function isPassphraseProtected(keyContent) {
  if (keyContent.includes("BEGIN ENCRYPTED PRIVATE KEY")) {
    return true;
  }
  if (keyContent.includes("Proc-Type: 4,ENCRYPTED")) {
    return true;
  }
  if (keyContent.includes("BEGIN OPENSSH PRIVATE KEY")) {
    return isOpenSSHKeyEncrypted(keyContent);
  }
  return false;
}
function isOpenSSHKeyEncrypted(content) {
  const lines = content.split(`
`);
  const startIdx = lines.findIndex((l) => l.trim().startsWith("-----BEGIN OPENSSH PRIVATE KEY-----"));
  const endIdx = lines.findIndex((l) => l.trim().startsWith("-----END OPENSSH PRIVATE KEY-----"));
  if (startIdx === -1 || endIdx === -1)
    return false;
  const base64 = lines.slice(startIdx + 1, endIdx).map((l) => l.trim()).join("");
  let buf;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    return false;
  }
  let offset = 0;
  const MAGIC = "openssh-key-v1\x00";
  if (buf.length < MAGIC.length)
    return false;
  const magic = buf.subarray(0, MAGIC.length).toString("ascii");
  if (magic !== MAGIC)
    return false;
  offset += MAGIC.length;
  if (offset + 4 > buf.length)
    return false;
  const cipherLen = buf.readUInt32BE(offset);
  offset += 4;
  if (offset + cipherLen > buf.length)
    return false;
  const ciphername = buf.subarray(offset, offset + cipherLen).toString("ascii");
  return ciphername !== "none";
}

// cli/src/helpers/parseOpenSSHKey.ts
var import_node_crypto4 = __toESM(require("node:crypto"));
function parseOpenSSHPrivateKey(content) {
  const lines = content.split(`
`);
  const startIdx = lines.findIndex((l) => l.trim().startsWith("-----BEGIN OPENSSH PRIVATE KEY-----"));
  const endIdx = lines.findIndex((l) => l.trim().startsWith("-----END OPENSSH PRIVATE KEY-----"));
  if (startIdx === -1 || endIdx === -1)
    return null;
  const base64 = lines.slice(startIdx + 1, endIdx).map((l) => l.trim()).join("");
  const buf = Buffer.from(base64, "base64");
  let offset = 0;
  const MAGIC = "openssh-key-v1\x00";
  const magic = buf.subarray(0, MAGIC.length).toString("ascii");
  if (magic !== MAGIC)
    return null;
  offset += MAGIC.length;
  const ciphername = readString(buf, offset);
  if (!ciphername)
    return null;
  offset = ciphername.nextOffset;
  if (ciphername.value !== "none")
    return null;
  const kdfname = readString(buf, offset);
  if (!kdfname)
    return null;
  offset = kdfname.nextOffset;
  const kdfoptions = readString(buf, offset);
  if (!kdfoptions)
    return null;
  offset = kdfoptions.nextOffset;
  if (offset + 4 > buf.length)
    return null;
  const numKeys = buf.readUInt32BE(offset);
  offset += 4;
  if (numKeys !== 1)
    return null;
  const pubKeyBlob = readString(buf, offset);
  if (!pubKeyBlob)
    return null;
  offset = pubKeyBlob.nextOffset;
  const privBlob = readBytes(buf, offset);
  if (!privBlob)
    return null;
  const priv = privBlob.value;
  let pOffset = 0;
  if (pOffset + 8 > priv.length)
    return null;
  const check1 = priv.readUInt32BE(pOffset);
  pOffset += 4;
  const check2 = priv.readUInt32BE(pOffset);
  pOffset += 4;
  if (check1 !== check2)
    return null;
  const keyType = readString(priv, pOffset);
  if (!keyType)
    return null;
  pOffset = keyType.nextOffset;
  if (keyType.value === "ssh-ed25519") {
    return parseEd25519(priv, pOffset);
  }
  if (keyType.value === "ssh-rsa") {
    return parseRSA(priv, pOffset);
  }
  return null;
}
function parseEd25519(priv, offset) {
  const pubKey = readBytes(priv, offset);
  if (!pubKey || pubKey.value.length !== 32)
    return null;
  offset = pubKey.nextOffset;
  const privKey = readBytes(priv, offset);
  if (!privKey || privKey.value.length !== 64)
    return null;
  const seed = privKey.value.subarray(0, 32);
  const pkcs8Prefix = Buffer.from([
    48,
    46,
    2,
    1,
    0,
    48,
    5,
    6,
    3,
    43,
    101,
    112,
    4,
    34,
    4,
    32
  ]);
  const der = Buffer.concat([pkcs8Prefix, seed]);
  try {
    return import_node_crypto4.default.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    return null;
  }
}
function parseRSA(priv, offset) {
  const n = readMpint(priv, offset);
  if (!n)
    return null;
  offset = n.nextOffset;
  const e = readMpint(priv, offset);
  if (!e)
    return null;
  offset = e.nextOffset;
  const d = readMpint(priv, offset);
  if (!d)
    return null;
  offset = d.nextOffset;
  const iqmp = readMpint(priv, offset);
  if (!iqmp)
    return null;
  offset = iqmp.nextOffset;
  const p = readMpint(priv, offset);
  if (!p)
    return null;
  offset = p.nextOffset;
  const q = readMpint(priv, offset);
  if (!q)
    return null;
  const dBig = bufToBigInt(d.value);
  const pBig = bufToBigInt(p.value);
  const qBig = bufToBigInt(q.value);
  const dp = dBig % (pBig - 1n);
  const dq = dBig % (qBig - 1n);
  const jwk = {
    kty: "RSA",
    n: bufToBase64Url(n.value),
    e: bufToBase64Url(e.value),
    d: bufToBase64Url(d.value),
    p: bufToBase64Url(p.value),
    q: bufToBase64Url(q.value),
    dp: bigIntToBase64Url(dp),
    dq: bigIntToBase64Url(dq),
    qi: bufToBase64Url(iqmp.value)
  };
  try {
    return import_node_crypto4.default.createPrivateKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }
}
function readUint32(buf, offset) {
  if (offset + 4 > buf.length)
    return null;
  return { value: buf.readUInt32BE(offset), nextOffset: offset + 4 };
}
function readBytes(buf, offset) {
  const len = readUint32(buf, offset);
  if (!len)
    return null;
  const end = len.nextOffset + len.value;
  if (end > buf.length)
    return null;
  return {
    value: buf.subarray(len.nextOffset, end),
    nextOffset: end
  };
}
function readString(buf, offset) {
  const bytes = readBytes(buf, offset);
  if (!bytes)
    return null;
  return {
    value: bytes.value.toString("ascii"),
    nextOffset: bytes.nextOffset
  };
}
function readMpint(buf, offset) {
  const bytes = readBytes(buf, offset);
  if (!bytes)
    return null;
  let value = bytes.value;
  if (value.length > 1 && value[0] === 0) {
    value = value.subarray(1);
  }
  return { value, nextOffset: bytes.nextOffset };
}
function bufToBase64Url(buf) {
  return Buffer.from(buf).toString("base64url");
}
function bufToBigInt(buf) {
  let result = 0n;
  for (const byte of buf) {
    result = result << 8n | BigInt(byte);
  }
  return result;
}
function bigIntToBase64Url(n) {
  if (n === 0n)
    return "AA";
  const hex = n.toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  return Buffer.from(padded, "hex").toString("base64url");
}

// cli/src/helpers/parsePassphraseProtectedPrivateKey.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto5 = __toESM(require("node:crypto"));
var import_promises2 = __toESM(require("node:fs/promises"));
var import_node_os2 = __toESM(require("node:os"));
var import_node_path2 = __toESM(require("node:path"));
var defaultParsePassphraseProtectedPrivateKeyDeps = {
  createPrivateKey: import_node_crypto5.default.createPrivateKey,
  parseOpenSSHPrivateKey,
  mkdtemp: import_promises2.default.mkdtemp,
  writeFile: import_promises2.default.writeFile,
  readFile: import_promises2.default.readFile,
  rm: import_promises2.default.rm,
  tmpdir: import_node_os2.default.tmpdir,
  spawnSync: import_node_child_process.spawnSync
};
var parsePassphraseProtectedPrivateKey = async (keyContent, passphrase, deps = defaultParsePassphraseProtectedPrivateKeyDeps) => {
  try {
    return deps.createPrivateKey({
      key: keyContent,
      passphrase
    });
  } catch {}
  if (!keyContent.includes("BEGIN OPENSSH PRIVATE KEY")) {
    return null;
  }
  let tempDir;
  try {
    tempDir = await deps.mkdtemp(import_node_path2.default.join(deps.tmpdir(), "dotenc-passphrase-"));
    const tempKeyPath = import_node_path2.default.join(tempDir, "key");
    const passphraseFilePath = import_node_path2.default.join(tempDir, "pp");
    const askpassPath = import_node_path2.default.join(tempDir, "askpass.sh");
    await deps.writeFile(tempKeyPath, keyContent, {
      encoding: "utf-8",
      mode: 384
    });
    await deps.writeFile(passphraseFilePath, passphrase, {
      encoding: "utf-8",
      mode: 384
    });
    const escapedPassphrasePath = passphraseFilePath.replace(/'/g, "'\\''");
    await deps.writeFile(askpassPath, `#!/bin/sh
cat '${escapedPassphrasePath}'
`, { encoding: "utf-8", mode: 448 });
    const childEnvironment = {
      DISPLAY: process.env.DISPLAY || ":0",
      PATH: process.env.PATH || "/usr/bin:/bin",
      SSH_ASKPASS: askpassPath,
      SSH_ASKPASS_REQUIRE: "prefer"
    };
    for (const name of ["SystemRoot", "WINDIR", "PATHEXT"]) {
      if (process.env[name])
        childEnvironment[name] = process.env[name];
    }
    const result = deps.spawnSync("ssh-keygen", ["-p", "-N", "", "-f", tempKeyPath, "-q"], {
      stdio: "pipe",
      encoding: "utf-8",
      env: childEnvironment
    });
    if (result.error || result.status !== 0) {
      return null;
    }
    const unlockedKeyContent = await deps.readFile(tempKeyPath, "utf-8");
    try {
      return deps.createPrivateKey(unlockedKeyContent);
    } catch {
      return deps.parseOpenSSHPrivateKey(unlockedKeyContent);
    }
  } finally {
    if (tempDir) {
      await deps.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};

// cli/src/helpers/getPrivateKeys.ts
var SSH_KEY_FILES = ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"];
var DOTENC_PRIVATE_KEY_BASE64_ENV = "DOTENC_PRIVATE_KEY_BASE64";
var DOTENC_PRIVATE_KEY_ENV = "DOTENC_PRIVATE_KEY";
function extractEd25519RawKeys(privateKey) {
  const publicKey = import_node_crypto6.default.createPublicKey(privateKey);
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = Buffer.from(pubDer.subarray(pubDer.length - 32));
  return { rawPublicKey };
}
function detectAlgorithm(privateKey) {
  const keyType = privateKey.asymmetricKeyType;
  if (keyType === "rsa")
    return "rsa";
  if (keyType === "ed25519")
    return "ed25519";
  return null;
}
function tryParsePrivateKey(keyContent) {
  try {
    return import_node_crypto6.default.createPrivateKey(keyContent);
  } catch {
    return parseOpenSSHPrivateKey(keyContent);
  }
}
function decodePrivateKeyBase64(value) {
  const normalized = value.replace(/\s/g, "");
  if (!normalized)
    return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized))
    return null;
  if (normalized.length % 4 === 1)
    return null;
  const decoded = Buffer.from(normalized, "base64").toString("utf-8");
  const normalizedInput = normalized.replace(/=+$/, "");
  const normalizedRoundTrip = Buffer.from(decoded, "utf-8").toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedRoundTrip)
    return null;
  return decoded;
}
function getEnvironmentPrivateKey() {
  const base64PrivateKey = process.env[DOTENC_PRIVATE_KEY_BASE64_ENV];
  if (base64PrivateKey) {
    const content = decodePrivateKeyBase64(base64PrivateKey);
    if (!content) {
      return {
        name: DOTENC_PRIVATE_KEY_BASE64_ENV,
        error: "invalid-base64"
      };
    }
    return {
      name: DOTENC_PRIVATE_KEY_BASE64_ENV,
      content
    };
  }
  const rawPrivateKey = process.env[DOTENC_PRIVATE_KEY_ENV];
  if (rawPrivateKey) {
    return {
      name: DOTENC_PRIVATE_KEY_ENV,
      content: rawPrivateKey
    };
  }
  return null;
}
function describeUnsupportedAlgorithm(keyType) {
  return `unsupported algorithm: ${String(keyType ?? "unknown")}`;
}
function readLengthPrefixedBytes(buffer, offset) {
  if (offset + 4 > buffer.length)
    return null;
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length)
    return null;
  return { bytes: buffer.subarray(start, end), nextOffset: end };
}
function readLengthPrefixedString(buffer, offset) {
  const bytes = readLengthPrefixedBytes(buffer, offset);
  if (!bytes)
    return null;
  return { value: bytes.bytes.toString("ascii"), nextOffset: bytes.nextOffset };
}
function detectUnsupportedOpenSSHAlgorithm(keyContent) {
  if (!keyContent.includes("BEGIN OPENSSH PRIVATE KEY"))
    return null;
  const lines = keyContent.split(`
`);
  const startIdx = lines.findIndex((line) => line.trim().startsWith("-----BEGIN OPENSSH PRIVATE KEY-----"));
  const endIdx = lines.findIndex((line) => line.trim().startsWith("-----END OPENSSH PRIVATE KEY-----"));
  if (startIdx === -1 || endIdx === -1)
    return null;
  const base64 = lines.slice(startIdx + 1, endIdx).map((line) => line.trim()).join("");
  const buffer = Buffer.from(base64, "base64");
  const MAGIC = "openssh-key-v1\x00";
  if (buffer.length < MAGIC.length)
    return null;
  const magic = buffer.subarray(0, MAGIC.length).toString("ascii");
  if (magic !== MAGIC)
    return null;
  let offset = MAGIC.length;
  const ciphername = readLengthPrefixedString(buffer, offset);
  if (!ciphername)
    return null;
  offset = ciphername.nextOffset;
  const kdfname = readLengthPrefixedString(buffer, offset);
  if (!kdfname)
    return null;
  offset = kdfname.nextOffset;
  const kdfoptions = readLengthPrefixedBytes(buffer, offset);
  if (!kdfoptions)
    return null;
  offset = kdfoptions.nextOffset;
  if (offset + 4 > buffer.length)
    return null;
  const keyCount = buffer.readUInt32BE(offset);
  offset += 4;
  if (keyCount < 1)
    return null;
  const publicBlob = readLengthPrefixedBytes(buffer, offset);
  if (!publicBlob)
    return null;
  const publicBlobType = readLengthPrefixedString(publicBlob.bytes, 0);
  if (!publicBlobType)
    return null;
  if (publicBlobType.value === "ssh-rsa")
    return null;
  if (publicBlobType.value === "ssh-ed25519")
    return null;
  return publicBlobType.value;
}
var getPrivateKeys = async (options = {}) => {
  const privateKeys = [];
  const passphraseProtectedKeys = [];
  const unsupportedKeys = [];
  const privateKeyPassphrase = process.env.DOTENC_PRIVATE_KEY_PASSPHRASE;
  const environmentKeyErrorMode = options.environmentKeyErrorMode ?? "exit";
  const logError = options.logError ?? ((message) => console.error(message));
  const environmentPrivateKey = getEnvironmentPrivateKey();
  if (environmentPrivateKey) {
    const envName = environmentPrivateKey.name;
    const entryName = `env.${envName}`;
    if ("error" in environmentPrivateKey) {
      logError(`Invalid ${envName} value. Please provide base64-encoded private key content.`);
      unsupportedKeys.push({
        name: entryName,
        reason: "invalid base64 private key"
      });
    } else {
      const dotencPrivateKey = environmentPrivateKey.content;
      const dotencPrivateKeyPassphraseProtected = isPassphraseProtected(dotencPrivateKey);
      const privateKey = dotencPrivateKeyPassphraseProtected ? privateKeyPassphrase !== undefined ? await parsePassphraseProtectedPrivateKey(dotencPrivateKey, privateKeyPassphrase) : null : tryParsePrivateKey(dotencPrivateKey);
      if (privateKey) {
        const algorithm = detectAlgorithm(privateKey);
        if (algorithm) {
          const entry = {
            name: entryName,
            privateKey,
            fingerprint: getKeyFingerprint(privateKey),
            algorithm
          };
          if (algorithm === "ed25519") {
            const { rawPublicKey } = extractEd25519RawKeys(privateKey);
            entry.rawPublicKey = rawPublicKey;
          }
          privateKeys.push(entry);
        } else {
          unsupportedKeys.push({
            name: entryName,
            reason: describeUnsupportedAlgorithm(privateKey.asymmetricKeyType)
          });
          logError(`Unsupported key type in ${envName}: ${privateKey.asymmetricKeyType}. Only RSA and Ed25519 are supported.`);
        }
      } else if (dotencPrivateKeyPassphraseProtected) {
        if (privateKeyPassphrase !== undefined) {
          logError(`Error: failed to decrypt the key in ${envName} with DOTENC_PRIVATE_KEY_PASSPHRASE. Please verify the passphrase.`);
          if (environmentKeyErrorMode === "exit") {
            process.exit(1);
          }
          unsupportedKeys.push({
            name: entryName,
            reason: "passphrase-protected (failed to decrypt)"
          });
        } else {
          logError(`Error: the key in ${envName} is passphrase-protected. Set DOTENC_PRIVATE_KEY_PASSPHRASE to use it, or provide a passwordless key.`);
          if (environmentKeyErrorMode === "exit") {
            process.exit(1);
          }
          passphraseProtectedKeys.push(entryName);
          unsupportedKeys.push({
            name: entryName,
            reason: "passphrase-protected"
          });
        }
      } else {
        logError(`Invalid private key format in ${envName} environment variable. Please provide a valid private key (PEM or OpenSSH format).`);
        unsupportedKeys.push({
          name: entryName,
          reason: "invalid private key format"
        });
      }
    }
  }
  if (options.environmentOnly) {
    return { keys: privateKeys, passphraseProtectedKeys, unsupportedKeys };
  }
  const sshDir = import_node_path3.default.join(import_node_os3.default.homedir(), ".ssh");
  if (!import_node_fs.existsSync(sshDir)) {
    return { keys: privateKeys, passphraseProtectedKeys, unsupportedKeys };
  }
  const files = await import_promises3.default.readdir(sshDir);
  const knownFiles = SSH_KEY_FILES.filter((f) => files.includes(f));
  const otherFiles = files.filter((f) => !SSH_KEY_FILES.includes(f) && !f.endsWith(".pub") && !f.startsWith("known_hosts") && !f.startsWith("authorized_keys") && f !== "config");
  for (const fileName of [...knownFiles, ...otherFiles]) {
    const filePath = import_node_path3.default.join(sshDir, fileName);
    let stat;
    try {
      stat = await import_promises3.default.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile())
      continue;
    let keyContent;
    try {
      keyContent = await import_promises3.default.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    if (!keyContent.includes("PRIVATE KEY"))
      continue;
    if (isPassphraseProtected(keyContent)) {
      if (privateKeyPassphrase === undefined) {
        passphraseProtectedKeys.push(fileName);
        unsupportedKeys.push({
          name: fileName,
          reason: "passphrase-protected"
        });
        continue;
      }
      const decryptedPrivateKey = await parsePassphraseProtectedPrivateKey(keyContent, privateKeyPassphrase);
      if (!decryptedPrivateKey) {
        passphraseProtectedKeys.push(fileName);
        unsupportedKeys.push({
          name: fileName,
          reason: "passphrase-protected (failed to decrypt with DOTENC_PRIVATE_KEY_PASSPHRASE)"
        });
        continue;
      }
      const algorithm2 = detectAlgorithm(decryptedPrivateKey);
      if (!algorithm2) {
        unsupportedKeys.push({
          name: fileName,
          reason: describeUnsupportedAlgorithm(decryptedPrivateKey.asymmetricKeyType)
        });
        continue;
      }
      const entry2 = {
        name: fileName,
        privateKey: decryptedPrivateKey,
        fingerprint: getKeyFingerprint(decryptedPrivateKey),
        algorithm: algorithm2
      };
      if (algorithm2 === "ed25519") {
        const { rawPublicKey } = extractEd25519RawKeys(decryptedPrivateKey);
        entry2.rawPublicKey = rawPublicKey;
      }
      privateKeys.push(entry2);
      continue;
    }
    const privateKey = tryParsePrivateKey(keyContent);
    if (!privateKey) {
      const unsupportedOpenSSHType = detectUnsupportedOpenSSHAlgorithm(keyContent);
      unsupportedKeys.push({
        name: fileName,
        reason: unsupportedOpenSSHType ? describeUnsupportedAlgorithm(unsupportedOpenSSHType) : "invalid private key format"
      });
      continue;
    }
    const algorithm = detectAlgorithm(privateKey);
    if (!algorithm) {
      unsupportedKeys.push({
        name: fileName,
        reason: describeUnsupportedAlgorithm(privateKey.asymmetricKeyType)
      });
      continue;
    }
    const entry = {
      name: fileName,
      privateKey,
      fingerprint: getKeyFingerprint(privateKey),
      algorithm
    };
    if (algorithm === "ed25519") {
      const { rawPublicKey } = extractEd25519RawKeys(privateKey);
      entry.rawPublicKey = rawPublicKey;
    }
    privateKeys.push(entry);
  }
  return { keys: privateKeys, passphraseProtectedKeys, unsupportedKeys };
};

// cli/src/helpers/decryptEnvironment.ts
var defaultDecryptEnvironmentDataDeps = {
  getPrivateKeys,
  decryptDataKey,
  decryptData
};
var unwrapEnvironmentDataKey = async (environment, deps) => {
  const { keys: availablePrivateKeys, passphraseProtectedKeys } = await deps.getPrivateKeys();
  if (!availablePrivateKeys.length) {
    if (passphraseProtectedKeys.length > 0) {
      throw new Error(passphraseProtectedKeyError(passphraseProtectedKeys));
    }
    throw new Error("No private keys found. Please ensure you have SSH keys in ~/.ssh/ or set DOTENC_PRIVATE_KEY_BASE64.");
  }
  let grantedKey;
  let selectedPrivateKey;
  for (const privateKeyEntry of availablePrivateKeys) {
    grantedKey = environment.keys.find((key) => {
      return key.fingerprint === privateKeyEntry.fingerprint;
    });
    if (grantedKey) {
      selectedPrivateKey = privateKeyEntry;
      break;
    }
  }
  if (!grantedKey || !selectedPrivateKey) {
    throw new Error("Access denied to the environment.");
  }
  let dataKey;
  try {
    dataKey = deps.decryptDataKey(selectedPrivateKey, Buffer.from(grantedKey.encryptedDataKey, "base64"));
  } catch (error) {
    throw new Error("Failed to decrypt the data key.", { cause: error });
  }
  if (dataKey.byteLength !== 32) {
    dataKey.fill(0);
    throw new Error("Failed to decrypt the data key.");
  }
  return dataKey;
};
var environmentDataKeysEqual = async (base, head, deps = defaultDecryptEnvironmentDataDeps) => {
  let baseDataKey;
  let headDataKey;
  try {
    baseDataKey = await unwrapEnvironmentDataKey(base, deps);
    headDataKey = await unwrapEnvironmentDataKey(head, deps);
    return import_node_crypto7.timingSafeEqual(baseDataKey, headDataKey);
  } finally {
    baseDataKey?.fill(0);
    headDataKey?.fill(0);
  }
};
var decryptEnvironmentData = async (environmentName, environment, deps = defaultDecryptEnvironmentDataDeps) => {
  const dataKey = await unwrapEnvironmentDataKey(environment, deps);
  const aad = (environment.version ?? 1) >= 2 ? Buffer.from(environmentName, "utf-8") : undefined;
  try {
    return await deps.decryptData(dataKey, Buffer.from(environment.encryptedContent, "base64"), aad);
  } finally {
    dataKey.fill(0);
  }
};
var defaultDecryptEnvironmentDeps = {
  ...defaultDecryptEnvironmentDataDeps,
  getEnvironmentByName,
  logError: (message) => console.error(message)
};

// cli/src/helpers/parseEnv.ts
var import_node_util = require("node:util");
var parseEnv = (lines) => {
  const parsed = import_node_util.parseEnv(lines);
  const env2 = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      env2[key] = value;
    }
  }
  return env2;
};

// cli/src/helpers/createEnvironmentDiffReport.ts
class EnvironmentDiffInputError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "EnvironmentDiffInputError";
    this.code = code;
  }
}
var ENVIRONMENT_DIFF_REASON_MESSAGES = Object.freeze({
  base_environment_invalid: "Variable diff unavailable because the base environment is invalid.",
  head_environment_invalid: "Variable diff unavailable because the head environment is invalid.",
  base_and_head_environments_invalid: "Variable diff unavailable because the base and head environments are invalid.",
  base_recipient_metadata_invalid: "Access diff unavailable because the base recipient metadata is invalid.",
  head_recipient_metadata_invalid: "Access diff unavailable because the head recipient metadata is invalid.",
  base_and_head_recipient_metadata_invalid: "Access diff unavailable because the base and head recipient metadata is invalid.",
  base_decryption_failed: "Variable diff unavailable because the base environment could not be decrypted.",
  head_decryption_failed: "Variable diff unavailable because the head environment could not be decrypted.",
  base_and_head_decryption_failed: "Variable diff unavailable because the base and head environments could not be decrypted.",
  base_plaintext_invalid: "Variable diff unavailable because the decrypted base content is not a supported dotenv document.",
  head_plaintext_invalid: "Variable diff unavailable because the decrypted head content is not a supported dotenv document.",
  base_and_head_plaintexts_invalid: "Variable diff unavailable because the decrypted base and head content is not supported dotenv.",
  base_and_head_variables_unavailable: "Variable diff unavailable on both sides."
});
var emptyVariableChanges = () => ({
  added: [],
  changed: [],
  removed: []
});
var emptyAccessChanges = () => ({
  grants: [],
  revocations: [],
  renames: []
});
var isPlainRecord = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
var hasExactKeys = (value, required, optional = []) => {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string"))
    return false;
  const allowed = new Set([...required, ...optional]);
  const stringKeys = ownKeys;
  return required.every((key) => Object.hasOwn(value, key)) && stringKeys.every((key) => allowed.has(key));
};
var compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var containsControlCharacters = (value) => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127)
      return true;
  }
  return false;
};
var isBoundedText = (value, maximumBytes) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf-8") <= maximumBytes && !containsControlCharacters(value);
var isCanonicalBase64 = (value, maximumBytes) => {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf-8") > maximumBytes || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value;
};
var parseEnvironmentPath = (filePath) => {
  if (filePath.length === 0 || Buffer.byteLength(filePath, "utf-8") > ENVIRONMENT_DIFF_LIMITS.maxPathBytes || containsControlCharacters(filePath) || filePath.startsWith("/") || filePath.includes("\\")) {
    return null;
  }
  const segments = filePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  const fileName = segments.at(-1);
  const match = fileName?.match(/^\.env\.(.+)\.enc$/);
  if (!match)
    return null;
  const environmentName = match[1];
  if (Buffer.byteLength(environmentName, "utf-8") > ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes) {
    return null;
  }
  return environmentName;
};
var inputError = (code, message) => {
  throw new EnvironmentDiffInputError(code, message);
};
var validateInputFiles = (value, seenPaths) => {
  if (!Array.isArray(value)) {
    return inputError("invalid_request", "Diff input must contain base and head file arrays.");
  }
  if (value.length > ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide) {
    return inputError("too_many_files", "Diff input exceeds the file-count limit.");
  }
  return value.map((candidate) => {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["path", "content"]) || typeof candidate.path !== "string" || typeof candidate.content !== "string") {
      return inputError("invalid_request", "Each diff input file must contain only string path and content fields.");
    }
    const name = parseEnvironmentPath(candidate.path);
    if (!name) {
      return inputError("invalid_path", "Diff input contains an invalid encrypted-environment path.");
    }
    if (seenPaths.has(candidate.path)) {
      return inputError("duplicate_path", "Diff input contains a duplicate path on one side.");
    }
    seenPaths.add(candidate.path);
    if (Buffer.byteLength(candidate.content, "utf-8") > ENVIRONMENT_DIFF_LIMITS.maxFileBytes) {
      return inputError("file_too_large", "An encrypted environment exceeds the per-file byte limit.");
    }
    return { path: candidate.path, content: candidate.content, name };
  });
};
var validateInput = (input) => {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["base", "head"])) {
    return inputError("invalid_request", "Diff input must contain only base and head file arrays.");
  }
  const base = validateInputFiles(input.base, new Set);
  const head = validateInputFiles(input.head, new Set);
  const totalBytes = [...base, ...head].reduce((total, file) => total + Buffer.byteLength(file.path, "utf-8") + Buffer.byteLength(file.content, "utf-8"), 0);
  if (totalBytes > ENVIRONMENT_DIFF_LIMITS.maxTotalBytes) {
    return inputError("input_too_large", "Diff input exceeds the total byte limit.");
  }
  return { base, head };
};

class InvalidJsonEnvelope extends Error {
}
var scanJsonMembers = (source) => {
  let offset = 0;
  let hasDuplicates = false;
  let recipientMetadataAmbiguous = false;
  const skipWhitespace = () => {
    while (offset < source.length && /\s/.test(source[offset]))
      offset += 1;
  };
  const parseString = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === "\\") {
        offset += 2;
        continue;
      }
      if (source[offset] === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      }
      offset += 1;
    }
    throw new InvalidJsonEnvelope;
  };
  const parsePrimitive = () => {
    const start = offset;
    while (offset < source.length && !/[\s,\]}]/.test(source[offset])) {
      offset += 1;
    }
    if (offset === start)
      throw new InvalidJsonEnvelope;
  };
  const parseValue = (depth, location) => {
    if (depth > ENVIRONMENT_DIFF_LIMITS.maxJsonDepth) {
      throw new InvalidJsonEnvelope;
    }
    skipWhitespace();
    const token = source[offset];
    if (token === '"') {
      parseString();
      return;
    }
    if (token === "{") {
      offset += 1;
      skipWhitespace();
      const members = new Set;
      if (source[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        skipWhitespace();
        if (source[offset] !== '"')
          throw new InvalidJsonEnvelope;
        const member = parseString();
        if (members.has(member)) {
          hasDuplicates = true;
          if (location === "recipients" || location === "root" && member === "keys") {
            recipientMetadataAmbiguous = true;
          }
        }
        members.add(member);
        skipWhitespace();
        if (source[offset] !== ":")
          throw new InvalidJsonEnvelope;
        offset += 1;
        const memberLocation = location === "recipients" || location === "root" && member === "keys" ? "recipients" : "other";
        parseValue(depth + 1, memberLocation);
        skipWhitespace();
        if (source[offset] === "}") {
          offset += 1;
          return;
        }
        if (source[offset] !== ",")
          throw new InvalidJsonEnvelope;
        offset += 1;
      }
      throw new InvalidJsonEnvelope;
    }
    if (token === "[") {
      offset += 1;
      skipWhitespace();
      if (source[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        parseValue(depth + 1, location);
        skipWhitespace();
        if (source[offset] === "]") {
          offset += 1;
          return;
        }
        if (source[offset] !== ",")
          throw new InvalidJsonEnvelope;
        offset += 1;
      }
      throw new InvalidJsonEnvelope;
    }
    parsePrimitive();
  };
  parseValue(0, "root");
  skipWhitespace();
  if (offset !== source.length)
    throw new InvalidJsonEnvelope;
  return { hasDuplicates, recipientMetadataAmbiguous };
};
var parseRecipientMetadata = (raw) => {
  if (!isPlainRecord(raw) || !Array.isArray(raw.keys)) {
    return { status: "invalid" };
  }
  if (raw.keys.length === 0 || raw.keys.length > ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment) {
    return { status: "invalid" };
  }
  const recipients = [];
  const fingerprints = new Set;
  const names = new Set;
  for (const candidate of raw.keys) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, [
      "name",
      "fingerprint",
      "encryptedDataKey",
      "algorithm"
    ]) || !isBoundedText(candidate.name, ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes) || !isBoundedText(candidate.fingerprint, ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes)) {
      return { status: "invalid" };
    }
    if (fingerprints.has(candidate.fingerprint) || names.has(candidate.name)) {
      return { status: "invalid" };
    }
    fingerprints.add(candidate.fingerprint);
    names.add(candidate.name);
    recipients.push({
      name: candidate.name,
      fingerprint: candidate.fingerprint
    });
  }
  return { status: "valid", recipients };
};
var hasValidRecipientWrapping = (raw) => {
  if (!isPlainRecord(raw) || !Array.isArray(raw.keys))
    return false;
  return raw.keys.every((candidate) => isPlainRecord(candidate) && hasExactKeys(candidate, [
    "name",
    "fingerprint",
    "encryptedDataKey",
    "algorithm"
  ]) && isCanonicalBase64(candidate.encryptedDataKey, ENVIRONMENT_DIFF_LIMITS.maxEncryptedDataKeyBytes) && (candidate.algorithm === "rsa" || candidate.algorithm === "ed25519"));
};
var parseEnvironment = (content) => {
  let raw;
  let jsonScan;
  try {
    jsonScan = scanJsonMembers(content);
    raw = JSON.parse(content);
  } catch {
    return {
      access: { status: "invalid" },
      environment: { status: "invalid" }
    };
  }
  const access = jsonScan.recipientMetadataAmbiguous ? { status: "invalid" } : parseRecipientMetadata(raw);
  if (jsonScan.hasDuplicates || !isPlainRecord(raw) || !hasExactKeys(raw, ["keys", "encryptedContent"], ["version"]) || raw.version !== undefined && raw.version !== 1 && raw.version !== 2 || !hasValidRecipientWrapping(raw) || !isCanonicalBase64(raw.encryptedContent, ENVIRONMENT_DIFF_LIMITS.maxFileBytes) || access.status === "invalid") {
    return { access, environment: { status: "invalid" } };
  }
  const parsed = environmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { access, environment: { status: "invalid" } };
  }
  return {
    access,
    environment: { status: "valid", value: parsed.data }
  };
};

class InvalidPlaintext extends Error {
}
var findClosingQuote = (value, quote, start) => value.indexOf(quote, start);
var detectDuplicateDotenvVariables = (plaintext) => {
  const declarations = new Set;
  let openQuote;
  for (const rawLine of plaintext.split(`
`)) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (openQuote) {
      if (findClosingQuote(line, openQuote, 0) !== -1)
        openQuote = undefined;
      continue;
    }
    let declaration = line.trimStart();
    if (declaration.length === 0 || declaration.startsWith("#"))
      continue;
    if (/^export[ \t]+/.test(declaration)) {
      declaration = declaration.replace(/^export[ \t]+/, "");
    }
    const equalsIndex = declaration.indexOf("=");
    if (equalsIndex <= 0)
      continue;
    const name = declaration.slice(0, equalsIndex).trim();
    if (name.length === 0)
      continue;
    if (declarations.has(name))
      throw new InvalidPlaintext;
    declarations.add(name);
    const value = declaration.slice(equalsIndex + 1).trimStart();
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === "`") && findClosingQuote(value, quote, 1) === -1) {
      openQuote = quote;
    }
  }
  if (openQuote)
    throw new InvalidPlaintext;
  return declarations;
};
var parsePlaintextVariables = (plaintext) => {
  if (typeof plaintext !== "string" || Buffer.byteLength(plaintext, "utf-8") > ENVIRONMENT_DIFF_LIMITS.maxPlaintextBytes) {
    throw new InvalidPlaintext;
  }
  const declarations = detectDuplicateDotenvVariables(plaintext);
  let parsed;
  try {
    parsed = parseEnv(plaintext);
  } catch {
    throw new InvalidPlaintext;
  }
  const entries = Object.entries(parsed);
  if (entries.length > ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment) {
    throw new InvalidPlaintext;
  }
  const variables = new Map;
  for (const [name, value] of entries) {
    if (Buffer.byteLength(name, "utf-8") > ENVIRONMENT_DIFF_LIMITS.maxVariableNameBytes || containsControlCharacters(name)) {
      throw new InvalidPlaintext;
    }
    variables.set(name, value);
  }
  for (const declaration of declarations) {
    if (!variables.has(declaration))
      throw new InvalidPlaintext;
  }
  return variables;
};
var createDefaultCrypto = (privateKeySource) => {
  let privateKeysPromise;
  const loadPrivateKeys = () => {
    privateKeysPromise ??= getPrivateKeys({
      environmentOnly: privateKeySource === "environment",
      environmentKeyErrorMode: "collect",
      logError: () => {}
    });
    return privateKeysPromise;
  };
  return {
    decryptEnvironment: (environmentName, environment) => decryptEnvironmentData(environmentName, environment, {
      getPrivateKeys: loadPrivateKeys,
      decryptDataKey,
      decryptData
    }),
    dataKeysEqual: (base, head) => environmentDataKeysEqual(base, head, {
      getPrivateKeys: loadPrivateKeys,
      decryptDataKey
    })
  };
};
var readVariables = async (parsed, environmentName, decryptEnvironment) => {
  if (!parsed) {
    return { status: "available", plaintext: "", variables: new Map };
  }
  if (parsed.environment.status === "invalid") {
    return { status: "unavailable", kind: "environment" };
  }
  let plaintext;
  try {
    plaintext = await decryptEnvironment(environmentName, parsed.environment.value);
  } catch {
    return { status: "unavailable", kind: "decryption" };
  }
  try {
    return {
      status: "available",
      plaintext,
      variables: parsePlaintextVariables(plaintext)
    };
  } catch {
    return { status: "unavailable", kind: "plaintext" };
  }
};
var reason = (code) => ({
  code,
  message: ENVIRONMENT_DIFF_REASON_MESSAGES[code]
});
var variableFailureReason = (base, head) => {
  const baseKind = base.status === "unavailable" ? base.kind : undefined;
  const headKind = head.status === "unavailable" ? head.kind : undefined;
  if (baseKind && headKind) {
    if (baseKind !== headKind)
      return reason("base_and_head_variables_unavailable");
    if (baseKind === "environment") {
      return reason("base_and_head_environments_invalid");
    }
    if (baseKind === "decryption") {
      return reason("base_and_head_decryption_failed");
    }
    return reason("base_and_head_plaintexts_invalid");
  }
  if (baseKind === "environment")
    return reason("base_environment_invalid");
  if (headKind === "environment")
    return reason("head_environment_invalid");
  if (baseKind === "decryption")
    return reason("base_decryption_failed");
  if (headKind === "decryption")
    return reason("head_decryption_failed");
  if (baseKind === "plaintext")
    return reason("base_plaintext_invalid");
  return reason("head_plaintext_invalid");
};
var createVariableDiff = (base, head) => {
  if (base.status === "unavailable" || head.status === "unavailable") {
    return {
      status: "unavailable",
      ...emptyVariableChanges(),
      reason: variableFailureReason(base, head)
    };
  }
  const added = [];
  const changed = [];
  const removed = [];
  const names = new Set([...base.variables.keys(), ...head.variables.keys()]);
  for (const name of [...names].sort(compareText)) {
    const hadBase = base.variables.has(name);
    const hasHead = head.variables.has(name);
    if (!hadBase && hasHead)
      added.push(name);
    else if (hadBase && !hasHead)
      removed.push(name);
    else if (base.variables.get(name) !== head.variables.get(name)) {
      changed.push(name);
    }
  }
  return { status: "available", added, changed, removed };
};
var createAccessDiff = (base, head) => {
  const baseInvalid = base?.access.status === "invalid";
  const headInvalid = head?.access.status === "invalid";
  if (baseInvalid || headInvalid) {
    const code = baseInvalid && headInvalid ? "base_and_head_recipient_metadata_invalid" : baseInvalid ? "base_recipient_metadata_invalid" : "head_recipient_metadata_invalid";
    return {
      status: "unavailable",
      ...emptyAccessChanges(),
      reason: reason(code)
    };
  }
  const baseRecipients = base?.access.status === "valid" ? base.access.recipients : [];
  const headRecipients = head?.access.status === "valid" ? head.access.recipients : [];
  const baseByFingerprint = new Map(baseRecipients.map((recipient) => [recipient.fingerprint, recipient]));
  const headByFingerprint = new Map(headRecipients.map((recipient) => [recipient.fingerprint, recipient]));
  const grants = headRecipients.filter((recipient) => !baseByFingerprint.has(recipient.fingerprint)).map((recipient) => ({ ...recipient })).sort((left, right) => compareText(left.fingerprint, right.fingerprint) || compareText(left.name, right.name));
  const revocations = baseRecipients.filter((recipient) => !headByFingerprint.has(recipient.fingerprint)).map((recipient) => ({ ...recipient })).sort((left, right) => compareText(left.fingerprint, right.fingerprint) || compareText(left.name, right.name));
  const renames = headRecipients.flatMap((recipient) => {
    const previous = baseByFingerprint.get(recipient.fingerprint);
    return previous && previous.name !== recipient.name ? [
      {
        fingerprint: recipient.fingerprint,
        from: previous.name,
        to: recipient.name
      }
    ] : [];
  }).sort((left, right) => compareText(left.fingerprint, right.fingerprint));
  return { status: "available", grants, revocations, renames };
};
var hasVariableChanges = (diff) => diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;
var hasAccessChanges = (diff) => diff.grants.length > 0 || diff.revocations.length > 0 || diff.renames.length > 0;
var hasUnchangedRotationMetadata = (base, head) => {
  if (!base || !head || base.environment.status !== "valid" || head.environment.status !== "valid") {
    return false;
  }
  const baseEnvironment = base.environment.value;
  const headEnvironment = head.environment.value;
  if ((baseEnvironment.version ?? 1) !== (headEnvironment.version ?? 1) || baseEnvironment.keys.length !== headEnvironment.keys.length) {
    return false;
  }
  const headByFingerprint = new Map(headEnvironment.keys.map((recipient) => [recipient.fingerprint, recipient]));
  return baseEnvironment.keys.every((baseRecipient) => {
    const headRecipient = headByFingerprint.get(baseRecipient.fingerprint);
    return headRecipient !== undefined && headRecipient.name === baseRecipient.name && headRecipient.algorithm === baseRecipient.algorithm;
  });
};
var haveAllRecipientWrappersChanged = (base, head) => {
  const headByFingerprint = new Map(head.keys.map((recipient) => [recipient.fingerprint, recipient]));
  return base.keys.every((baseRecipient) => headByFingerprint.get(baseRecipient.fingerprint)?.encryptedDataKey !== baseRecipient.encryptedDataKey);
};
var isVerifiedDataKeyOnlyChange = async (baseParsed, headParsed, baseVariables, headVariables, dataKeysEqual) => {
  if (!dataKeysEqual || baseVariables.status !== "available" || headVariables.status !== "available" || baseVariables.plaintext !== headVariables.plaintext || !hasUnchangedRotationMetadata(baseParsed, headParsed) || !baseParsed || !headParsed || baseParsed.environment.status !== "valid" || headParsed.environment.status !== "valid") {
    return false;
  }
  let keysAreEqual;
  try {
    keysAreEqual = await dataKeysEqual(baseParsed.environment.value, headParsed.environment.value);
  } catch {
    throw new Error("Data key comparison could not be completed safely.");
  }
  if (keysAreEqual !== true && keysAreEqual !== false) {
    throw new Error("Data key comparison could not be completed safely.");
  }
  if (keysAreEqual)
    return false;
  if (!haveAllRecipientWrappersChanged(baseParsed.environment.value, headParsed.environment.value)) {
    throw new Error("Data key rotation could not be verified safely.");
  }
  return true;
};
var createEnvironmentDiffReport = async (input, options = {}) => {
  const validated = validateInput(input);
  const baseByPath = new Map(validated.base.map((file) => [file.path, file]));
  const headByPath = new Map(validated.head.map((file) => [file.path, file]));
  const paths = [...new Set([...baseByPath.keys(), ...headByPath.keys()])].sort(compareText);
  const defaultCrypto = options.decryptEnvironment ? undefined : createDefaultCrypto(options.privateKeySource ?? "all");
  const decryptEnvironment = options.decryptEnvironment ?? defaultCrypto?.decryptEnvironment;
  if (!decryptEnvironment) {
    throw new Error("Environment diff decryptor is unavailable.");
  }
  const dataKeysEqual = options.dataKeysEqual ?? defaultCrypto?.dataKeysEqual;
  const environments = [];
  for (const filePath of paths) {
    const baseFile = baseByPath.get(filePath);
    const headFile = headByPath.get(filePath);
    if (baseFile && headFile && baseFile.content === headFile.content)
      continue;
    const environmentName = (headFile ?? baseFile)?.name;
    if (!environmentName)
      continue;
    const status = !baseFile ? "added" : !headFile ? "deleted" : "modified";
    const baseParsed = baseFile ? parseEnvironment(baseFile.content) : undefined;
    const headParsed = headFile ? parseEnvironment(headFile.content) : undefined;
    const [baseVariables, headVariables] = await Promise.all([
      readVariables(baseParsed, environmentName, decryptEnvironment),
      readVariables(headParsed, environmentName, decryptEnvironment)
    ]);
    const variables = createVariableDiff(baseVariables, headVariables);
    const access = createAccessDiff(baseParsed, headParsed);
    if (status === "modified" && variables.status === "available" && access.status === "available" && !hasVariableChanges(variables) && !hasAccessChanges(access)) {
      const verifiedDataKeyOnlyChange = await isVerifiedDataKeyOnlyChange(baseParsed, headParsed, baseVariables, headVariables, dataKeysEqual);
      if (!verifiedDataKeyOnlyChange)
        continue;
    }
    environments.push({
      path: filePath,
      name: environmentName,
      status,
      variables,
      access
    });
  }
  return {
    schemaVersion: ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION,
    environments
  };
};

// actions/diff/src/action-io.ts
var import_promises4 = __toESM(require("node:fs/promises"));

// actions/diff/src/safety.ts
var import_node_buffer2 = require("node:buffer");

class SafeActionError extends Error {
  code;
  constructor(code) {
    super("The redacted dotenc diff could not be completed safely.");
    this.name = "SafeActionError";
    this.code = code;
  }
}
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var byteLength = (value) => import_node_buffer2.Buffer.byteLength(value, "utf8");
var assertBoundedString = (value, maxBytes, code) => {
  if (typeof value !== "string" || byteLength(value) > maxBytes) {
    throw new SafeActionError(code);
  }
  return value;
};
var isFullGitObjectId = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
var parseBoolean = (value, code) => {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  throw new SafeActionError(code);
};
var escapeWorkflowCommand = (value) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll(`
`, "%0A");
var escapeMarkdown = (value, maxCodePoints = 512) => {
  const visible = Array.from(value).slice(0, maxCodePoints).map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127 || /[\p{C}\p{Zl}\p{Zp}]/u.test(character)) {
      return `U${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    }
    return character;
  }).join("");
  const truncated = Array.from(value).length > maxCodePoints ? "…" : "";
  return `${visible}${truncated}`.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/([\\`*_[\]{}()#+\-.!|])/g, "\\$1").replaceAll("@", "&#64;");
};

// actions/diff/src/action-io.ts
var inputEnvironmentName = (name) => `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
var defaultActionIo = {
  getInput(name) {
    return process.env[inputEnvironmentName(name)]?.trim() ?? "";
  },
  async setOutput(name, value) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || /[\r\n]/.test(value)) {
      throw new SafeActionError("invalid_action_output");
    }
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath)
      throw new SafeActionError("missing_action_output");
    await import_promises4.default.appendFile(outputPath, `${name}=${value}
`, "utf8");
  },
  async writeSummary(markdown) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath)
      throw new SafeActionError("missing_step_summary");
    await import_promises4.default.appendFile(summaryPath, markdown, "utf8");
  },
  annotate(level, message) {
    const command = level === "error" ? "error" : "warning";
    console.error(`::${command}::${escapeWorkflowCommand(message)}`);
  }
};

// actions/diff/src/context.ts
var import_promises5 = __toESM(require("node:fs/promises"));

// actions/diff/src/limits.ts
var ACTION_LIMITS = Object.freeze({
  eventBytes: 2 * 1024 * 1024,
  commitResponseBytes: 256 * 1024,
  treeResponseBytes: 8 * 1024 * 1024,
  commentResponseBytes: 8 * 1024 * 1024,
  commentWriteResponseBytes: 512 * 1024,
  maxTreeEntries: 1e5,
  maxEnvironmentFilesPerSide: ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide,
  maxEnvironmentFileBytes: ENVIRONMENT_DIFF_LIMITS.maxFileBytes,
  maxEnvironmentBytesPerSide: ENVIRONMENT_DIFF_LIMITS.maxTotalBytes,
  maxEnvironmentBytesTotal: ENVIRONMENT_DIFF_LIMITS.maxTotalBytes,
  maxPathBytes: ENVIRONMENT_DIFF_LIMITS.maxPathBytes,
  maxEnvironmentNameBytes: ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes,
  maxCommentPages: 10,
  commentsPerPage: 100,
  maxCommentBytes: 60 * 1024,
  maxReportOutputBytes: 512 * 1024,
  maxPrivateKeyBase64Bytes: 512 * 1024,
  maxPassphraseBytes: 16 * 1024,
  requestTimeoutMs: 30000
});

// actions/diff/src/context.ts
var validateRepository = (value) => {
  const repository = assertBoundedString(value, 201, "invalid_event");
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !part || part.length > 100 || !/[a-z0-9]/i.test(part) || !/^[a-z0-9_.-]+$/i.test(part))) {
    throw new SafeActionError("invalid_event");
  }
  return repository;
};
var parsePullRequestEvent = (payload) => {
  if (!isRecord(payload) || !isRecord(payload.pull_request)) {
    throw new SafeActionError("invalid_event");
  }
  const pullRequest = payload.pull_request;
  if (!isRecord(payload.repository) || !isRecord(pullRequest.base) || !isRecord(pullRequest.head)) {
    throw new SafeActionError("invalid_event");
  }
  const repository = validateRepository(payload.repository.full_name);
  const pullRequestNumber = payload.number;
  const baseSha = pullRequest.base.sha;
  const headSha = pullRequest.head.sha;
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 || pullRequestNumber > 2147483647 || !isFullGitObjectId(baseSha) || !isFullGitObjectId(headSha)) {
    throw new SafeActionError("invalid_event");
  }
  if (pullRequest.number !== undefined && pullRequest.number !== pullRequestNumber) {
    throw new SafeActionError("invalid_event");
  }
  return {
    repository,
    pullRequestNumber,
    baseSha: baseSha.toLowerCase(),
    headSha: headSha.toLowerCase()
  };
};
var readPullRequestEvent = async (eventPath, limits = ACTION_LIMITS) => {
  if (!eventPath)
    throw new SafeActionError("missing_event");
  let raw;
  try {
    const stat = await import_promises5.default.stat(eventPath);
    if (!stat.isFile() || stat.size > limits.eventBytes) {
      throw new SafeActionError("invalid_event");
    }
    raw = await import_promises5.default.readFile(eventPath, "utf8");
  } catch (error) {
    if (error instanceof SafeActionError)
      throw error;
    throw new SafeActionError("invalid_event");
  }
  if (byteLength(raw) > limits.eventBytes) {
    throw new SafeActionError("invalid_event");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new SafeActionError("invalid_event");
  }
  return parsePullRequestEvent(payload);
};

// actions/diff/src/github.ts
var import_node_buffer3 = require("node:buffer");
var import_node_crypto8 = require("node:crypto");
var API_VERSION = "2022-11-28";
var environmentPathPattern = /^\.env\..+\.enc$/;
var isEnvironmentPath = (filePath) => {
  const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
  return environmentPathPattern.test(basename);
};
var hasAsciiControl = (value) => Array.from(value).some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
});
var validatePath = (value, limits) => {
  const filePath = assertBoundedString(value, limits.maxPathBytes, "invalid_tree");
  if (!filePath || filePath.startsWith("/") || filePath.includes("\\") || hasAsciiControl(filePath) || filePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new SafeActionError("invalid_tree");
  }
  return filePath;
};
var decodeBase64 = (value) => {
  if (typeof value !== "string") {
    throw new SafeActionError("invalid_blob");
  }
  const normalized = value.replace(/\s/g, "");
  if (!normalized || !/^[a-z0-9+/]*={0,2}$/i.test(normalized) || normalized.length % 4 === 1) {
    throw new SafeActionError("invalid_blob");
  }
  const decoded = import_node_buffer3.Buffer.from(normalized, "base64");
  const inputWithoutPadding = normalized.replace(/=+$/, "");
  const roundTrip = decoded.toString("base64").replace(/=+$/, "");
  if (inputWithoutPadding !== roundTrip) {
    throw new SafeActionError("invalid_blob");
  }
  return decoded;
};
var verifyGitBlob = (expectedSha, content) => {
  const actualSha = import_node_crypto8.createHash("sha1").update(`blob ${content.byteLength}\x00`, "utf8").update(content).digest("hex");
  if (actualSha !== expectedSha.toLowerCase()) {
    throw new SafeActionError("blob_identity_mismatch");
  }
};
var readBoundedResponse = async (response, maxBytes) => {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new SafeActionError("github_response_too_large");
    }
  }
  if (!response.body)
    return new Uint8Array;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SafeActionError("github_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return import_node_buffer3.Buffer.concat(chunks, total);
};

class GitHubApiError extends SafeActionError {
  status;
  constructor(status) {
    super("github_request_failed");
    this.name = "GitHubApiError";
    this.status = status;
  }
}

class GitHubClient {
  #token;
  #owner;
  #repo;
  #apiUrl;
  #fetch;
  #limits;
  #blobContentBySha = new Map;
  constructor(options) {
    if (!options.token || byteLength(options.token) > 4096 || Array.from(options.token).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 32 || codePoint === 127;
    })) {
      throw new SafeActionError("invalid_token");
    }
    const repositoryParts = options.repository.split("/");
    if (repositoryParts.length !== 2) {
      throw new SafeActionError("invalid_repository");
    }
    this.#owner = repositoryParts[0];
    this.#repo = repositoryParts[1];
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#limits = options.limits ?? ACTION_LIMITS;
    try {
      this.#apiUrl = new URL(options.apiUrl ?? "https://api.github.com");
    } catch {
      throw new SafeActionError("invalid_api_url");
    }
    if (this.#apiUrl.protocol !== "https:" || this.#apiUrl.username || this.#apiUrl.password || this.#apiUrl.search || this.#apiUrl.hash) {
      throw new SafeActionError("invalid_api_url");
    }
  }
  #endpoint(pathname) {
    const basePath = this.#apiUrl.pathname.replace(/\/$/, "");
    const url = new URL(this.#apiUrl);
    const queryIndex = pathname.indexOf("?");
    const pathOnly = queryIndex === -1 ? pathname : pathname.slice(0, queryIndex);
    url.pathname = `${basePath}${pathOnly}`;
    url.search = queryIndex === -1 ? "" : pathname.slice(queryIndex);
    return url;
  }
  #repositoryPath() {
    return `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repo)}`;
  }
  async#requestJson(pathname, maxResponseBytes, init = {}) {
    const response = await this.#request(pathname, init);
    const body = await readBoundedResponse(response, maxResponseBytes);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      throw new SafeActionError("invalid_github_response");
    }
  }
  async#request(pathname, init = {}) {
    let response;
    try {
      response = await this.#fetch(this.#endpoint(pathname), {
        method: init.method ?? "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
          "User-Agent": "dotenc-diff-action",
          "X-GitHub-Api-Version": API_VERSION
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "error",
        signal: AbortSignal.timeout(this.#limits.requestTimeoutMs)
      });
    } catch {
      throw new SafeActionError("github_unavailable");
    }
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {}
      throw new GitHubApiError(response.status);
    }
    return response;
  }
  async#requestNoContent(pathname, init) {
    const response = await this.#request(pathname, init);
    if (response.status !== 204) {
      try {
        await response.body?.cancel();
      } catch {}
      throw new SafeActionError("invalid_github_response");
    }
    await readBoundedResponse(response, 0);
  }
  async#getTreeSha(commitSha) {
    const response = await this.#requestJson(`${this.#repositoryPath()}/git/commits/${commitSha}`, this.#limits.commitResponseBytes);
    if (!isRecord(response) || !isFullGitObjectId(response.sha) || response.sha.toLowerCase() !== commitSha || !isRecord(response.tree) || !isFullGitObjectId(response.tree.sha)) {
      throw new SafeActionError("invalid_commit");
    }
    return response.tree.sha.toLowerCase();
  }
  async#getBlobDescriptors(commitSha) {
    if (!isFullGitObjectId(commitSha)) {
      throw new SafeActionError("invalid_commit");
    }
    const treeSha = await this.#getTreeSha(commitSha.toLowerCase());
    const response = await this.#requestJson(`${this.#repositoryPath()}/git/trees/${treeSha}?recursive=1`, this.#limits.treeResponseBytes);
    if (!isRecord(response) || response.truncated !== false || !isFullGitObjectId(response.sha) || response.sha.toLowerCase() !== treeSha || !Array.isArray(response.tree) || response.tree.length > this.#limits.maxTreeEntries) {
      throw new SafeActionError("invalid_tree");
    }
    const descriptors = [];
    const paths = new Set;
    let totalBytes = 0;
    for (const rawEntry of response.tree) {
      if (!isRecord(rawEntry) || typeof rawEntry.path !== "string") {
        throw new SafeActionError("invalid_tree");
      }
      if (!isEnvironmentPath(rawEntry.path))
        continue;
      const filePath = validatePath(rawEntry.path, this.#limits);
      const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
      const environmentName = basename.slice(5, -4);
      if (byteLength(environmentName) > this.#limits.maxEnvironmentNameBytes) {
        throw new SafeActionError("invalid_environment_blob");
      }
      if (rawEntry.type !== "blob" || rawEntry.mode !== "100644" && rawEntry.mode !== "100755" || !isFullGitObjectId(rawEntry.sha) || !Number.isSafeInteger(rawEntry.size) || rawEntry.size < 0 || rawEntry.size > this.#limits.maxEnvironmentFileBytes || paths.has(filePath)) {
        throw new SafeActionError("invalid_environment_blob");
      }
      totalBytes += rawEntry.size;
      if (descriptors.length >= this.#limits.maxEnvironmentFilesPerSide || totalBytes > this.#limits.maxEnvironmentBytesPerSide) {
        throw new SafeActionError("environment_limit_exceeded");
      }
      paths.add(filePath);
      descriptors.push({
        path: filePath,
        sha: rawEntry.sha.toLowerCase(),
        size: rawEntry.size
      });
    }
    return descriptors.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  }
  async#getBlob(descriptor) {
    const response = await this.#requestJson(`${this.#repositoryPath()}/git/blobs/${descriptor.sha}`, this.#limits.maxEnvironmentFileBytes * 2 + 64 * 1024);
    if (!isRecord(response) || response.encoding !== "base64" || !isFullGitObjectId(response.sha) || response.sha.toLowerCase() !== descriptor.sha || !Number.isSafeInteger(response.size) || response.size !== descriptor.size) {
      throw new SafeActionError("invalid_blob");
    }
    const content = decodeBase64(response.content);
    if (content.byteLength !== descriptor.size || content.byteLength > this.#limits.maxEnvironmentFileBytes) {
      throw new SafeActionError("invalid_blob");
    }
    verifyGitBlob(descriptor.sha, content);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new SafeActionError("invalid_blob");
    }
    return { path: descriptor.path, content: text };
  }
  async#loadBlobDescriptors(descriptors) {
    const environments = new Array(descriptors.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < descriptors.length) {
        const index = nextIndex;
        nextIndex += 1;
        const descriptor = descriptors[index];
        let content = this.#blobContentBySha.get(descriptor.sha);
        if (!content) {
          content = this.#getBlob(descriptor).then((blob) => blob.content);
          this.#blobContentBySha.set(descriptor.sha, content);
        }
        const resolvedContent = await content;
        if (byteLength(resolvedContent) !== descriptor.size) {
          throw new SafeActionError("invalid_blob");
        }
        environments[index] = {
          path: descriptor.path,
          content: resolvedContent
        };
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, descriptors.length) }, () => worker()));
    return environments;
  }
  async getEncryptedEnvironments(commitSha) {
    return this.#loadBlobDescriptors(await this.#getBlobDescriptors(commitSha));
  }
  async getEncryptedEnvironmentComparison(baseSha, headSha) {
    const [baseDescriptors, headDescriptors] = await Promise.all([
      this.#getBlobDescriptors(baseSha),
      this.#getBlobDescriptors(headSha)
    ]);
    const totalBytes = [...baseDescriptors, ...headDescriptors].reduce((total, descriptor) => total + descriptor.size + byteLength(descriptor.path), 0);
    if (totalBytes > this.#limits.maxEnvironmentBytesTotal) {
      throw new SafeActionError("environment_limit_exceeded");
    }
    const [base, head] = await Promise.all([
      this.#loadBlobDescriptors(baseDescriptors),
      this.#loadBlobDescriptors(headDescriptors)
    ]);
    return { base, head };
  }
  async#findPullRequestCommentIds(pullRequestNumber, marker) {
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 || !marker || byteLength(marker) > this.#limits.maxCommentBytes) {
      throw new SafeActionError("invalid_comment");
    }
    const commentIds = new Set;
    for (let page = 1;page <= this.#limits.maxCommentPages; page += 1) {
      const response = await this.#requestJson(`${this.#repositoryPath()}/issues/${pullRequestNumber}/comments?per_page=${this.#limits.commentsPerPage}&page=${page}`, this.#limits.commentResponseBytes);
      if (!Array.isArray(response) || response.length > this.#limits.commentsPerPage) {
        throw new SafeActionError("invalid_comments");
      }
      for (const comment of response) {
        if (isRecord(comment) && Number.isSafeInteger(comment.id) && comment.id > 0 && typeof comment.body === "string" && comment.body.startsWith(marker) && isRecord(comment.user) && comment.user.type === "Bot" && comment.user.login === "github-actions[bot]") {
          commentIds.add(comment.id);
        }
      }
      if (response.length < this.#limits.commentsPerPage) {
        return [...commentIds];
      }
      if (page === this.#limits.maxCommentPages) {
        throw new SafeActionError("comment_page_limit");
      }
    }
    return [...commentIds];
  }
  async#deletePullRequestCommentById(commentId) {
    await this.#requestNoContent(`${this.#repositoryPath()}/issues/comments/${commentId}`, { method: "DELETE" });
  }
  async upsertPullRequestComment(pullRequestNumber, marker, body) {
    if (!body.startsWith(marker) || byteLength(body) > this.#limits.maxCommentBytes) {
      throw new SafeActionError("invalid_comment");
    }
    const [existingCommentId, ...duplicateCommentIds] = await this.#findPullRequestCommentIds(pullRequestNumber, marker);
    for (const commentId of duplicateCommentIds) {
      await this.#deletePullRequestCommentById(commentId);
    }
    const result = await this.#requestJson(existingCommentId === undefined ? `${this.#repositoryPath()}/issues/${pullRequestNumber}/comments` : `${this.#repositoryPath()}/issues/comments/${existingCommentId}`, this.#limits.commentWriteResponseBytes, {
      method: existingCommentId === undefined ? "POST" : "PATCH",
      body: { body }
    });
    if (!isRecord(result)) {
      throw new SafeActionError("invalid_comment_response");
    }
    const htmlUrl = assertBoundedString(result.html_url, 4096, "invalid_comment_response");
    try {
      const parsedUrl = new URL(htmlUrl);
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
        throw new SafeActionError("invalid_comment_response");
      }
    } catch (error) {
      if (error instanceof SafeActionError)
        throw error;
      throw new SafeActionError("invalid_comment_response");
    }
    return htmlUrl;
  }
  async deletePullRequestComment(pullRequestNumber, marker) {
    const existingCommentIds = await this.#findPullRequestCommentIds(pullRequestNumber, marker);
    if (existingCommentIds.length === 0)
      return false;
    for (const commentId of existingCommentIds) {
      await this.#deletePullRequestCommentById(commentId);
    }
    return true;
  }
}

// actions/diff/src/report.ts
var COMMENT_MARKER = "<!-- dotenc-diff-action:v1 -->";
var ACCESS_REASON_CODES = new Set([
  "base_recipient_metadata_invalid",
  "head_recipient_metadata_invalid",
  "base_and_head_recipient_metadata_invalid"
]);
var hasExactKeys2 = (value, required, optional = []) => {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string"))
    return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
};
var hasAsciiControl2 = (value) => Array.from(value).some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
});
var boundedText = (value, maxBytes) => typeof value === "string" && value.length > 0 && byteLength(value) <= maxBytes && !hasAsciiControl2(value);
var neutralizeFormatControls = (value) => Array.from(value).map((character) => {
  if (!/[\p{C}\p{Zl}\p{Zp}]/u.test(character))
    return character;
  const codePoint = character.codePointAt(0) ?? 0;
  return `U${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}).join("");
var compareText2 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var canonicalReason = (value, section) => {
  if (!isRecord(value) || !hasExactKeys2(value, ["code", "message"]) || typeof value.code !== "string" || !Object.hasOwn(ENVIRONMENT_DIFF_REASON_MESSAGES, value.code)) {
    throw new SafeActionError("invalid_diff_report");
  }
  const code = value.code;
  if (section === "access" !== ACCESS_REASON_CODES.has(code) || value.message !== ENVIRONMENT_DIFF_REASON_MESSAGES[code]) {
    throw new SafeActionError("invalid_diff_report");
  }
  return { code, message: ENVIRONMENT_DIFF_REASON_MESSAGES[code] };
};
var canonicalVariableNames = (value) => {
  if (!Array.isArray(value) || value.length > ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment) {
    throw new SafeActionError("invalid_diff_report");
  }
  const names = value.map((name) => {
    if (!boundedText(name, ENVIRONMENT_DIFF_LIMITS.maxVariableNameBytes)) {
      throw new SafeActionError("invalid_diff_report");
    }
    return neutralizeFormatControls(name);
  });
  if (new Set(names).size !== names.length) {
    throw new SafeActionError("invalid_diff_report");
  }
  return names.sort(compareText2);
};
var canonicalVariableDiff = (value) => {
  if (!isRecord(value) || !hasExactKeys2(value, ["status", "added", "changed", "removed"], ["reason"]) || value.status !== "available" && value.status !== "unavailable") {
    throw new SafeActionError("invalid_diff_report");
  }
  const added = canonicalVariableNames(value.added);
  const changed = canonicalVariableNames(value.changed);
  const removed = canonicalVariableNames(value.removed);
  const allNames = [...added, ...changed, ...removed];
  if (new Set(allNames).size !== allNames.length || allNames.length > ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment * 2) {
    throw new SafeActionError("invalid_diff_report");
  }
  if (value.status === "unavailable") {
    if (allNames.length !== 0 || !Object.hasOwn(value, "reason")) {
      throw new SafeActionError("invalid_diff_report");
    }
    return {
      status: "unavailable",
      added,
      changed,
      removed,
      reason: canonicalReason(value.reason, "variables")
    };
  }
  if (Object.hasOwn(value, "reason")) {
    throw new SafeActionError("invalid_diff_report");
  }
  return { status: "available", added, changed, removed };
};
var canonicalRecipient = (value) => {
  if (!isRecord(value) || !hasExactKeys2(value, ["name", "fingerprint"]) || !boundedText(value.name, ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes) || !boundedText(value.fingerprint, ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes)) {
    throw new SafeActionError("invalid_diff_report");
  }
  return {
    name: neutralizeFormatControls(value.name),
    fingerprint: neutralizeFormatControls(value.fingerprint)
  };
};
var canonicalRecipients = (value) => {
  if (!Array.isArray(value) || value.length > ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment) {
    throw new SafeActionError("invalid_diff_report");
  }
  const recipients = value.map(canonicalRecipient);
  if (new Set(recipients.map((item) => item.fingerprint)).size !== recipients.length) {
    throw new SafeActionError("invalid_diff_report");
  }
  return recipients.sort((left, right) => compareText2(left.fingerprint, right.fingerprint) || compareText2(left.name, right.name));
};
var canonicalRenames = (value) => {
  if (!Array.isArray(value) || value.length > ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment) {
    throw new SafeActionError("invalid_diff_report");
  }
  const renames = value.map((rename) => {
    if (!isRecord(rename) || !hasExactKeys2(rename, ["fingerprint", "from", "to"]) || !boundedText(rename.fingerprint, ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes) || !boundedText(rename.from, ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes) || !boundedText(rename.to, ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes)) {
      throw new SafeActionError("invalid_diff_report");
    }
    return {
      fingerprint: neutralizeFormatControls(rename.fingerprint),
      from: neutralizeFormatControls(rename.from),
      to: neutralizeFormatControls(rename.to)
    };
  });
  if (new Set(renames.map((item) => item.fingerprint)).size !== renames.length) {
    throw new SafeActionError("invalid_diff_report");
  }
  return renames.sort((left, right) => compareText2(left.fingerprint, right.fingerprint));
};
var canonicalAccessDiff = (value) => {
  if (!isRecord(value) || !hasExactKeys2(value, ["status", "grants", "revocations", "renames"], ["reason"]) || value.status !== "available" && value.status !== "unavailable") {
    throw new SafeActionError("invalid_diff_report");
  }
  const grants = canonicalRecipients(value.grants);
  const revocations = canonicalRecipients(value.revocations);
  const renames = canonicalRenames(value.renames);
  const changedFingerprints = [
    ...grants.map((recipient) => recipient.fingerprint),
    ...revocations.map((recipient) => recipient.fingerprint),
    ...renames.map((rename) => rename.fingerprint)
  ];
  if (new Set(changedFingerprints).size !== changedFingerprints.length) {
    throw new SafeActionError("invalid_diff_report");
  }
  if (value.status === "unavailable") {
    if (grants.length + revocations.length + renames.length !== 0 || !Object.hasOwn(value, "reason")) {
      throw new SafeActionError("invalid_diff_report");
    }
    return {
      status: "unavailable",
      grants,
      revocations,
      renames,
      reason: canonicalReason(value.reason, "access")
    };
  }
  if (Object.hasOwn(value, "reason")) {
    throw new SafeActionError("invalid_diff_report");
  }
  return { status: "available", grants, revocations, renames };
};
var canonicalEnvironment = (value) => {
  if (!isRecord(value) || !hasExactKeys2(value, ["path", "name", "status", "variables", "access"]) || !boundedText(value.path, ENVIRONMENT_DIFF_LIMITS.maxPathBytes) || !boundedText(value.name, ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes) || value.status !== "added" && value.status !== "deleted" && value.status !== "modified" || value.path.startsWith("/") || value.path.includes("\\") || value.path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new SafeActionError("invalid_diff_report");
  }
  const filename = value.path.slice(value.path.lastIndexOf("/") + 1);
  const match = filename.match(/^\.env\.(.+)\.enc$/);
  if (!match || match[1] !== value.name) {
    throw new SafeActionError("invalid_diff_report");
  }
  return {
    path: neutralizeFormatControls(value.path),
    name: neutralizeFormatControls(value.name),
    status: value.status,
    variables: canonicalVariableDiff(value.variables),
    access: canonicalAccessDiff(value.access)
  };
};
var canonicalizeReport = (value) => {
  if (!isRecord(value) || !hasExactKeys2(value, ["schemaVersion", "environments"]) || value.schemaVersion !== 1 || !Array.isArray(value.environments) || value.environments.length > ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide * 2) {
    throw new SafeActionError("invalid_diff_report");
  }
  const environments = value.environments.map(canonicalEnvironment);
  if (new Set(environments.map((item) => item.path)).size !== environments.length) {
    throw new SafeActionError("invalid_diff_report");
  }
  return {
    schemaVersion: 1,
    environments: environments.sort((left, right) => compareText2(left.path, right.path))
  };
};
var displayText = (value) => Array.from(value).slice(0, 512).map((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 31 || codePoint === 127 || /[\p{C}\p{Zl}\p{Zp}]/u.test(character)) {
    return `U${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return character;
}).join("");
var htmlCode = (value) => {
  const escaped = displayText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("`", "&#96;").replaceAll("[", "&#91;").replaceAll("]", "&#93;").replaceAll("(", "&#40;").replaceAll(")", "&#41;").replaceAll("@", "&#64;");
  return `<code>${escaped}</code>`;
};

class MarkdownBuilder {
  #lines = [];
  #maxBytes;
  #bytes = 0;
  truncated = false;
  constructor(maxBytes) {
    this.#maxBytes = maxBytes;
  }
  add(line = "") {
    const size = byteLength(`${line}
`);
    if (this.#bytes + size > this.#maxBytes) {
      this.truncated = true;
      return false;
    }
    this.#lines.push(line);
    this.#bytes += size;
    return true;
  }
  toString() {
    return `${this.#lines.join(`
`)}
`;
  }
}
var environmentStatus = (status) => {
  if (status === "added")
    return "Environment added";
  if (status === "deleted")
    return "Environment deleted";
  return "Environment modified";
};
var isDataKeyRotation = (environment) => environment.status === "modified" && environment.variables.status === "available" && environment.variables.added.length === 0 && environment.variables.changed.length === 0 && environment.variables.removed.length === 0 && environment.access.status === "available" && environment.access.grants.length === 0 && environment.access.revocations.length === 0 && environment.access.renames.length === 0;
var reasonMessage = (reason2) => reason2?.message || "The semantic changes could not be verified.";
var changeLines = (items, symbol) => items.map((item) => `${symbol} ${item}`);
var addDiffBlock = (builder, lines) => {
  const rendered = lines.map(displayText);
  let fence = "```";
  while (rendered.some((line) => line.includes(fence)))
    fence += "`";
  return builder.add([`${fence}diff`, ...rendered, fence].join(`
`));
};
var addEnvironment = (builder, environment) => {
  if (!builder.add(`### ${escapeMarkdown(environment.name)}`))
    return false;
  if (!builder.add())
    return false;
  if (!builder.add(`_${isDataKeyRotation(environment) ? "Data key rotated" : environmentStatus(environment.status)} · ${htmlCode(environment.path)}_`)) {
    return false;
  }
  if (!builder.add())
    return false;
  if (isDataKeyRotation(environment))
    return true;
  if (!builder.add("#### Variables"))
    return false;
  if (!builder.add())
    return false;
  const variableChangeCount = environment.variables.added.length + environment.variables.changed.length + environment.variables.removed.length;
  if (environment.variables.status === "unavailable") {
    if (!builder.add(`> Variable diff unavailable: ${escapeMarkdown(reasonMessage(environment.variables.reason))}`)) {
      return false;
    }
  } else if (variableChangeCount === 0) {
    if (!builder.add("No variable-name changes."))
      return false;
  } else {
    const lines = [
      ...changeLines(environment.variables.changed, "~"),
      ...changeLines(environment.variables.added, "+"),
      ...changeLines(environment.variables.removed, "-")
    ];
    if (!addDiffBlock(builder, lines))
      return false;
  }
  if (!builder.add())
    return false;
  if (!builder.add("#### Access"))
    return false;
  if (!builder.add())
    return false;
  const accessChangeCount = environment.access.grants.length + environment.access.revocations.length + environment.access.renames.length;
  if (environment.access.status === "unavailable") {
    if (!builder.add(`> Access diff unavailable: ${escapeMarkdown(reasonMessage(environment.access.reason))}`)) {
      return false;
    }
  } else if (accessChangeCount === 0) {
    if (!builder.add("No recipient changes."))
      return false;
  } else {
    const lines = [
      ...environment.access.renames.map((rename) => `~ ${rename.from} → ${rename.to}`),
      ...changeLines(environment.access.grants.map((grant) => grant.name), "+"),
      ...changeLines(environment.access.revocations.map((revocation) => revocation.name), "-")
    ];
    if (!addDiffBlock(builder, lines))
      return false;
  }
  return builder.add();
};
var renderReport = (report, options = {}) => {
  if (report.environments.length === 0)
    return "";
  const reservedFooterBytes = 1024;
  const builder = new MarkdownBuilder(ACTION_LIMITS.maxCommentBytes - reservedFooterBytes);
  if (options.includeMarker) {
    builder.add(COMMENT_MARKER);
  }
  builder.add("## dotenc environment diff");
  builder.add();
  for (const environment of report.environments) {
    if (!addEnvironment(builder, environment))
      break;
  }
  if (builder.truncated) {
    builder.add("> Display truncated at the action's safe comment-size limit. The machine-readable report remains available as the action output.");
    builder.add();
  }
  const markdown = builder.toString();
  if (byteLength(markdown) > ACTION_LIMITS.maxCommentBytes) {
    throw new SafeActionError("report_render_limit");
  }
  return markdown;
};
var renderUnavailableReport = () => [
  "## dotenc environment diff",
  "",
  "> The redacted diff is temporarily unavailable because the action could not complete safely.",
  "",
  "No encrypted or decrypted content is included in this error.",
  ""
].join(`
`);
var reportHasChanges = (report) => report.environments.length > 0;

// actions/diff/src/runtime.ts
var defaultDependencies = {
  io: defaultActionIo,
  environment: process.env,
  readContext: (eventPath) => readPullRequestEvent(eventPath),
  createClient: (options) => new GitHubClient(options),
  createReport: createEnvironmentDiffReport
};
var requireDedicatedKey = (environment) => {
  const privateKeyBase64 = environment.DOTENC_PRIVATE_KEY_BASE64;
  if (!privateKeyBase64 || byteLength(privateKeyBase64) > ACTION_LIMITS.maxPrivateKeyBase64Bytes) {
    throw new SafeActionError("missing_or_oversized_private_key");
  }
  if (environment.DOTENC_PRIVATE_KEY_PASSPHRASE !== undefined && byteLength(environment.DOTENC_PRIVATE_KEY_PASSPHRASE) > ACTION_LIMITS.maxPassphraseBytes) {
    throw new SafeActionError("oversized_passphrase");
  }
  delete environment.DOTENC_PRIVATE_KEY;
};
var reportHasUnavailableSections = (report) => report.environments.some((environment) => environment.variables.status === "unavailable" || environment.access.status === "unavailable");
var clearDedicatedKeys = (environment) => {
  delete environment.DOTENC_PRIVATE_KEY_BASE64;
  delete environment.DOTENC_PRIVATE_KEY_PASSPHRASE;
  delete environment.DOTENC_PRIVATE_KEY;
};
var runAction = async (dependencies = defaultDependencies) => {
  let failOnError = false;
  let summaryWritten = false;
  let outputsAttempted = false;
  let commentEnabled = false;
  let context;
  let client;
  let compactReport = "";
  let hasChanges;
  let validEmptyReport = false;
  let emptyCommentCleanupFailed = false;
  let commentUrl = "";
  let validCommentPublished = false;
  try {
    const token = dependencies.io.getInput("github-token");
    commentEnabled = parseBoolean(dependencies.io.getInput("comment") || "true", "invalid_comment_input");
    failOnError = parseBoolean(dependencies.io.getInput("fail-on-error") || "false", "invalid_fail_on_error_input");
    if (dependencies.environment.GITHUB_EVENT_NAME !== "pull_request_target") {
      throw new SafeActionError("invalid_event_name");
    }
    context = await dependencies.readContext(dependencies.environment.GITHUB_EVENT_PATH);
    if (dependencies.environment.GITHUB_REPOSITORY?.toLowerCase() !== context.repository.toLowerCase()) {
      throw new SafeActionError("repository_mismatch");
    }
    client = dependencies.createClient({
      token,
      repository: context.repository,
      apiUrl: dependencies.environment.GITHUB_API_URL
    });
    requireDedicatedKey(dependencies.environment);
    const { base, head } = await client.getEncryptedEnvironmentComparison(context.baseSha, context.headSha);
    let report;
    try {
      report = canonicalizeReport(await dependencies.createReport({ base, head }, { privateKeySource: "environment" }));
    } finally {
      clearDedicatedKeys(dependencies.environment);
    }
    const serializedReport = JSON.stringify(report);
    if (/[\r\n]/.test(serializedReport) || import_node_buffer4.Buffer.byteLength(serializedReport, "utf8") > ACTION_LIMITS.maxReportOutputBytes) {
      throw new SafeActionError("report_output_limit");
    }
    compactReport = serializedReport;
    hasChanges = reportHasChanges(report);
    validEmptyReport = !hasChanges;
    if (validEmptyReport) {
      if (commentEnabled) {
        try {
          await client.deletePullRequestComment(context.pullRequestNumber, COMMENT_MARKER);
        } catch (error) {
          emptyCommentCleanupFailed = true;
          throw error;
        }
      }
    } else {
      const markdown = renderReport(report);
      await dependencies.io.writeSummary(markdown);
      summaryWritten = true;
      if (commentEnabled) {
        commentUrl = await client.upsertPullRequestComment(context.pullRequestNumber, COMMENT_MARKER, renderReport(report, { includeMarker: true }));
        validCommentPublished = true;
      }
    }
    outputsAttempted = true;
    await dependencies.io.setOutput("report", compactReport);
    await dependencies.io.setOutput("has-changes", String(hasChanges));
    await dependencies.io.setOutput("comment-url", commentUrl);
    if (failOnError && reportHasUnavailableSections(report)) {
      dependencies.io.annotate("error", "The redacted dotenc diff contains unavailable sections. No secret content was emitted.");
      return { ok: false, shouldFail: true };
    }
    return { ok: true, shouldFail: false };
  } catch {
    clearDedicatedKeys(dependencies.environment);
    if (!summaryWritten && !validEmptyReport) {
      try {
        await dependencies.io.writeSummary(renderUnavailableReport());
      } catch {}
    }
    if (commentEnabled && context && client && !validCommentPublished && !validEmptyReport) {
      try {
        commentUrl = await client.upsertPullRequestComment(context.pullRequestNumber, COMMENT_MARKER, `${COMMENT_MARKER}
${renderUnavailableReport()}`);
      } catch {}
    }
    if (!outputsAttempted) {
      try {
        outputsAttempted = true;
        await dependencies.io.setOutput("report", compactReport);
        await dependencies.io.setOutput("has-changes", hasChanges === undefined ? "" : String(hasChanges));
        await dependencies.io.setOutput("comment-url", commentUrl);
      } catch {}
    }
    const shouldFail = failOnError || emptyCommentCleanupFailed;
    dependencies.io.annotate(shouldFail ? "error" : "warning", "The redacted dotenc diff could not be completed safely. No secret content was emitted.");
    return { ok: false, shouldFail };
  }
};

// actions/diff/src/index.ts
runAction().then((result) => {
  if (result.shouldFail)
    process.exitCode = 1;
}).catch(() => {
  console.error("::error::The redacted dotenc diff could not be completed safely. No secret content was emitted.");
  process.exitCode = 1;
});
