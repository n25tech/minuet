import { jsonListStore, isItemList } from '../_db_d1/docs.js';
import { syncHandlers } from './_sync.js';

export const { onRequestGet, onRequestPost } = syncHandlers({
  ...jsonListStore('calendar_state', 'events'),
  isValid: isItemList,
  field: 'events',
});
