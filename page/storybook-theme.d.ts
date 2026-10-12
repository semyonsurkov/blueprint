export type BlueprintTheme = "dark" | "light";
interface ThemeChannel {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}
export const THEME_EVENT: string;
export const THEME_MESSAGE: string;
export const READY_MESSAGE: string;
export function storybookUrl(source: string, theme: BlueprintTheme): string;
export function connectStorybookFrame(frame: HTMLIFrameElement, origin: string, theme: () => BlueprintTheme): () => void;
export function connectStorybookManager(channel: ThemeChannel, applyTheme: (theme: BlueprintTheme) => void): () => void;
export function connectStorybookPreview(channel: ThemeChannel): {
  getTheme(): BlueprintTheme;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};
