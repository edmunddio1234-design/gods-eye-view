/**
 * Site Survey info card: what a click on the map found — a soil, a USGS
 * station's latest readings, an EPA regulated site. Built from DOM nodes
 * (never HTML strings), since every value comes from a public service.
 */
import { t } from '../i18n/index.js';

export const SURVEY_INFO_ID = 'site-survey-info';

const safeHref = (href) => {
  try {
    const url = new URL(String(href));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/** @param {{documentRef?: Document}} [deps] */
export function createSurveyInfoCard({ documentRef = document } = {}) {
  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const card = el('section', 'survey-info');
  card.id = SURVEY_INFO_ID;
  card.hidden = true;
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-label', t('Map details'));
  const close = el('button', 'survey-close survey-info-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', t('Close details'));
  close.title = t('Close details');
  const body = el('div', 'survey-info-body');
  card.append(close, body);
  documentRef.body.appendChild(card);
  const onClose = () => {
    card.hidden = true;
  };
  close.addEventListener('click', onClose);
  let token = 0;

  /**
   * @param {object} content
   * @param {string} content.kicker  small label, e.g. "USGS station"
   * @param {string} content.title
   * @param {string} [content.subtitle]
   * @param {Array<[string, string, string?]>} [content.rows] label, value, note
   * @param {string} [content.note]
   * @param {Array<{href:string, label:string}>} [content.links]
   */
  function show(content) {
    token += 1;
    const parts = [el('p', 'survey-info-kicker', content.kicker)];
    parts.push(el('h3', 'survey-info-title', content.title));
    if (content.subtitle)
      parts.push(el('p', 'survey-info-subtitle', content.subtitle));
    if (content.rows?.length) {
      const dl = el('dl', 'survey-readout survey-info-rows');
      for (const [label, value, note] of content.rows) {
        const dd = el('dd', '', value);
        if (note) dd.append(el('span', 'survey-info-when', note));
        dl.append(el('dt', '', label), dd);
      }
      parts.push(dl);
    }
    if (content.note) parts.push(el('p', 'survey-note', content.note));
    for (const link of content.links || []) {
      const href = safeHref(link.href);
      if (!href) continue;
      const a = el('a', 'survey-info-link', link.label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parts.push(a);
    }
    body.replaceChildren(...parts);
    card.hidden = false;
    return token;
  }

  return {
    element: card,
    show,
    /** Show a waiting card; returns a token that `isCurrent` checks. */
    loading(kicker, title) {
      return show({ kicker, title, note: t('Reading…') });
    },
    isCurrent: (value) => value === token,
    hide: onClose,
    get hidden() {
      return card.hidden;
    },
    destroy() {
      close.removeEventListener('click', onClose);
      card.remove();
    },
  };
}
