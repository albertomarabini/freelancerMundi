// stickyStatus.ts (TS-safe, no arrows)
/************************************************************
Tiny DOM utilities for quick UI feedback — no dependencies, pure TS-safe, minimal footprint.

## Functions

### `setStickyStatus(text: string, ms?: number): void`

Shows a small fixed status badge (bottom-left).
If `ms` is given, it auto-hides after that many milliseconds.
if an empty string is given as `text`, it hides immediately.

### `showBackdrop(text?: string): void`

Shows a dim backdrop with a spinner and optional text.

### `askPrompt(message: string, cb: (value: string|null, action: 'ok'|'cancel') => void, defaultValue?: string, okText?: string, cancelText?: string): void`

Displays a small centered prompt with an input and OK/Cancel buttons.
Calls `cb(value, 'ok')` or `cb(null, 'cancel')` when closed.

---

## Usage

Import once in your app entry:

```ts
import './stickyStatus';
```

Then call anywhere:

```ts
setStickyStatus("Working…", 1500);
showBackdrop("Loading…");
askPrompt("Enter name:", (v,a)=>console.log(v,a));
```
*/
export {};
declare global {
    interface Window {
      setStickyStatus(text: string, ms?: number): void;
      removeStickyStatus(): void;

      showBackdrop(text?: string): void;
      hideBackdrop(): void;
      removeBackdrop(): void;

      askPrompt(
        message: string,
        cb: (value: string | null, action: 'ok' | 'cancel') => void,
        defaultValue?: string,
        okText?: string,
        cancelText?: string
      ): void;
      hidePrompt(): void;
      removePrompt(): void;
    }
}
  (function () {
    var HOST_ID = "__sticky_status_host__";
    var BACKDROP_ID = "__sticky_backdrop__";
    var PROMPT_ID = "__sticky_prompt__";
    var hideTimer: number | null = null;

    function ensureHost(): HTMLElement {
      var el = document.getElementById(HOST_ID);
      if (el) return el;

      el = document.createElement("div");
      el.id = HOST_ID;
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");

      var s = el.style;
      s.position = "fixed";
      s.left = "12px";
      s.bottom = "12px";
      s.maxWidth = "70vw";
      s.padding = "6px 10px";
      s.borderRadius = "8px";
      s.background = "rgba(20,20,20,.92)";
      s.color = "#fff";
      s.font = "12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      s.boxShadow = "0 4px 14px rgba(0,0,0,.35)";
      s.zIndex = "2147483647";
      s.pointerEvents = "none";
      s.whiteSpace = "pre-wrap";
      s.display = "none";

      document.documentElement.appendChild(el);
      return el;
    }

    function setStickyStatus(text: string, ms?: number): void {
        if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
        if (text && text.trim()) {
          var el = ensureHost();
          el.textContent = text;
          el.style.display = "inline-block";
          if (ms && ms > 0) {
            hideTimer = window.setTimeout(function () { setStickyStatus(""); }, ms);
          }
        } else {
          var elHide = document.getElementById(HOST_ID);
          if (elHide) { elHide.style.display = "none"; elHide.textContent = ""; }
        }
    }

    function removeStickyStatus(): void {
      if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
      var el = document.getElementById(HOST_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function ensureBackdrop(): HTMLElement {
        var el = document.getElementById(BACKDROP_ID);
        if (el) return el;

        el = document.createElement("div");
        el.id = BACKDROP_ID;
        el.setAttribute("aria-hidden", "true");

        var s = el.style;
        s.position = "fixed";
        s.left = "0";
        s.top = "0";
        s.width = "100vw";
        s.height = "100vh";
        s.background = "rgba(0,0,0,0.35)"; // subtle dim
        s.backdropFilter = "blur(1px)";    // tiny blur (ignored if unsupported)
        s.zIndex = "2147483646";           // just under the status badge (…47)
        s.display = "none";

        // optional tiny spinner + label
        var box = document.createElement("div");
        box.style.position = "absolute";
        box.style.left = "50%";
        box.style.top = "50%";
        box.style.transform = "translate(-50%, -50%)";
        box.style.padding = "10px 12px";
        box.style.borderRadius = "10px";
        box.style.background = "rgba(20,20,20,.92)";
        box.style.color = "#fff";
        box.style.font = "12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        box.style.maxWidth = "80vw";
        box.style.textAlign = "center";

        var spinner = document.createElement("div");
        spinner.style.width = "16px";
        spinner.style.height = "16px";
        spinner.style.margin = "0 auto 6px auto";
        spinner.style.border = "2px solid rgba(255,255,255,.35)";
        spinner.style.borderTopColor = "#fff";
        spinner.style.borderRadius = "50%";
        spinner.style.animation = "stickyspin 0.8s linear infinite";

        var label = document.createElement("div");
        label.id = BACKDROP_ID + "__label";
        label.textContent = "";

        box.appendChild(spinner);
        box.appendChild(label);
        el.appendChild(box);

        // keyframes (once)
        var styleEl = document.getElementById("__sticky_keyframes__") as HTMLStyleElement | null;
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = "__sticky_keyframes__";
            styleEl.textContent = "@keyframes stickyspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}";
            document.head.appendChild(styleEl);
        }

        document.documentElement.appendChild(el);
        return el;
    }

    function showBackdrop(text?: string): void {
        var el = ensureBackdrop();
        var label = document.getElementById(BACKDROP_ID + "__label");
        if (label) {
            label.textContent = text ? String(text) : "";
            (label as any).style.display = text ? "block" : "none";
        }
        el.style.display = "block";
    }

    function hideBackdrop(): void {
        var el = document.getElementById(BACKDROP_ID);
        if (el) el.style.display = "none";
    }

    function removeBackdrop(): void {
        var el = document.getElementById(BACKDROP_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function ensurePrompt(): HTMLElement {
        var el = document.getElementById(PROMPT_ID);
        if (el) return el;

        el = document.createElement("div");
        el.id = PROMPT_ID;
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");

        var s = el.style;
        s.position = "fixed";
        s.left = "0";
        s.top = "0";
        s.width = "100vw";
        s.height = "100vh";
        s.display = "none";
        s.zIndex = "2147483647"; // above everything
        s.background = "rgba(0,0,0,0.35)";

        var box = document.createElement("div");
        box.style.position = "absolute";
        box.style.left = "50%";
        box.style.top = "50%";
        box.style.transform = "translate(-50%, -50%)";
        box.style.minWidth = "240px";
        box.style.maxWidth = "80vw";
        box.style.padding = "10px 12px";
        box.style.borderRadius = "10px";
        box.style.background = "rgba(20,20,20,.92)";
        box.style.color = "#fff";
        box.style.font = "12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

        var msg = document.createElement("div");
        msg.id = PROMPT_ID + "__msg";
        msg.style.margin = "0 0 6px 0";
        msg.style.whiteSpace = "pre-wrap";

        var row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.justifyContent = "flex-end";

        function makeBtn(txt: string): HTMLButtonElement {
          var b = document.createElement("button");
          b.textContent = txt;
          b.style.padding = "6px 10px";
          b.style.borderRadius = "8px";
          b.style.border = "1px solid rgba(255,255,255,.25)";
          b.style.background = "rgba(255,255,255,.08)";
          b.style.color = "#fff";
          b.style.cursor = "pointer";
          b.style.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          b.onmouseenter = function(){ b.style.background = "rgba(255,255,255,.16)"; };
          b.onmouseleave = function(){ b.style.background = "rgba(255,255,255,.08)"; };
          return b;
        }

        var btnCancel = makeBtn("Cancel");
        btnCancel.id = PROMPT_ID + "__cancel";
        var btnOk = makeBtn("OK");
        btnOk.id = PROMPT_ID + "__ok";

        row.appendChild(btnCancel);
        row.appendChild(btnOk);

        box.appendChild(msg);
        box.appendChild(row);
        el.appendChild(box);

        document.documentElement.appendChild(el);
        return el;
      }

      function showPrompt(message: string, cb: (action: 'ok' | 'cancel') => void, okText?: string, cancelText?: string): void {
        var host = ensurePrompt();
        (window as any).hideBackdrop();
        var msg = document.getElementById(PROMPT_ID + "__msg") as HTMLDivElement | null;
        var ok = document.getElementById(PROMPT_ID + "__ok") as HTMLButtonElement | null;
        var cancel = document.getElementById(PROMPT_ID + "__cancel") as HTMLButtonElement | null;

        if (msg) msg.textContent = message || "";
        if (ok) ok.textContent = okText || "OK";
        if (cancel) cancel.textContent = cancelText || "Cancel";

        function finish(action: 'ok' | 'cancel'): void {
          let preventDefault = false;
          try {
            let ret = cb(action) as boolean | void;
            if (ret === true) preventDefault = true;
          } catch {}
          if(!preventDefault) hidePrompt();
        }

        // function onKey(e: KeyboardEvent): void {
        //   if (e.key === "Enter") { e.preventDefault(); finish('ok'); }
        //   else if (e.key === "Escape") { e.preventDefault(); finish('cancel'); }
        // }

        if (ok) ok.onclick = function(){ finish('ok'); };
        if (cancel) cancel.onclick = function(){ finish('cancel'); };

        host.style.display = "block";

        // document.addEventListener("keydown", onKey, { once: true });
      }

      function hidePrompt(): void {
        var host = document.getElementById(PROMPT_ID);
        if (host) host.style.display = "none";
      }

      function removePrompt(): void {
        var host = document.getElementById(PROMPT_ID);
        if (host && host.parentNode) host.parentNode.removeChild(host);
      }


    (window as any).setStickyStatus = setStickyStatus;
    (window as any).removeStickyStatus = removeStickyStatus;
    (window as any).showBackdrop = showBackdrop;
    (window as any).hideBackdrop = hideBackdrop;
    (window as any).removeBackdrop = removeBackdrop;
    (window as any).askPrompt = showPrompt;
    (window as any).hidePrompt = hidePrompt;
    (window as any).removePrompt = removePrompt;
  })();
