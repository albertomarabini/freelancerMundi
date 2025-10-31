// content.js
(() => {
  MockMarket = {
    extractMockMarketMilestones(doc, url) {
      var root = doc.querySelector('#page-workroom');
      if (!root) {
        return { ok: false, error: 'Workroom root not found', data: null };
      }

      // Header bits
      var headerEl = root.querySelector('.card > div[style*="display:flex"] div[style*="font-weight"]');
      var workroomTitle = headerEl ? (headerEl.textContent || '').trim() : '';
      // Expecting "Workroom — Acme Co"
      var client = null;
      if (workroomTitle && workroomTitle.indexOf('—') >= 0) {
        var parts = workroomTitle.split('—');
        client = (parts[1] || '').trim() || null;
      }

      var statusEl = root.querySelector('.card .small strong');
      var status = statusEl ? (statusEl.textContent || '').trim() : null;

      // Uploaded files (optional)
      var files = [];
      var filesLis = root.querySelectorAll('.card ul li');
      for (var i = 0; i < filesLis.length; i++) {
        var t = (filesLis[i].textContent || '').trim();
        if (t) files.push(t);
      }

      // Milestones
      var msRoot = root.querySelector('#milestones-list');
      var msNodes = msRoot ? msRoot.children : [];
      var milestones_raw = [];
      // Flexible read: attributes -> named children -> text fallback

      var dateRegex = /\b(\d{4}-\d{2}-\d{2}|\d{4}\s+[A-Za-z]{3,9}\s+\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\b/i;

      for (var j = 0; msNodes && j < msNodes.length; j++) {
        var n = msNodes[j];

        // Attribute-first
        var nameAttr = n.getAttribute && (n.getAttribute('data-name') || n.getAttribute('data-title'));
        var dueAttr  = n.getAttribute && (n.getAttribute('data-due')  || n.getAttribute('data-date'));

        // Child-first
        var nameEl = n.querySelector && (n.querySelector('[data-name], .name, [itemprop="name"], div[style*="font-weight"]'));
        var dueEl  = n.querySelector && (n.querySelector('[data-due], .due, time, [itemprop="dueDate"], .small'));

        var name = (nameAttr || (nameEl && nameEl.textContent) || '').trim();
        var due_raw = (dueAttr || (dueEl && (dueEl.getAttribute('datetime') || dueEl.textContent)) || '').trim();

        // Text fallback (try to split on a dash or find a date-looking chunk)
        if (!name) {
          var titleEl = n.querySelector('div[style*="font-weight"]');
          if (titleEl) name = (titleEl.textContent || '').trim();
        }

        if (!due_raw) {
          // Prefer the .small line when present
          var small = n.querySelector('.small');
          var txt = (small ? small.textContent : (n.textContent || '')).replace(/\s+/g, ' ').trim();
          var m = txt.match(dateRegex);
          if (m) due_raw = m[0];
        }

        if (!name || !due_raw) {
          var txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
          if (!name && txt) {
            // try "Draft delivery — 2025-11-13"
            var dashIdx = txt.indexOf('—') >= 0 ? txt.indexOf('—') : txt.indexOf('-');
            if (dashIdx > 0) name = txt.slice(0, dashIdx).trim();
          }
          if (!due_raw && txt) {
            var m = txt.match(dateRegex);
            if (m) due_raw = m[0];
          }
          if(!name){
            name = txt.replace(due_raw, '');
          }
        }

        // Require at least a name or a date-like snippet
        if (name || due_raw) {
          milestones_raw.push({
            name: name || null,
            due_raw: due_raw || null,
            original_html: n.outerHTML.slice(0, 2000) // small breadcrumb for LLM context if needed
          });
        }
      }

      return {
        ok: true,
        data: {
          url: url,
          platform: 'MockMarket',
          workroom_title: workroomTitle || null,
          client: client,
          status: status,
          files: files,
          milestones_raw: milestones_raw,
          now_iso: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        }
      };
    }
  }

  function extractDeterministic(doc, url) {
    const title = doc.querySelector('h1, title')?.innerText?.trim() || '';
    const meta  = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const text  = doc.body?.innerText?.slice(0, 20000) || '';
    return { url, title, description: text, meta };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || window.top !== window) return;
    let req = String(msg.type);
    if (req == 'page/extract') {
      try {
        const data = extractDeterministic(document, location.href);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return true;
    }
    if (msg.type === 'page/MockMarket/extract_milestones') {
      try {
        var out = MockMarket.extractMockMarketMilestones(document, location.href);
        sendResponse(out);
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message || err), data: null });
      }
      return true;
    }
  });
})();
