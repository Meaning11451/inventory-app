// Local, device-specific UI drafts. No cloud writes occur when a draft is restored.
export const WORKSPACE_KEY = 'inventory-workspace-v1';

export function createWorkspaceStore(getStorage) {
  return {
    read() {
      try {
        const value = JSON.parse(getStorage().getItem(WORKSPACE_KEY));
        return value?.version === 1 && typeof value.drafts === 'object' ? value : null;
      } catch { return null; }
    },
    write(snapshot) {
      try {
        getStorage().setItem(WORKSPACE_KEY, JSON.stringify({ ...snapshot, version: 1 }));
        return true;
      } catch { return false; }
    }
  };
}
