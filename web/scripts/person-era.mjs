const OLD_TESTAMENT_ERA_PATTERN = new RegExp(
  [
    'before the Flood',
    'before Israel[’\']s Monarchy',
    'the Patriarchs',
    'Egypt and Wilderness',
    'the Exodus',
    'the Conquest',
    'the Judges',
    'United Monarchy',
    'Divided Monarchy',
    'Exile and Return',
    'the Exile',
    'the Return'
  ].join('|'),
  'i'
);

const GOSPEL_BOOKS = new Set(['MAT', 'MRK', 'LUK', 'JHN']);

export const PERSON_ERAS = ['旧约背景', '耶稣时期', '使徒时期', '时代待审'];

export function classifyPersonEra(person, books = []) {
  const editorNote = String(person?.editor_note || '').replace(/\s+/g, ' ').trim();
  if (OLD_TESTAMENT_ERA_PATTERN.test(editorNote)) return '旧约背景';
  if (books.some((book) => GOSPEL_BOOKS.has(String(book).toUpperCase()))) return '耶稣时期';
  if (books.length) return '使徒时期';
  return '时代待审';
}
