// DOM-based HTML clean-up for content that is inserted into editable areas of the app (quoted mails, drafts).
// Message bodies themselves are shown in a sandboxed iframe; this protects the composer, which is part of the app.

const DROP = 'script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,meta,link,base,noscript,template';
const REMOTE = /^\s*(https?:)?\/\//i;
const CSS_URL = /url\(\s*(['"]?)\s*(https?:)?\/\/[^)]*\)/gi;

export function sanitizeForEditor(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'srcset' || name === 'background') el.removeAttribute(attr.name);
      // no remote loads (tracking pixels, CSS leaks) from quoted mail inside the app window
      else if ((name === 'src' || name === 'poster') && REMOTE.test(attr.value)) el.removeAttribute(attr.name);
      else if (name === 'style' && new RegExp(CSS_URL.source, 'i').test(attr.value)) el.setAttribute('style', attr.value.replace(CSS_URL, 'none'));
      else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && /^(javascript|vbscript|data:text\/html)/.test(value.replace(/\s+/g, ''))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}
