const wrap = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  select: wrap('<path d="M5.5 3.2 18 11.4l-5.4 1.2-2.4 5.2z"/>'),
  lasso: wrap(
    '<ellipse cx="12" cy="10" rx="8" ry="5.6"/><path d="M8.6 15.3c-.3 1.9.1 3.4 1 4.3M9.6 19.6a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z"/>',
  ),
  pen: wrap('<path d="M3 21l1-4L16.6 4.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8 21z"/><path d="M15.2 5.8 18.2 8.8"/>'),
  marker: wrap('<path d="M4 20h5l10-10a2.4 2.4 0 0 0 0-3.4l-1.6-1.6a2.4 2.4 0 0 0-3.4 0L4 15z"/><path d="M13.4 5.6 18.4 10.6"/>'),
  highlighter: wrap('<path d="M6 14.5 14.6 6a2 2 0 0 1 2.8 0l1.6 1.6a2 2 0 0 1 0 2.8L10.4 19H6z"/><path d="M4 21.2h16"/>'),
  pencil: wrap('<path d="M4 20.2 7.6 19 19 7.6a1.8 1.8 0 0 0 0-2.6L18 4a1.8 1.8 0 0 0-2.6 0L4 15.4z"/><path d="M14.6 5.8 17.2 8.4M4.4 15.6l3.6 3.6"/>'),
  eraser: wrap('<path d="M8.6 20.4H20M4.6 16.6l7.6-7.6a2 2 0 0 1 2.8 0l3.6 3.6a2 2 0 0 1 0 2.8l-5 5H8.6z"/><path d="M10 11.4l6.4 6.4"/>'),
  shape: wrap('<rect x="3.2" y="3.2" width="11" height="11" rx="1.6"/><circle cx="15.4" cy="15.4" r="5.4"/>'),
  note: wrap('<path d="M4.4 4.4h15.2v10.4L14.8 19.6H4.4z"/><path d="M19.6 14.8h-4.8v4.8"/>'),
  text: wrap('<path d="M5 6.2V4.6h14v1.6M12 4.6v14.8M9 19.4h6"/>'),
  image: wrap('<rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="M3.6 16.6 9 11.6l4 3.6 3-2.4 4.4 3.8"/>'),
  laser: wrap('<circle cx="12" cy="12" r="2.6"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/>'),
  hand: wrap('<path d="M12 3.4v8M12 14.6l-2.6 2.6M12 3.4 9.4 6M12 3.4 14.6 6M3.4 12h8M14.6 12h6M3.4 12 6 9.4M3.4 12 6 14.6M20.6 12 18 9.4M20.6 12 18 14.6M12 20.6v-6M12 20.6 9.4 18M12 20.6 14.6 18"/>'),

  undo: wrap('<path d="M4 9.6h9.4a5.4 5.4 0 0 1 0 10.8H8.6"/><path d="M8 5.2 3.6 9.6 8 14"/>'),
  redo: wrap('<path d="M20 9.6h-9.4a5.4 5.4 0 0 0 0 10.8h4.8"/><path d="M16 5.2 20.4 9.6 16 14"/>'),
  trash: wrap('<path d="M4.6 6.6h14.8M9.4 6.6V4.4h5.2v2.2M6.6 6.6l1 13h8.8l1-13"/>'),
  copy: wrap('<rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2"/><path d="M15.6 8.4V6.4a2 2 0 0 0-2-2H6.4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 2 2h2"/>'),
  front: wrap('<rect x="3.4" y="3.4" width="11" height="11" rx="1.8"/><path d="M9.6 9.6h11v11h-11z"/>'),
  back: wrap('<path d="M3.4 3.4h11v11h-11z"/><rect x="9.6" y="9.6" width="11" height="11" rx="1.8"/>'),
  lock: wrap('<rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/>'),

  zoomIn: wrap('<circle cx="10.6" cy="10.6" r="6.6"/><path d="M15.4 15.4 20.6 20.6M8 10.6h5.2M10.6 8v5.2"/>'),
  zoomOut: wrap('<circle cx="10.6" cy="10.6" r="6.6"/><path d="M15.4 15.4 20.6 20.6M8 10.6h5.2"/>'),
  fit: wrap('<path d="M3.6 8.6v-5h5M20.4 8.6v-5h-5M3.6 15.4v5h5M20.4 15.4v5h-5"/>'),
  grid: wrap('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/><path d="M9.2 3.4v17.2M14.8 3.4v17.2M3.4 9.2h17.2M3.4 14.8h17.2"/>'),
  palette: wrap('<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.3 0 1.8-.9 1.4-1.8-.5-1.1.2-2.2 1.5-2.2h1.8a3.9 3.9 0 0 0 3.9-3.9c0-5-3.9-9.3-8.6-9.3z"/><circle cx="7.8" cy="11.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.6" cy="8.8" r="1.1" fill="currentColor" stroke="none"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3.2"/><path d="M19.2 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/>'),
  library: wrap('<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.6"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.6"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.6"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.6"/>'),
  download: wrap('<path d="M12 3.6v11.2M7.6 10.4 12 14.8l4.4-4.4M4.4 19.4h15.2"/>'),
  upload: wrap('<path d="M12 15.4V4.2M7.6 8.6 12 4.2l4.4 4.4M4.4 19.4h15.2"/>'),
  sun: wrap('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M12 19v2.4M4.4 12H2M22 12h-2.4M6 6l-1.7-1.7M19.7 19.7 18 18M18 6l1.7-1.7M4.3 19.7 6 18"/>'),
  moon: wrap('<path d="M20.4 13.6A8.4 8.4 0 1 1 10.4 3.6a6.6 6.6 0 0 0 10 10z"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>'),
  keyboard: wrap('<rect x="2.6" y="6" width="18.8" height="12" rx="2"/><path d="M6.4 9.6h.01M9.6 9.6h.01M12.8 9.6h.01M16 9.6h.01M6.4 12.8h.01M9.6 12.8h.01M12.8 12.8h.01M16 12.8h.01M8 15.6h8"/>'),
  tablet: wrap('<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.4"/><path d="M17.4 8.6 9.8 16.2l-3.2.8.8-3.2 7.6-7.6a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2z"/>'),
  chevron: wrap('<path d="M8.6 4.6 16 12l-7.4 7.4"/>'),
  check: wrap('<path d="M4.6 12.6 9.4 17.4 19.4 7.4"/>'),
};

