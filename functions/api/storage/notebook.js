import { jsonListStore, isItemList } from '../_db_d1/docs.js';
import { syncHandlers } from './_sync.js';

// Keep-style notes. Allowed to grow larger than the other documents, but kept under D1's 2 MB row limit.
export const { onRequestGet, onRequestPost } = syncHandlers({
  ...jsonListStore('notebook_state', 'notes'),
  isValid: isItemList,
  field: 'notes',
  maxBytes: 1024 * 1024,
});
