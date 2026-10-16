import { useColorScheme } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

/**
 * Stroke icons (paths from Lucide, ISC license) tinted for light/dark mode.
 * Decorative by default; the surrounding control carries the accessibility label.
 */
type IconProps = { size?: number; color?: string; danger?: boolean; filled?: boolean };

function useInk(color?: string, danger?: boolean) {
  const dark = useColorScheme() === "dark";
  if (color) return color;
  if (danger) return dark ? "#FF8A80" : "#B42318";
  return dark ? "#F3EFE7" : "#15130F";
}

function Base({ size = 20, color, danger, children }: IconProps & { children: React.ReactNode }) {
  const ink = useInk(color, danger);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Svg>
  );
}

export const ChevronLeft = (p: IconProps) => <Base {...p}><Polyline points="15 18 9 12 15 6" /></Base>;
export const Plus = (p: IconProps) => <Base {...p}><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></Base>;
export const ArrowUp = (p: IconProps) => <Base {...p}><Line x1="12" y1="19" x2="12" y2="5" /><Polyline points="5 12 12 5 19 12" /></Base>;
export const ArrowDown = (p: IconProps) => <Base {...p}><Line x1="12" y1="5" x2="12" y2="19" /><Polyline points="19 12 12 19 5 12" /></Base>;
export const Trash2 = (p: IconProps) => (
  <Base {...p}>
    <Path d="M3 6h18" /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Base>
);
export const Camera = (p: IconProps) => (
  <Base {...p}>
    <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><Circle cx="12" cy="13" r="3" />
  </Base>
);
export const ImagePlus = (p: IconProps) => (
  <Base {...p}>
    <Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /><Line x1="16" y1="5" x2="22" y2="5" /><Line x1="19" y1="2" x2="19" y2="8" /><Circle cx="9" cy="9" r="2" /><Path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Base>
);
export const LocateFixed = (p: IconProps) => (
  <Base {...p}>
    <Line x1="2" x2="5" y1="12" y2="12" /><Line x1="19" x2="22" y1="12" y2="12" /><Line x1="12" x2="12" y1="2" y2="5" /><Line x1="12" x2="12" y1="19" y2="22" /><Circle cx="12" cy="12" r="7" /><Circle cx="12" cy="12" r="3" />
  </Base>
);
export const CalendarClock = (p: IconProps) => (
  <Base {...p}>
    <Path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" /><Path d="M16 2v4" /><Path d="M8 2v4" /><Path d="M3 10h5" /><Circle cx="16" cy="16" r="6" /><Path d="M16 14v2l1 1" />
  </Base>
);
export const HomeIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Polyline points="9 22 9 12 15 12 15 22" />
  </Base>
);
export const LogOut = (p: IconProps) => (
  <Base {...p}>
    <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" x2="9" y1="12" y2="12" />
  </Base>
);
export function Star({ size = 20, filled, color }: IconProps) {
  const dark = useColorScheme() === "dark";
  const gold = dark ? "#D2A965" : "#A67C3D";
  const ink = color ?? (filled ? gold : dark ? "#8A8377" : "#8C8579");
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? gold : "none"} stroke={ink} strokeWidth={1.8} strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </Svg>
  );
}
export const Square = (p: IconProps) => <Base {...p}><Rect x="3" y="3" width="18" height="18" rx="2" /></Base>;
