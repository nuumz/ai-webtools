// ISOLATED world: the only side that can talk to chrome.* APIs.
// It reads the rules from storage and hands them to the MAIN-world interceptor.
import { REQUEST_EVENT, STORAGE_KEYS, SYNC_EVENT, type MutationRule } from '../shared/types';

const syncRulesToMainWorld = async (): Promise<void> => {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.rules]);
    const rules: MutationRule[] = Array.isArray(stored[STORAGE_KEYS.rules])
      ? (stored[STORAGE_KEYS.rules] as MutationRule[])
      : [];

    // `detail` is serialised: objects created in this world are not directly
    // usable by page scripts, but a string always crosses the world boundary.
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: JSON.stringify(rules) }));
  } catch (err) {
    console.error('[Bridge] Error syncing rules:', err);
  }
};

// 1. The interceptor asks for rules as soon as it boots (it may miss the first push).
window.addEventListener(REQUEST_EVENT, () => {
  void syncRulesToMainWorld();
});

// 2. Push once on load…
void syncRulesToMainWorld();

// 3. …and on every edit made in the Side Panel, so changes apply without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.rules]) void syncRulesToMainWorld();
});
