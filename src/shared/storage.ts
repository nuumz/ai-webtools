import {
  DEFAULT_FORM_FILL_FIELDS,
  STORAGE_KEYS,
  type FormFillField,
  type MutationRule,
} from './types';

const hasChromeStorage = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function loadRules(): Promise<MutationRule[]> {
  if (!hasChromeStorage()) return [];
  const stored = await chrome.storage.local.get([STORAGE_KEYS.rules]);
  const rules = stored[STORAGE_KEYS.rules];
  return Array.isArray(rules) ? (rules as MutationRule[]) : [];
}

export async function saveRules(rules: MutationRule[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.rules]: rules });
}

export async function loadFormFillFields(): Promise<FormFillField[]> {
  if (!hasChromeStorage()) return DEFAULT_FORM_FILL_FIELDS;
  const stored = await chrome.storage.local.get([STORAGE_KEYS.formFill]);
  const fields = stored[STORAGE_KEYS.formFill];
  return Array.isArray(fields) ? (fields as FormFillField[]) : DEFAULT_FORM_FILL_FIELDS;
}

export async function saveFormFillFields(fields: FormFillField[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.formFill]: fields });
}
