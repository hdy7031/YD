// Environment-neutral companion asset contract.
//
// The main process resolves assets from disk; renderer windows only consume the
// finished data URLs. Keeping the contract and the fallback chain here means the
// browser bundle never pulls in Node file APIs.
import { companionFallbackIdle } from './companion-fallback-idle.ts';
export interface CompanionAssetManifest {
  format: string;
  version: number;
  character?: string;
  canvas: { width: number; height: number };
  baseline?: number;
  bodyHeight?: number;
  states: Record<string, { file: string; label?: string; note?: string }>;
}

export interface CompanionAssets {
  available: boolean;
  // Human readable status for logs and the settings page.
  reason: string;
  source: string;
  manifest: CompanionAssetManifest | null;
  // state key -> data URL
  images: Record<string, string>;
  missing: string[];
  // Canvas aspect ratio, used to size the transparent window without distortion.
  aspect: number;
}

// Resolve the frame to show, walking the display state's fallback chain:
// requested asset -> declared neighbouring frames -> idle -> built-in idle of
// the very same character. There is no other character to fall back to.
export function companionFrame(images: Record<string, string>, asset: string, fallbacks: string[]): string | undefined {
  for (const key of [asset, ...fallbacks]) if (images[key]) return images[key];
  return images.idle ?? companionFallbackIdle;
}
