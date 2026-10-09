// Tests the published CommonJS bundle. Run `yarn build` first.
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { beforeEach, describe, test } = require("node:test");

const BUNDLE_PATH = path.resolve(__dirname, "../dist/index.cjs.js");

const MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const WINDOWS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const KEY_CODES = { backspace: 8, k: 75, s: 83 };

// The bundle keeps react external. These hooks render once and run effects
// right away, which is all useHotKeys needs.
let pendingEffects = [];
const fakeReact = {
  useRef: initial => ({ current: initial }),
  useMemo: compute => compute(),
  useEffect: effect => pendingEffects.push(effect),
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "react") return fakeReact;

  return originalLoad.call(this, request, ...rest);
};

const createElement = (tagName, parentNode = null) => {
  const listeners = {};

  return {
    tagName,
    className: "",
    parentNode,
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener: (type, listener) => {
      listeners[type] = (listeners[type] ?? []).filter(fn => fn !== listener);
    },
    pressKey(key, { target = this, ...modifiers } = {}) {
      const event = {
        type: "keydown",
        which: KEY_CODES[key],
        keyCode: KEY_CODES[key],
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...modifiers,
      };
      (listeners.keydown ?? []).forEach(listener => listener(event));

      return event;
    },
  };
};

let useHotKeys;

const setUserAgent = userAgent =>
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent },
    configurable: true,
  });

// A fresh bundle per test, since Mousetrap binds to the document when it
// loads and keeps its callbacks in module state.
beforeEach(() => {
  globalThis.window = globalThis;
  globalThis.document = createElement("#document");
  delete globalThis.Mousetrap;
  setUserAgent(MAC_USER_AGENT);

  delete require.cache[BUNDLE_PATH];
  useHotKeys = require(BUNDLE_PATH);
});

const renderHook = (hotkey, handler, config, { scopedElement } = {}) => {
  pendingEffects = [];
  const result = useHotKeys(hotkey, handler, config);
  if (result && scopedElement) result.current = scopedElement;

  const cleanups = pendingEffects.map(effect => effect());

  return {
    result,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
  };
};

describe("useHotKeys", () => {
  test("calls the handler when the hotkey is pressed on the document", () => {
    const calls = [];
    const { result } = renderHook("command+k", event => calls.push(event));

    const event = document.pressKey("k", { metaKey: true });

    assert.equal(result, null);
    assert.deepEqual(calls, [event]);
  });

  test("stops calling the handler after unmount", () => {
    const calls = [];
    const { unmount } = renderHook("command+k", () => calls.push("called"));

    unmount();
    document.pressKey("k", { metaKey: true });

    assert.deepEqual(calls, []);
  });

  test("does not bind anything when disabled", () => {
    const calls = [];
    renderHook("command+k", () => calls.push("called"), { enabled: false });

    document.pressKey("k", { metaKey: true });

    assert.deepEqual(calls, []);
  });

  test("binds every hotkey in an array", () => {
    const calls = [];
    renderHook(["command+k", "command+s"], () => calls.push("called"));

    document.pressKey("k", { metaKey: true });
    document.pressKey("s", { metaKey: true });

    assert.equal(calls.length, 2);
  });

  test("converts Mac modifier names for Windows users", () => {
    setUserAgent(WINDOWS_USER_AGENT);
    const calls = [];
    renderHook("command+k", () => calls.push("called"));

    document.pressKey("k", { metaKey: true });
    assert.deepEqual(calls, []);

    document.pressKey("k", { ctrlKey: true });
    assert.deepEqual(calls, ["called"]);
  });

  test("maps delete to backspace for Mac users", () => {
    const calls = [];
    renderHook("delete", () => calls.push("called"));

    document.pressKey("backspace");

    assert.deepEqual(calls, ["called"]);
  });

  test("ignores keys typed into inputs in the default mode", () => {
    const calls = [];
    renderHook("command+k", () => calls.push("called"));

    const input = createElement("INPUT", document);
    document.pressKey("k", { metaKey: true, target: input });

    assert.deepEqual(calls, []);
  });

  test("handles keys typed into inputs in the global mode", () => {
    const calls = [];
    const { unmount } = renderHook("command+k", () => calls.push("called"), {
      mode: "global",
    });

    const input = createElement("INPUT", document);
    document.pressKey("k", { metaKey: true, target: input });
    assert.deepEqual(calls, ["called"]);

    unmount();
    document.pressKey("k", { metaKey: true, target: input });
    assert.deepEqual(calls, ["called"]);
  });

  test("returns a ref and binds only to that element in the scoped mode", () => {
    const calls = [];
    const element = createElement("DIV", document);
    const { result } = renderHook(
      "command+k",
      () => calls.push("called"),
      { mode: "scoped" },
      { scopedElement: element }
    );

    assert.equal(result.current, element);

    document.pressKey("k", { metaKey: true });
    assert.deepEqual(calls, []);

    element.pressKey("k", { metaKey: true });
    assert.deepEqual(calls, ["called"]);
  });

  test("binds to the document passed in the config", () => {
    const calls = [];
    const iframeDocument = createElement("#document");
    renderHook("command+k", () => calls.push("called"), {
      document: iframeDocument,
    });

    document.pressKey("k", { metaKey: true });
    assert.deepEqual(calls, []);

    iframeDocument.pressKey("k", { metaKey: true });
    assert.deepEqual(calls, ["called"]);
  });
});
