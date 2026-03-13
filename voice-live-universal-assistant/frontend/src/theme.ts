import { createLightTheme, createDarkTheme } from '@fluentui/react-components';
import type { BrandVariants, Theme } from '@fluentui/react-components';

/**
 * Custom purple brand ramp matching the Foundry Portal's nextGenForegroundBrand.
 * Base color: #7B5EA7 (Foundry's colorBrandBackground equivalent)
 *
 * Generated to produce a purple palette instead of Fluent's default blue.
 */
const purpleBrand: BrandVariants = {
  10: '#050208',
  20: '#1B0E2E',
  30: '#2D1650',
  40: '#3D1D6D',
  50: '#4C2585',
  60: '#5C2E9E',
  70: '#6B3AB3',
  80: '#7B5EA7',  // Base — matches Foundry
  90: '#8E6FBB',
  100: '#9F82C8',
  110: '#B095D4',
  120: '#C0A8DF',
  130: '#CFBCE9',
  140: '#DDD0F1',
  150: '#EBE4F8',
  160: '#F5F0FC',
};

/**
 * Light theme — brand background uses step 70 (darker) per Foundry convention.
 */
export const voiceLiveLightTheme: Theme = {
  ...createLightTheme(purpleBrand),
  colorBrandBackground: purpleBrand[70],
  colorBrandBackgroundHover: purpleBrand[60],
  colorBrandBackgroundPressed: purpleBrand[40],
  colorBrandBackgroundSelected: purpleBrand[50],
};

/**
 * Dark theme — matches Foundry Portal's neutralBackgroundDarkTheme overrides.
 *
 * Background step values from Foundry themes.ts:
 *   bg1=12%, bg2=10%, bg3=8%, bg4=6%, bg5=3%, bg6=0%
 *   hover=+6%, pressed=-3%, selected=+3%
 *
 * Brand foreground overrides for dark mode contrast (Foundry pattern):
 *   colorBrandForeground1 uses step 110 instead of default
 */
export const voiceLiveDarkTheme: Theme = {
  ...createDarkTheme(purpleBrand),
  // Foundry dark background overrides (HSL step system)
  colorNeutralBackground1: 'hsl(0, 0%, 12%)',         // #1f1f1f
  colorNeutralBackground1Hover: 'hsl(0, 0%, 18%)',
  colorNeutralBackground1Pressed: 'hsl(0, 0%, 9%)',
  colorNeutralBackground1Selected: 'hsl(0, 0%, 15%)',
  colorNeutralBackground2: 'hsl(0, 0%, 10%)',         // #1a1a1a
  colorNeutralBackground2Hover: 'hsl(0, 0%, 16%)',
  colorNeutralBackground2Pressed: 'hsl(0, 0%, 7%)',
  colorNeutralBackground2Selected: 'hsl(0, 0%, 13%)',
  colorNeutralBackground3: 'hsl(0, 0%, 8%)',          // #141414
  colorNeutralBackground3Hover: 'hsl(0, 0%, 14%)',
  colorNeutralBackground3Pressed: 'hsl(0, 0%, 5%)',
  colorNeutralBackground3Selected: 'hsl(0, 0%, 11%)', // #1c1c1c
  colorNeutralBackground4: 'hsl(0, 0%, 6%)',
  colorNeutralBackground4Hover: 'hsl(0, 0%, 12%)',
  colorNeutralBackground4Pressed: 'hsl(0, 0%, 3%)',
  colorNeutralBackground4Selected: 'hsl(0, 0%, 9%)',
  colorNeutralBackground5: 'hsl(0, 0%, 3%)',
  colorNeutralBackground5Hover: 'hsl(0, 0%, 9%)',
  colorNeutralBackground5Pressed: 'hsl(0, 0%, 0%)',
  colorNeutralBackground5Selected: 'hsl(0, 0%, 6%)',
  colorNeutralBackground6: 'hsl(0, 0%, 0%)',
  colorNeutralBackgroundDisabled: 'hsl(0, 0%, 8%)',
  // Brand foreground contrast overrides (Foundry pattern)
  colorBrandForeground1: purpleBrand[110],
  colorBrandForeground2: purpleBrand[120],
  colorBrandForegroundLink: purpleBrand[140],
  colorNeutralForeground2BrandHover: purpleBrand[120],
  colorNeutralForeground2BrandSelected: purpleBrand[120],
};
