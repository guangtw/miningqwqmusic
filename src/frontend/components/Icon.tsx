// 线性图标，统一 24×24、1.6 描边。
const paths = {
  play: <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4" height="15" />
      <rect x="14" y="4.5" width="4" height="15" />
    </g>
  ),
  prev: (
    <g>
      <path d="M18 5v14L8 12z" fill="currentColor" stroke="none" />
      <path d="M6 5v14" />
    </g>
  ),
  next: (
    <g>
      <path d="M6 5v14l10-7z" fill="currentColor" stroke="none" />
      <path d="M18 5v14" />
    </g>
  ),
  order: <path d="M4 7h12M4 12h12M4 17h8M18 14v6m0 0-2.5-2.5M18 20l2.5-2.5" />,
  loop: <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" />,
  one: (
    <g>
      <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" />
      <path d="M11 10.5l1.5-1v5" />
    </g>
  ),
  shuffle: <path d="M3 7h3.5c4 0 6.5 10 11 10H21m0 0-3-3m3 3-3 3M3 17h3.5c1.6 0 2.9-1.2 4-3M21 7h-3.5c-1.6 0-2.9 1.2-4 3M21 7l-3-3m3 3-3 3" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
  heartFill: (
    <path
      d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"
      fill="currentColor"
    />
  ),
  volume: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5m0-5-5 5" />,
  queue: <path d="M4 6h16M4 11h16M4 16h9M17 15v5l4-2.5z" />,
  lyrics: <path d="M5 4h10l4 4v12H5zM9 10h6M9 14h6M9 18h3" />,
  search: <path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="M6 9l6 6 6-6" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </g>
  ),
  listAdd: <path d="M4 6h12M4 11h12M4 16h7M17 14v6M14 17h6" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  card: <path d="M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h4" />,
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </g>
  ),
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
