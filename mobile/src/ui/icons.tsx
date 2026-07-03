import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const base = (size = 22, strokeWidth = 1.8, color = '#1B1A17') => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const HomeIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Path d="M3 10.5 12 3l9 7.5" />
    <Path d="M5 9.5V21h14V9.5" />
  </Svg>
);

export const BankIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Rect x="4" y="4" width="16" height="16" rx="2.5" />
    <Line x1="8" y1="9" x2="16" y2="9" />
    <Line x1="8" y1="13" x2="16" y2="13" />
    <Line x1="8" y1="17" x2="13" y2="17" />
  </Svg>
);

export const StudyIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Path d="M8 5v14l11-7L8 5Z" />
  </Svg>
);

export const YouIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Circle cx="12" cy="8.5" r="3.6" />
    <Path d="M5 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5" />
  </Svg>
);

export const SearchIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Circle cx="11" cy="11" r="6.5" />
    <Line x1="16" y1="16" x2="21" y2="21" />
  </Svg>
);

export const CloseIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Line x1="6" y1="6" x2="18" y2="18" />
    <Line x1="18" y1="6" x2="6" y2="18" />
  </Svg>
);

export const ChevronLeft = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Polyline points="15 5 8 12 15 19" />
  </Svg>
);

export const ChevronRight = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Polyline points="9 5 16 12 9 19" />
  </Svg>
);

export const ArrowRight = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Line x1="4" y1="12" x2="20" y2="12" />
    <Polyline points="14 6 20 12 14 18" />
  </Svg>
);

export const MicIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M5 11a7 7 0 0 0 14 0" />
    <Line x1="12" y1="18" x2="12" y2="21" />
  </Svg>
);

export const PlusIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const SparkleIcon = ({ size, color, strokeWidth }: IconProps) => (
  <Svg {...base(size, strokeWidth, color)}>
    <Path d="M12 3.5 13.7 9 19 10.7 13.7 12.4 12 18 10.3 12.4 5 10.7 10.3 9 12 3.5Z" />
    <Path d="M18.5 4v3M20 5.5h-3" />
  </Svg>
);
