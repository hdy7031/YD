/**
 * Small lifecycle slot for BrowserWindow references.
 *
 * Electron keeps the JavaScript wrapper around a destroyed BrowserWindow, so
 * a plain field can become a stale reference after `closed` / `webContents`
 * `destroyed`. The slot clears itself on read as a final synchronous guard;
 * Companion also clears it from the corresponding lifecycle events.
 */
export interface DestroyableCompanionWindow {
  isDestroyed(): boolean;
}

export class CompanionWindowSlot<T extends DestroyableCompanionWindow> {
  private value?: T;

  set(value: T): T {
    this.value = value;
    return value;
  }

  clear(value?: T): void {
    if (value === undefined || this.value === value) this.value = undefined;
  }

  get(): T | undefined {
    const value = this.value;
    if (!value || value.isDestroyed()) {
      this.value = undefined;
      return undefined;
    }
    return value;
  }
}
