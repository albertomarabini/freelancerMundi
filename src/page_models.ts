// src/page_models.ts
export type Extracted = {
    url: string;
    platform?: string;
    external_id?: string;
    title?: string;
    company?: string;
    location?: string;
    budget?: string;
    rate?: string;
    post_date?: string;
    description?: string;
    skills?: string[];
    deliverables?: string[];
    deadlines?: string[]; // raw strings; normalize later
  };

  export type PageModel = {
    hostMatch: RegExp;           // e.g. /(^|\.)upwork\.com$/i
    platform: string;            // "Upwork"
    selectors: Partial<Record<keyof Extracted, string | ((doc: Document)=>any)>>;
    postProcess?: (e: Extracted)=>Extracted; // normalizers
  };


  export const MODELS: PageModel[] = [
    {
      hostMatch: /(^|\.)upwork\.com$/i,
      platform: "Upwork",
      selectors: {
        title: 'h1[data-test="job-title"]',
        description: 'div[data-test="job-description"]',
        budget: 'span[data-qa="job-price"]',
        post_date: 'span[data-test="posted-on"]',
        skills: (d) => Array.from(d.querySelectorAll('a.o-tag-skill')).map(a => a.textContent?.trim()).filter(Boolean),
        external_id: (d) => new URLSearchParams(location.search).get('jobId') || undefined
      }
    }
  ];


  export function extractDeterministic(doc: Document, url: string) {
    const host = new URL(url).hostname;
    const m = MODELS.find(m => m.hostMatch.test(host));
    const out: Extracted = { url, platform: m?.platform };
    if (!m) return out;

    for (const key in m.selectors) {
      const sel = m.selectors[key as keyof Extracted]!;
      if (typeof sel === 'string') {
        const el = doc.querySelector(sel);
        (out as any)[key] = el?.textContent?.trim() || undefined;
      } else if (typeof sel === 'function') {
        (out as any)[key] = sel(doc);
      }
    }
    return m.postProcess ? m.postProcess(out) : out;
  }

