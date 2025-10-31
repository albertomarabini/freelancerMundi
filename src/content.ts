declare const chrome: any;
// src/content.ts
import { extractDeterministic } from './page_models';

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg && msg.type === 'page/extract') {
    try {
      const r = extractDeterministic(document, location.href);
      send({ ok: true, data: r });
    } catch (e) {
      send({ ok: false, error: String((e as any)?.message || e) });
    }
  }
  return true;
});