export const SHAPE_ICONS: Record<string, string> = {
  rect: wrap('<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="2"/>'),
  ellipse: wrap('<ellipse cx="12" cy="12" rx="8.4" ry="6.4"/>'),
  diamond: wrap('<path d="M12 3.6 20.4 12 12 20.4 3.6 12z"/>'),
  triangle: wrap('<path d="M12 4.4 20.6 19.6H3.4z"/>'),
  star: wrap('<path d="m12 3.6 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 10l6-.8z"/>'),
  line: wrap('<path d="M4.6 19.4 19.4 4.6"/>'),
  arrow: wrap('<path d="M4.6 19.4 19.4 4.6M12.6 4.6h6.8v6.8"/>'),
};

export const BACKGROUND_ICONS: Record<string, string> = {
  blank: wrap('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/>'),
  grid: ICONS.grid,
  dots: wrap('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/><path d="M8.4 8.4h.01M15.6 8.4h.01M8.4 15.6h.01M15.6 15.6h.01M12 12h.01" stroke-width="2.4"/>'),
  lines: wrap('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/><path d="M3.4 9.2h17.2M3.4 14.8h17.2"/>'),
  iso: wrap('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/><path d="M3.4 14 12 3.4M12 20.6 20.6 10M12 3.4v17.2"/>'),
};
