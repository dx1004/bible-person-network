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
const OLD_TESTAMENT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'
]);

export const PERSON_ERAS = ['旧约背景', '耶稣时期', '使徒时期', '时代待审'];

export function classifyPersonEra(person, books = []) {
  const editorNote = String(person?.editor_note || '').replace(/\s+/g, ' ').trim();
  const declaredTestaments = new Set(Array.isArray(person?.testaments) ? person.testaments : []);
  if (declaredTestaments.has('ot') && !declaredTestaments.has('nt')) return '旧约背景';
  if (OLD_TESTAMENT_ERA_PATTERN.test(editorNote)) return '旧约背景';
  if (books.some((book) => GOSPEL_BOOKS.has(String(book).toUpperCase()))) return '耶稣时期';
  if (declaredTestaments.has('nt')) return '使徒时期';
  if (books.some((book) => OLD_TESTAMENT_BOOKS.has(String(book).toUpperCase()))) return '旧约背景';
  if (books.length) return '使徒时期';
  return '时代待审';
}
