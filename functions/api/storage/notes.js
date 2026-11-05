import { saveNotesForUser, fetchNotesForUser } from '../_db_d1/notes.js';
import { syncHandlers } from './_sync.js';

export const { onRequestGet, onRequestPost } = syncHandlers({
  fetch: fetchNotesForUser,
  save: saveNotesForUser,
  isValid: (c) => typeof c === 'string',
  field: 'content',
});
