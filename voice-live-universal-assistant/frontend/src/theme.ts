import { createLightTheme, createDarkTheme } from '@fluentui/react-components';
import type { BrandVariants, Theme } from '@fluentui/react-components';

/**
 * Foundry Portal brand ramp — exact values from
 * ADO msdata/Vienna/azure-ai-foundry packages/core/contexts/theme/src/themes.ts
 * Base color: #8251EE (Foundry's nextGenForegroundBrand)
 */
const purpleBrand: BrandVariants = {
  10: '#030206',
  20: '#1A1326',
  30: '#2B1D44',
  40: '#38255E',
  50: '#472E79',
  60: '#553695',
  70: '#643FB2',
  80: '#8251EE',  // Base — exact Foundry value
  90: '#8251EE',  // Same as 80 in Foundry's ramp
  100: '#9263F1',
  110: '#A175F3',
  120: '#AF86F5',
  130: '#BC98F7',
  140: '#C9AAF9',
  150: '#D5BCFB',
  160: '#E1CEFC',
};

/**
 * Font family tokens — matches Foundry Portal's fontFamilyTokens.
 * Foundry uses Aptos instead of Segoe UI.
 */
const fontFamilyOverrides = {
  fontFamilyBase: 'Aptos, sans-serif',
  fontFamilyMonospace: '"Aptos Mono", Menlo, Monaco, Consolas, monospace',
  fontFamilyNumeric: 'Aptos, sans-serif',
};

/**
 * Light theme — brand background uses step 70 (darker) per Foundry convention.
 */
export const voiceLiveLightTheme: Theme = {
  ...createLightTheme(purpleBrand),
  ...fontFamilyOverrides,
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
  ...fontFamilyOverrides,
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
