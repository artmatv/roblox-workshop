export interface UiStyleDefinition {
  id: string;
  name: string;
  englishName: string;
  familyId: string;
  description: string;
  signature: string;
  referenceImage: string;
  palette: Record<
    "sky" | "ground" | "surface" | "primary" | "accent" | "ink" | "panel",
    string
  >;
  materials: string[];
  lighting: string;
  avatar: string;
  world: string;
  typography: string;
  hud: string;
  menu: string;
  shop: string;
  inventory: string;
  mobile: string;
  native: {
    font: string;
    bodyFont: string;
    cornerRadius: number;
    strokeThickness: number;
    minimumTouchTarget: number;
  };
  navigation: string[];
  components: string[];
}
export type PresetScreen = "hud" | "menu" | "shop" | "inventory";
export interface UiStylePreset extends UiStyleDefinition {
  version: string;
  skillHash: string;
  definitionHash: string;
  previews: Array<{
    screen: PresetScreen;
    device: "desktop" | "mobile";
    file: string;
    kind: "preset";
  }>;
  icon: string;
  iconSheet: string;
}
export interface UiStyleLibrary {
  items: UiStylePreset[];
  error: string | null;
}
