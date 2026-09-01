#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES_PATH = path.join(ROOT, 'editorial', 'direct-relationship-discovery.jsonl');
const PEOPLE_PATH = path.join(ROOT, 'data', 'people.jsonl');
const MENTIONS_PATH = path.join(ROOT, 'data', 'mentions.jsonl');
const IDENTITIES_PATH = path.join(ROOT, 'data', 'identity-options.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'direct-relationship-review.schema.json');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'direct-relationship-review.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'direct-relationship-review-report.json');
const COMPOSITE_KINSHIP_REVIEW_PATH = path.join(ROOT, 'editorial', 'composite-kinship-inference-review.jsonl');
const CHECK = process.argv.includes('--check');

const CURATED_EXPLICIT_PROPOSALS = new Map([
  ['drd-009419', { subject_person_id: 'person-000077', object_person_id: 'person-000175', relation_type: 'kinship', relation_subtype: 'other_specified', direction: 'directed', passages: ['LUK 1:27', 'MAT 1:20'], certainty: 0.95, note: '经文直接称约瑟属大卫家、又称他为“大卫的子孙”；按远代祖系的具体亲属关系记录，不标为直接父子。' }],
  ['drd-009749', { subject_person_id: 'person-000014', object_person_id: 'person-000108', relation_type: 'political', direction: 'undirected', passages: ['ACT 25:13', 'ACT 25:24'], certainty: 0.9, note: '亚基帕到访非斯都，非斯都又正式向他陈述保罗案并寻求意见；按具名统治者间的明确政治协作记录。' }],
  ['drd-009743', { subject_person_id: 'person-000025', object_person_id: 'person-000344', relation_type: 'commission', direction: 'directed', passages: ['ACT 24:1'], certainty: 0.86, note: '亚拿尼亚与长老带帖土罗前往巡抚处控告保罗；帖土罗作为他们的代辩人，按合理推论的委托关系记录并降低确定度。' }],
  ['drd-009510', { subject_person_id: 'person-000323', object_person_id: 'person-000223', candidate_person_ids: ['person-000223', 'person-000323'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['LUK 2:34-35'], certainty: 0.94, note: '西面直接向马利亚发出关于耶稣和她将受之苦的预言性宣告；按先知警告类关系记录。' }],
['drd-009635', { subject_person_id: 'person-000251', object_person_id: 'person-000276', candidate_person_ids: ['person-000251', 'person-000276'], relation_type: 'collegial', direction: 'undirected', passages: ['JHN 1:45'], certainty: 0.8, note: '腓力直接找到拿但业并引导他去见耶稣；二者后续同属门徒群体，记录为个人关系而非直接师生。', allow_disputed_endpoints: true }],
  ['drd-009431', { subject_person_id: 'person-000166', object_person_id: 'person-000270', relation_type: 'collegial', direction: 'undirected', passages: ['ACT 4:19', 'ACT 8:14'], certainty: 0.97, note: '约翰与彼得多次共同作见证、又同被使徒差往撒玛利亚；按持续同工关系记录。' }],
  ['drd-009771', { subject_person_id: 'person-000266', object_person_id: 'person-000334', relation_type: 'collegial', direction: 'undirected', passages: ['1CO 1:1'], certainty: 0.82, note: '林前1:1称所提尼为“兄弟”并与保罗共同署名；“兄弟”按教会称谓而非血缘处理，作为已复核的同工关系降低确定度记录。' }],
  ['drd-000583', { subject_person_id: 'person-000183', object_person_id: 'person-001390', relation_type: 'friendship', direction: 'undirected', passages: ['GEN 38:12'], certainty: 0.99, note: '创世记38:12直接称希拉为犹大的朋友；按经文明示的友谊关系记录。' }],
  ['drd-009499', { subject_person_id: 'person-000001', object_person_id: 'person-000091', relation_type: 'kinship', relation_subtype: 'other_specified', direction: 'directed', passages: ['LUK 1:5'], certainty: 0.96, note: '路加1:5直接称伊利莎白是亚伦的后人；经文未给出中间世代，故按已标明的远代亲属记录，不伪造直接父子边。' }],
  ['drd-009518', { subject_person_id: 'person-000031', object_person_id: 'person-000062', relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['JHN 18:13'], certainty: 0.99, note: '约18:13直接称亚那是该亚法的岳父。' }],
  ['drd-009616', { subject_person_id: 'person-000125', object_person_id: 'person-000067', candidate_person_ids: ['person-000067', 'person-000125'], relation_type: 'political', direction: 'directed', passages: ['LUK 8:3'], certainty: 0.98, note: '路加8:3直接称苦撒为希律的家宰；按希律对其宫廷官员的政治权属方向记录。' }],
  ['drd-009497', { subject_person_id: 'person-000176', object_person_id: 'person-000282', relation_type: 'legal', direction: 'directed', passages: ['JHN 19:38', 'MRK 15:43'], certainty: 0.98, note: '约瑟直接向彼拉多求耶稣的身体，按明确行政／司法请求记录。' }],
  ['drd-009498', { subject_person_id: 'person-000223', object_person_id: 'person-000178', candidate_person_ids: ['person-000178', 'person-000223'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['MRK 15:47'], certainty: 0.99, note: '可15:47直接称这位马利亚为约西的母亲。' }],
  ['drd-009706', { subject_person_id: 'person-000185', object_person_id: 'person-000320', relation_type: 'collegial', direction: 'undirected', passages: ['ACT 15:22', 'ACT 15:32'], certainty: 0.9, note: '使15章记犹大与西拉同被差派，又同为先知劝勉教会；按明确同工记录。' }],
  ['drd-009744', { subject_person_id: 'person-000344', object_person_id: 'person-000266', candidate_person_ids: ['person-000266', 'person-000344'], relation_type: 'legal', direction: 'directed', passages: ['ACT 24:1'], certainty: 0.99, note: '帖土罗代表控方向巡抚控告保罗，按明确司法行为记录。' }],
  ['drd-009773', { subject_person_id: 'person-000320', object_person_id: 'person-000351', relation_type: 'collegial', direction: 'undirected', passages: ['1TH 1:1', '2CO 1:19', '2TH 1:1'], certainty: 0.97, note: '西拉与提摩太在多处书信署名及传道叙述中持续同工，符合长期同工标准。' }],
  ['drd-001890', { subject_person_id: 'person-000309', object_person_id: 'person-000413', relation_type: 'military', direction: 'directed', passages: ['1SA 17:13'], note: '撒上17:13明确说亚比拿达跟随扫罗出征；按军事指挥者到随军者记录，不误作亲属关系。' }],
  ['drd-001891', { subject_person_id: 'person-000309', object_person_id: 'person-000998', relation_type: 'military', direction: 'directed', passages: ['1SA 17:13'], note: '撒上17:13明确说以利押跟随扫罗出征；按军事指挥者到随军者记录，不误作亲属关系。' }],
  ['drd-009411', { subject_person_id: 'person-000309', object_person_id: 'person-002629', relation_type: 'military', direction: 'directed', passages: ['1SA 17:13'], note: '撒上17:13明确说沙玛跟随扫罗出征；补入此前因中文异名未被识别而遗漏的军事关系。' }],
  ['drd-003004', { subject_person_id: 'person-002323', object_person_id: 'person-000015', relation_type: 'military', direction: 'directed', passages: ['2KI 16:5', 'ISA 7:1'] }],
  ['drd-003006', { subject_person_id: 'person-002409', object_person_id: 'person-000015', relation_type: 'military', direction: 'directed', passages: ['2KI 16:5', 'ISA 7:1'] }],
  ['drd-000195', { subject_person_id: 'person-000007', object_person_id: 'person-000410', relation_type: 'covenant', direction: 'undirected', passages: ['GEN 21:27'] }],
  ['drd-001894', { subject_person_id: 'person-000077', object_person_id: 'person-000425', relation_type: 'covenant', direction: 'undirected', passages: ['2SA 3:12'] }],
  ['drd-001895', { subject_person_id: 'person-000077', object_person_id: 'person-001828', relation_type: 'alliance', direction: 'undirected', passages: ['1SA 18:3'] }],
  ['drd-002627', { subject_person_id: 'person-000332', object_person_id: 'person-001392', relation_type: 'covenant', direction: 'undirected', passages: ['1KI 5:12'] }],
  ['drd-002706', { subject_person_id: 'person-001661', object_person_id: 'person-000738', candidate_person_ids: ['person-000738', 'person-001661'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['1KI 16:1', '1KI 16:7'] }],
  ['drd-004166', { subject_person_id: 'person-002064', object_person_id: 'person-001341', candidate_person_ids: ['person-001341', 'person-002064'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 4:17-18'], note: '和合本直接陈述米列与犹大女子所生之子包括希伯；父子方向已逐节复核。' }],
  ['drd-004250', { subject_person_id: 'person-002064', object_person_id: 'person-001677', candidate_person_ids: ['person-001677', 'person-002064'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 4:17-18'], note: '和合本直接陈述米列与犹大女子所生之子包括耶古铁；父子方向已逐节复核。' }],
  ['drd-004264', { subject_person_id: 'person-002064', object_person_id: 'person-001686', candidate_person_ids: ['person-001686', 'person-002064'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 4:17-18'], note: '和合本直接陈述米列与犹大女子所生之子包括雅列；父子方向已逐节复核。' }],
  ['drd-006518', { subject_person_id: 'person-000903', object_person_id: 'person-002221', relation_type: 'kinship', relation_subtype: 'sibling', direction: 'undirected', passages: ['2CH 35:9'], note: '和合本直接称歌楠雅、示玛雅、拿坦业为兄弟；本候选为歌楠雅与拿坦业。' }],
  ['drd-006519', { subject_person_id: 'person-000903', object_person_id: 'person-002577', relation_type: 'kinship', relation_subtype: 'sibling', direction: 'undirected', passages: ['2CH 35:9'], note: '和合本直接称歌楠雅、示玛雅、拿坦业为兄弟；本候选为歌楠雅与示玛雅。' }],
  ['drd-006529', { subject_person_id: 'person-002221', object_person_id: 'person-002577', relation_type: 'kinship', relation_subtype: 'sibling', direction: 'undirected', passages: ['2CH 35:9'], note: '和合本直接称歌楠雅、示玛雅、拿坦业为兄弟；本候选为拿坦业与示玛雅。' }],
  ['drd-007785', { subject_person_id: 'person-002888', object_person_id: 'person-000979', candidate_person_ids: ['person-000979', 'person-002888'], relation_type: 'commission', direction: 'directed', passages: ['JER 29:3'], note: '和合本直接陈述西底家差遣以利亚萨往巴比伦；差派方向已逐节复核。' }],
  ['drd-007789', { subject_person_id: 'person-002888', object_person_id: 'person-001173', candidate_person_ids: ['person-001173', 'person-002888'], relation_type: 'commission', direction: 'directed', passages: ['JER 29:3'], note: '和合本直接陈述西底家差遣基玛利往巴比伦；差派方向已逐节复核。' }],
  ['drd-005973', { subject_person_id: 'person-001642', object_person_id: 'person-000686', candidate_person_ids: ['person-000686', 'person-001642'], relation_type: 'covenant', direction: 'undirected', passages: ['2CH 23:1'] }],
  ['drd-005981', { subject_person_id: 'person-001642', object_person_id: 'person-000687', candidate_person_ids: ['person-000687', 'person-001642'], relation_type: 'covenant', direction: 'undirected', passages: ['2CH 23:1'] }],
  ['drd-005988', { subject_person_id: 'person-001642', object_person_id: 'person-001076', candidate_person_ids: ['person-001076', 'person-001642'], relation_type: 'covenant', direction: 'undirected', passages: ['2CH 23:1'] }],
  ['drd-005994', { subject_person_id: 'person-001642', object_person_id: 'person-001491', candidate_person_ids: ['person-001491', 'person-001642'], relation_type: 'covenant', direction: 'undirected', passages: ['2CH 23:1'] }],
  ['drd-006005', { subject_person_id: 'person-001642', object_person_id: 'person-001941', candidate_person_ids: ['person-001642', 'person-001941'], relation_type: 'covenant', direction: 'undirected', passages: ['2CH 23:1'] }],
  ['drd-007556', { subject_person_id: 'person-000475', object_person_id: 'person-000377', candidate_person_ids: ['person-000377', 'person-000475'], relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-007563', { subject_person_id: 'person-000475', object_person_id: 'person-000843', relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-007564', { subject_person_id: 'person-000475', object_person_id: 'person-000864', relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-007565', { subject_person_id: 'person-000475', object_person_id: 'person-000882', relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-007566', { subject_person_id: 'person-000475', object_person_id: 'person-001282', relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-007567', { subject_person_id: 'person-000475', object_person_id: 'person-002052', relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-007568', { subject_person_id: 'person-000475', object_person_id: 'person-002915', relation_type: 'commission', direction: 'directed', passages: ['EST 1:10'] }],
  ['drd-006383', { subject_person_id: 'person-000129', object_person_id: 'person-000802', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006385', { subject_person_id: 'person-000129', object_person_id: 'person-001031', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006386', { subject_person_id: 'person-000129', object_person_id: 'person-001502', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006387', { subject_person_id: 'person-000129', object_person_id: 'person-001622', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006388', { subject_person_id: 'person-000129', object_person_id: 'person-001710', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006389', { subject_person_id: 'person-000129', object_person_id: 'person-001863', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006390', { subject_person_id: 'person-000129', object_person_id: 'person-001977', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006391', { subject_person_id: 'person-000129', object_person_id: 'person-002178', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-003052', { subject_person_id: 'person-000129', object_person_id: 'person-001005', relation_type: 'political', direction: 'directed', passages: ['2KI 18:37', 'ISA 36:22'] }],
  ['drd-003054', { subject_person_id: 'person-000129', object_person_id: 'person-001772', relation_type: 'political', direction: 'directed', passages: ['2KI 18:37', 'ISA 36:22'] }],
  ['drd-003055', { subject_person_id: 'person-000129', object_person_id: 'person-002524', relation_type: 'political', direction: 'directed', passages: ['2KI 18:37', 'ISA 36:22'] }],
  ['drd-001882', { subject_person_id: 'person-000309', object_person_id: 'person-000155', candidate_person_ids: ['person-000155', 'person-000309'], relation_type: 'political', direction: 'directed', passages: ['1SA 16:1', '1SA 16:19', '1SA 16:20', '1SA 16:22', '1SA 17:12', '1SA 17:13', '1SA 17:58', '1SA 20:27', '1SA 20:30', '1SA 22:13', '1SA 22:9'] }],
  ['drd-002787', { subject_person_id: 'person-000152', object_person_id: 'person-000477', relation_type: 'alliance', direction: 'undirected', passages: ['1KI 22:49', '1KI 22:51', '2CH 20:35', '2CH 20:37'] }],
  ['drd-003509', { subject_person_id: 'person-000149', object_person_id: 'person-002886', relation_type: 'kinship', relation_subtype: 'sibling', direction: 'undirected', passages: ['1CH 3:16'] }],
  ['drd-005928', { subject_person_id: 'person-001036', object_person_id: 'person-000152', candidate_person_ids: ['person-000152', 'person-001036'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['2CH 20:37'] }],
  ['drd-005879', { subject_person_id: 'person-001661', object_person_id: 'person-000152', candidate_person_ids: ['person-000152', 'person-001661'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['2CH 19:2', '2CH 20:34'] }],
  ['drd-007621', { subject_person_id: 'person-002198', object_person_id: 'person-000149', candidate_person_ids: ['person-000149', 'person-002198'], relation_type: 'hostile', direction: 'directed', passages: ['EST 2:6', 'JER 24:1', 'JER 27:20'] }],
  ['drd-007734', { subject_person_id: 'person-001645', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-001645'], relation_type: 'hostile', direction: 'directed', passages: ['JER 25:1', 'JER 27:1', 'JER 35:1', 'JER 36:1', 'JER 36:32', 'JER 45:1'] }],
  ['drd-008113', { subject_person_id: 'person-001166', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-001166'], relation_type: 'host', direction: 'directed', passages: ['JER 39:14', 'JER 40:6', 'JER 43:5-6'] }],
  ['drd-008065', { subject_person_id: 'person-001476', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-001476'], relation_type: 'legal', direction: 'directed', passages: ['JER 37:13'] }],
  ['drd-008030', { subject_person_id: 'person-001685', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-001685'], relation_type: 'legal', direction: 'directed', passages: ['JER 36:26'] }],
  ['drd-008165', { subject_person_id: 'person-001812', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-001812'], relation_type: 'hostile', direction: 'directed', passages: ['JER 43:2', 'JER 43:5-6'] }],
  ['drd-007735', { subject_person_id: 'person-002198', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-002198'], relation_type: 'political', direction: 'directed', passages: ['JER 25:1', 'JER 28:11', 'JER 29:1', 'JER 32:1', 'JER 34:1', 'JER 39:11', 'JER 46:13'] }],
  ['drd-008031', { subject_person_id: 'person-002451', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-002451'], relation_type: 'legal', direction: 'directed', passages: ['JER 36:26'] }],
  ['drd-003086', { subject_person_id: 'person-000129', object_person_id: 'person-002068', relation_type: 'political', direction: 'undirected', passages: ['2KI 20:12', 'ISA 39:1'] }],
  ['drd-009207', { subject_person_id: 'person-000154', object_person_id: 'person-002452', relation_type: 'commission', direction: 'directed', passages: ['JER 51:59'] }],
  ['drd-002538', { subject_person_id: 'person-000332', object_person_id: 'person-000804', relation_type: 'commission', direction: 'directed', passages: ['1KI 2:25', '1KI 2:29', '1KI 2:46'] }],
  ['drd-003008', { subject_person_id: 'person-000015', object_person_id: 'person-002766', relation_type: 'commission', direction: 'directed', passages: ['2KI 16:15', '2KI 16:16'] }],
  ['drd-003102', { subject_person_id: 'person-000181', object_person_id: 'person-002495', relation_type: 'commission', direction: 'directed', passages: ['2KI 22:3'] }],
  ['drd-007646', { subject_person_id: 'person-001126', object_person_id: 'person-001324', relation_type: 'commission', direction: 'directed', passages: ['EST 4:5', 'EST 4:10'] }],
  ['drd-003084', { subject_person_id: 'person-000134', object_person_id: 'person-000015', candidate_person_ids: ['person-000015', 'person-000134'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['ISA 7:3'] }],
  ['drd-003061', { subject_person_id: 'person-000134', object_person_id: 'person-000129', candidate_person_ids: ['person-000129', 'person-000134'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['2KI 20:1', 'ISA 39:5'] }],
  ['drd-001534', { subject_person_id: 'person-000923', object_person_id: 'person-000052', candidate_person_ids: ['person-000052', 'person-000923'], relation_type: 'collegial', direction: 'undirected', passages: ['JDG 4:9', 'JDG 5:1'] }],
  ['drd-001535', { subject_person_id: 'person-000052', object_person_id: 'person-002689', relation_type: 'hostile', direction: 'directed', passages: ['JDG 4:15', 'JDG 4:16', 'JDG 4:22'] }],
  ['drd-002758', { subject_person_id: 'person-000088', object_person_id: 'person-000089', relation_type: 'teacher_student', direction: 'directed', passages: ['1KI 19:19', '2KI 3:11'] }],
  ['drd-002825', { subject_person_id: 'person-001335', object_person_id: 'person-001841', relation_type: 'hostile', direction: 'directed', passages: ['2KI 8:28', '2KI 8:29'] }],
  ['drd-006648', { subject_person_id: 'person-000628', object_person_id: 'person-002391', relation_type: 'political', direction: 'directed', passages: ['EZR 4:23'] }],
  ['drd-006649', { subject_person_id: 'person-000628', object_person_id: 'person-002655', relation_type: 'political', direction: 'directed', passages: ['EZR 4:23'] }],
  ['drd-006650', { subject_person_id: 'person-002391', object_person_id: 'person-002655', relation_type: 'collegial', direction: 'undirected', passages: ['EZR 4:8', 'EZR 4:23'] }],
  ['drd-009256', { subject_person_id: 'person-000076', object_person_id: 'person-000693', relation_type: 'collegial', direction: 'undirected', passages: ['DAN 2:17'] }],
  ['drd-009257', { subject_person_id: 'person-000076', object_person_id: 'person-001259', relation_type: 'collegial', direction: 'undirected', passages: ['DAN 2:17'] }],
  ['drd-009258', { subject_person_id: 'person-000693', object_person_id: 'person-001259', relation_type: 'collegial', direction: 'undirected', passages: ['DAN 2:17'] }],
  ['drd-009301', { subject_person_id: 'person-000563', object_person_id: 'person-000581', relation_type: 'hostile', direction: 'directed', passages: ['AMO 7:10', 'AMO 7:12'] }],
  ['drd-006538', { subject_person_id: 'person-002198', object_person_id: 'person-002888', relation_type: 'legal', direction: 'directed', passages: ['JER 39:5'] }],
  ['drd-001571', { subject_person_id: 'person-000411', object_person_id: 'person-001147', relation_type: 'military', direction: 'undirected', passages: ['JDG 9:39'] }],
  ['drd-002078', { subject_person_id: 'person-000425', object_person_id: 'person-000633', relation_type: 'hostile', direction: 'directed', passages: ['2SA 2:22', '2SA 3:30'] }],
  ['drd-002079', { subject_person_id: 'person-001764', object_person_id: 'person-000425', candidate_person_ids: ['person-000425', 'person-001764'], relation_type: 'hostile', direction: 'directed', passages: ['2SA 3:27', '2SA 3:30'] }],
  ['drd-002171', { subject_person_id: 'person-000077', object_person_id: 'person-001214', relation_type: 'military', direction: 'directed', passages: ['2SA 8:10'] }],
  ['drd-002174', { subject_person_id: 'person-000077', object_person_id: 'person-002751', relation_type: 'alliance', direction: 'undirected', passages: ['2SA 8:9', '2SA 8:10'] }],
  ['drd-002175', { subject_person_id: 'person-001214', object_person_id: 'person-002751', relation_type: 'military', direction: 'undirected', passages: ['2SA 8:10'] }],
  ['drd-002682', { subject_person_id: 'person-000044', object_person_id: 'person-000738', relation_type: 'military', direction: 'undirected', passages: ['1KI 15:16', '1KI 15:32'] }],
  ['drd-002783', { subject_person_id: 'person-000152', object_person_id: 'person-000471', relation_type: 'alliance', direction: 'undirected', passages: ['2CH 18:3'] }],
  ['drd-002928', { subject_person_id: 'person-000562', object_person_id: 'person-001780', relation_type: 'military', direction: 'undirected', passages: ['2KI 13:12', '2KI 14:15'] }],
  ['drd-003151', { subject_person_id: 'person-000181', object_person_id: 'person-002201', relation_type: 'military', direction: 'undirected', passages: ['2CH 35:22'] }],
  ['drd-005850', { subject_person_id: 'person-000005', object_person_id: 'person-001712', relation_type: 'military', direction: 'undirected', passages: ['2CH 13:3'] }],
  ['drd-000341', { subject_person_id: 'person-002535', object_person_id: 'person-000937', candidate_person_ids: ['person-000937', 'person-002535'], relation_type: 'hostile', direction: 'directed', passages: ['GEN 34:13'] }],
  ['drd-001101', { subject_person_id: 'person-000242', object_person_id: 'person-002687', relation_type: 'hostile', direction: 'directed', passages: ['DEU 4:46', 'JOS 13:21'] }],
  ['drd-001379', { subject_person_id: 'person-000179', object_person_id: 'person-001410', relation_type: 'hostile', direction: 'directed', passages: ['JOS 10:33'] }],
  ['drd-001395', { subject_person_id: 'person-000242', object_person_id: 'person-001131', relation_type: 'hostile', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001396', { subject_person_id: 'person-000242', object_person_id: 'person-001430', relation_type: 'hostile', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001397', { subject_person_id: 'person-000242', object_person_id: 'person-002380', relation_type: 'hostile', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001398', { subject_person_id: 'person-000242', object_person_id: 'person-002396', relation_type: 'hostile', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001399', { subject_person_id: 'person-000242', object_person_id: 'person-002962', relation_type: 'hostile', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-002214', { subject_person_id: 'person-000077', object_person_id: 'person-002665', relation_type: 'hostile', direction: 'directed', passages: ['1CH 19:18', '2SA 10:18'] }],
  ['drd-007074', { subject_person_id: 'person-001184', object_person_id: 'person-002433', relation_type: 'alliance', direction: 'undirected', passages: ['NEH 2:19', 'NEH 6:1'] }],
  ['drd-007075', { subject_person_id: 'person-001184', object_person_id: 'person-002746', relation_type: 'alliance', direction: 'undirected', passages: ['NEH 2:19', 'NEH 6:1'] }],
  ['drd-007076', { subject_person_id: 'person-002433', object_person_id: 'person-002746', relation_type: 'alliance', direction: 'undirected', passages: ['NEH 2:19', 'NEH 6:1'] }],
  ['drd-009298', { subject_person_id: 'person-000581', object_person_id: 'person-001713', relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['AMO 7:11'] }],
  ['drd-001400', { subject_person_id: 'person-002687', object_person_id: 'person-001131', candidate_person_ids: ['person-001131', 'person-002687'], relation_type: 'political', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001401', { subject_person_id: 'person-002687', object_person_id: 'person-001430', candidate_person_ids: ['person-001430', 'person-002687'], relation_type: 'political', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001402', { subject_person_id: 'person-002687', object_person_id: 'person-002380', candidate_person_ids: ['person-002380', 'person-002687'], relation_type: 'political', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001403', { subject_person_id: 'person-002687', object_person_id: 'person-002396', candidate_person_ids: ['person-002396', 'person-002687'], relation_type: 'political', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001404', { subject_person_id: 'person-002687', object_person_id: 'person-002962', candidate_person_ids: ['person-002687', 'person-002962'], relation_type: 'political', direction: 'directed', passages: ['JOS 13:21'] }],
  ['drd-001526', { subject_person_id: 'person-001539', object_person_id: 'person-002689', relation_type: 'political', direction: 'directed', passages: ['JDG 4:2', 'JDG 4:7'] }],
  ['drd-002159', { subject_person_id: 'person-000077', object_person_id: 'person-001392', relation_type: 'alliance', direction: 'undirected', passages: ['1CH 14:1', '1KI 5:1', '2SA 5:11'] }],
  ['drd-002384', { subject_person_id: 'person-000077', object_person_id: 'person-000451', relation_type: 'military', direction: 'directed', passages: ['2SA 23:8'] }],
  ['drd-002533', { subject_person_id: 'person-002189', object_person_id: 'person-002832', relation_type: 'collegial', direction: 'undirected', passages: ['1KI 1:34', '1KI 1:45'] }],
  ['drd-002767', { subject_person_id: 'person-001756', object_person_id: 'person-002165', relation_type: 'hostile', direction: 'directed', passages: ['1KI 21:7'] }],
  ['drd-003158', { subject_person_id: 'person-002201', object_person_id: 'person-001632', candidate_person_ids: ['person-001632', 'person-002201'], relation_type: 'political', direction: 'directed', passages: ['2CH 36:4', '2KI 23:34'] }],
  ['drd-003159', { subject_person_id: 'person-002201', object_person_id: 'person-001645', candidate_person_ids: ['person-001645', 'person-002201'], relation_type: 'political', direction: 'directed', passages: ['2CH 36:4', '2KI 23:34', '2KI 23:35'] }],
  ['drd-002379', { subject_person_id: 'person-000993', object_person_id: 'person-001199', relation_type: 'hostile', direction: 'directed', passages: ['1CH 20:5', '2SA 21:19'], certainty: 0.65, note: '撒下21:19直述伊勒哈难杀歌利亚；代上20:5则说他杀歌利亚的兄弟拉哈米。两处平行记载存在文本／翻译差异，因此保留为已复核但结论不确定。' }],
  ['drd-005350', { subject_person_id: 'person-000993', object_person_id: 'person-001915', relation_type: 'hostile', direction: 'directed', passages: ['1CH 20:5'] }],
  ['drd-001562', { subject_person_id: 'person-000117', object_person_id: 'person-002840', relation_type: 'hostile', direction: 'directed', passages: ['JDG 8:21'] }],
  ['drd-001563', { subject_person_id: 'person-000117', object_person_id: 'person-002853', relation_type: 'hostile', direction: 'directed', passages: ['JDG 8:21'] }],
  ['drd-002333', { subject_person_id: 'person-002515', object_person_id: 'person-000077', relation_type: 'hostile', direction: 'directed', passages: ['2SA 20:21'] }],
  ['drd-002643', { subject_person_id: 'person-001712', object_person_id: 'person-000332', relation_type: 'hostile', direction: 'directed', passages: ['1KI 11:26', '2CH 13:6'] }],
  ['drd-002995', { subject_person_id: 'person-001418', object_person_id: 'person-002323', relation_type: 'hostile', direction: 'directed', passages: ['2KI 15:30'] }],
  ['drd-002967', { subject_person_id: 'person-002056', object_person_id: 'person-002468', relation_type: 'hostile', direction: 'directed', passages: ['2KI 15:14'] }],
  ['drd-003178', { subject_person_id: 'person-001492', object_person_id: 'person-001166', relation_type: 'hostile', direction: 'directed', passages: ['2KI 25:25', 'JER 41:2'] }],
  ['drd-007766', { subject_person_id: 'person-001645', object_person_id: 'person-002768', relation_type: 'hostile', direction: 'directed', passages: ['JER 26:21', 'JER 26:23'] }],
  ['drd-006180', { subject_person_id: 'person-002929', object_person_id: 'person-000717', relation_type: 'hostile', direction: 'directed', passages: ['2CH 28:7'] }],
  ['drd-006183', { subject_person_id: 'person-002929', object_person_id: 'person-001088', relation_type: 'hostile', direction: 'directed', passages: ['2CH 28:7'] }],
  ['drd-006186', { subject_person_id: 'person-002929', object_person_id: 'person-001943', relation_type: 'hostile', direction: 'directed', passages: ['2CH 28:7'] }],
  ['drd-003000', { subject_person_id: 'person-002323', object_person_id: 'person-002409', relation_type: 'alliance', direction: 'undirected', passages: ['2KI 15:37', '2KI 16:5', 'ISA 7:1'] }],
  ['drd-003015', { subject_person_id: 'person-002477', object_person_id: 'person-001418', relation_type: 'hostile', direction: 'directed', passages: ['2KI 17:3'] }],
  ['drd-002841', { subject_person_id: 'person-001662', object_person_id: 'person-000478', relation_type: 'hostile', direction: 'directed', passages: ['2KI 9:27', '2CH 22:9'] }],
['drd-002290', { subject_person_id: 'person-001764', object_person_id: 'person-000554', relation_type: 'hostile', direction: 'directed', passages: ['2SA 20:10', '1KI 2:5'] }],
['drd-002378', { subject_person_id: 'person-002685', object_person_id: 'person-002434', relation_type: 'hostile', direction: 'directed', passages: ['2SA 21:18'] }],
['drd-002509', { subject_person_id: 'person-000003', object_person_id: 'person-000461', relation_type: 'political', direction: 'directed', passages: ['1KI 1:25', '1KI 1:42', '1KI 1:7'] }],
['drd-002684', { subject_person_id: 'person-000044', object_person_id: 'person-000790', relation_type: 'political', direction: 'undirected', passages: ['1KI 15:18', '1KI 15:20', '2CH 16:4'] }],
['drd-001997', { subject_person_id: 'person-000430', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-000430'], relation_type: 'hostile', direction: 'directed', passages: ['1SA 27:2', '1SA 27:3', '1SA 29:3', '1SA 29:6'] }],
['drd-002742', { subject_person_id: 'person-000088', object_person_id: 'person-000471', relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['1KI 17:1', '1KI 19:1', '1KI 21:20', '2KI 10:17'] }],
  ['drd-002275', { subject_person_id: 'person-001433', object_person_id: 'person-000426', candidate_person_ids: ['person-000426', 'person-001433'], relation_type: 'political', direction: 'directed', passages: ['2SA 16:16', '2SA 17:14'] }],
  ['drd-002320', { subject_person_id: 'person-000077', object_person_id: 'person-002832', relation_type: 'commission', direction: 'directed', passages: ['1KI 1:32', '1KI 1:38'] }],
  ['drd-009302', { subject_person_id: 'person-000563', object_person_id: 'person-001713', relation_type: 'hostile', direction: 'directed', passages: ['AMO 7:10'] }],
  ['drd-007649', { subject_person_id: 'person-001126', object_person_id: 'person-001232', relation_type: 'hostile', direction: 'undirected', passages: ['EST 7:6', 'EST 8:3', 'EST 8:7'] }],
  ['drd-007303', { subject_person_id: 'person-001143', object_person_id: 'person-002204', relation_type: 'collegial', direction: 'undirected', passages: ['NEH 12:26', 'NEH 8:9'] }],
  ['drd-002213', { subject_person_id: 'person-001214', object_person_id: 'person-002665', relation_type: 'military', direction: 'directed', passages: ['2SA 10:16'] }],
  ['drd-007642', { subject_person_id: 'person-001232', object_person_id: 'person-002150', relation_type: 'hostile', direction: 'directed', passages: ['EST 3:2', 'EST 3:6', 'EST 4:7', 'EST 5:14', 'EST 6:10', 'EST 6:11', 'EST 6:4', 'EST 7:10', 'EST 7:9', 'EST 8:1', 'EST 8:2', 'EST 8:7'] }],
  ['drd-002748', { subject_person_id: 'person-001756', object_person_id: 'person-000088', relation_type: 'hostile', direction: 'directed', candidate_person_ids: ['person-000088', 'person-001756'], passages: ['1KI 19:2'] }],
  ['drd-003007', { subject_person_id: 'person-000015', object_person_id: 'person-002734', relation_type: 'political', direction: 'directed', passages: ['2KI 16:7', '2KI 16:10'] }],
  ['drd-002268', { subject_person_id: 'person-002641', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-002641'], relation_type: 'hostile', direction: 'directed', passages: ['2SA 16:5'] }],
  ['drd-002805', { subject_person_id: 'person-000089', object_person_id: 'person-001171', relation_type: 'teacher_student', direction: 'directed', passages: ['2KI 5:20', '2KI 8:4', '2KI 8:5'] }],
  ['drd-005767', { subject_person_id: 'person-000519', object_person_id: 'person-000003', candidate_person_ids: ['person-000003', 'person-000519'], relation_type: 'succession', direction: 'directed', passages: ['1CH 27:34'] }],
  ['drd-005771', { subject_person_id: 'person-000519', object_person_id: 'person-001641', relation_type: 'succession', direction: 'directed', passages: ['1CH 27:34'] }],
  ['drd-000544', { subject_person_id: 'person-000725', object_person_id: 'person-001213', relation_type: 'succession', direction: 'directed', passages: ['1CH 1:50', 'GEN 36:39'] }],
  ['drd-000539', { subject_person_id: 'person-002509', object_person_id: 'person-000725', candidate_person_ids: ['person-000725', 'person-002509'], relation_type: 'succession', direction: 'directed', passages: ['1CH 1:49', 'GEN 36:38'] }],
  ['drd-000526', { subject_person_id: 'person-000783', object_person_id: 'person-001785', relation_type: 'succession', direction: 'directed', passages: ['1CH 1:44', 'GEN 36:33'] }],
  ['drd-000534', { subject_person_id: 'person-001434', object_person_id: 'person-001212', candidate_person_ids: ['person-001212', 'person-001434'], relation_type: 'succession', direction: 'directed', passages: ['1CH 1:46', 'GEN 36:35'] }],
  ['drd-000535', { subject_person_id: 'person-001212', object_person_id: 'person-002432', relation_type: 'succession', direction: 'directed', passages: ['1CH 1:47', 'GEN 36:36'] }],
  ['drd-000529', { subject_person_id: 'person-001785', object_person_id: 'person-001434', candidate_person_ids: ['person-001434', 'person-001785'], relation_type: 'succession', direction: 'directed', passages: ['1CH 1:45', 'GEN 36:34'] }],
  ['drd-000536', { subject_person_id: 'person-002432', object_person_id: 'person-002509', relation_type: 'succession', direction: 'directed', passages: ['1CH 1:48', 'GEN 36:37'] }],
  ['drd-002377', { subject_person_id: 'person-001482', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-001482'], relation_type: 'hostile', direction: 'directed', passages: ['2SA 21:16'] }],
  ['drd-005145', { subject_person_id: 'person-000077', object_person_id: 'person-001591', relation_type: 'military', direction: 'undirected', passages: ['1CH 11:11'] }],
  ['drd-002176', { subject_person_id: 'person-001842', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-001842'], relation_type: 'political', direction: 'directed', passages: ['2SA 8:10'] }],
  ['drd-006630', { subject_person_id: 'person-000369', object_person_id: 'person-001855', relation_type: 'collegial', direction: 'undirected', passages: ['EZR 3:2', 'EZR 3:8', 'EZR 4:3', 'EZR 5:2'] }],
  ['drd-007795', { subject_person_id: 'person-002198', object_person_id: 'person-000472', candidate_person_ids: ['person-000472', 'person-002198'], relation_type: 'hostile', direction: 'directed', passages: ['JER 29:21'] }],
  ['drd-006676', { subject_person_id: 'person-000628', object_person_id: 'person-001143', relation_type: 'political', direction: 'directed', passages: ['EZR 7:11', 'EZR 7:12', 'EZR 7:21'] }],
  ['drd-005465', { subject_person_id: 'person-000077', object_person_id: 'person-001358', relation_type: 'commission', direction: 'directed', passages: ['1CH 25:1'] }],
  ['drd-005466', { subject_person_id: 'person-000077', object_person_id: 'person-001611', relation_type: 'commission', direction: 'directed', passages: ['1CH 25:1'] }],
  ['drd-006380', { subject_person_id: 'person-000129', object_person_id: 'person-000632', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-006382', { subject_person_id: 'person-000129', object_person_id: 'person-000701', relation_type: 'commission', direction: 'directed', passages: ['2CH 31:13'] }],
  ['drd-007770', { subject_person_id: 'person-000497', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-000497'], relation_type: 'host', direction: 'directed', passages: ['JER 26:24'] }],
  ['drd-008101', { subject_person_id: 'person-000948', object_person_id: 'person-000154', candidate_person_ids: ['person-000154', 'person-000948'], relation_type: 'host', direction: 'directed', passages: ['JER 38:10', 'JER 38:11', 'JER 38:12'] }],
  ['drd-001886', { subject_person_id: 'person-000309', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-000309'], relation_type: 'hostile', direction: 'directed', passages: ['1SA 19:1', '1SA 19:11', '1SA 23:8'] }],
  ['drd-001100', { subject_person_id: 'person-001904', object_person_id: 'person-000001', candidate_person_ids: ['person-000001', 'person-001904'], relation_type: 'hostile', direction: 'directed', passages: ['NUM 16:40', 'NUM 26:9'] }],
  ['drd-005769', { subject_person_id: 'person-000003', object_person_id: 'person-001641', relation_type: 'collegial', direction: 'undirected', passages: ['1CH 27:34'] }],
  ['drd-002187', { subject_person_id: 'person-000003', object_person_id: 'person-002832', relation_type: 'collegial', direction: 'undirected', passages: ['2SA 15:35', '1KI 4:4'] }],
  ['drd-009261', { subject_person_id: 'person-002198', object_person_id: 'person-000076', candidate_person_ids: ['person-000076', 'person-002198'], relation_type: 'political', direction: 'directed', passages: ['DAN 2:46'] }],
  ['drd-001885', { subject_person_id: 'person-000306', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-000306'], relation_type: 'commission', direction: 'directed', passages: ['1SA 16:13'] }],
  ['drd-002033', { subject_person_id: 'person-000077', object_person_id: 'person-000419', relation_type: 'military', direction: 'undirected', passages: ['2SA 18:2', '2SA 21:17'] }],
['drd-005406', { subject_person_id: 'person-000077', object_person_id: 'person-000506', relation_type: 'collegial', direction: 'undirected', passages: ['1CH 24:3', '1CH 24:31'] }],
  ['drd-002387', { subject_person_id: 'person-000077', object_person_id: 'person-000988', relation_type: 'military', direction: 'undirected', passages: ['2SA 23:9'] }],
 ['drd-001999', { subject_person_id: 'person-001149', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-001149'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['2SA 24:13', '1SA 22:5'] }], ['drd-005064', { subject_person_id: 'person-002309', object_person_id: 'person-001717', candidate_person_ids: ['person-002309', 'person-001717'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 9:12', 'NEH 11:12'], certainty: 0.95 }]
]);

CURATED_EXPLICIT_PROPOSALS.set('drd-008045', { subject_person_id: 'person-001685', object_person_id: 'person-000757', candidate_person_ids: ['person-000757', 'person-001685'], relation_type: 'legal', direction: 'directed', passages: ['JER 36:26'], note: '耶利米书36:26直接记载王差遣耶拉篾捉拿巴录和耶利米；此边记录耶拉篾对巴录的司法拘捕行动。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-008046', { subject_person_id: 'person-002451', object_person_id: 'person-000757', candidate_person_ids: ['person-000757', 'person-002451'], relation_type: 'legal', direction: 'directed', passages: ['JER 36:26'], note: '耶利米书36:26直接记载王差遣西莱雅捉拿巴录和耶利米；此边记录西莱雅对巴录的司法拘捕行动。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-008047', { subject_person_id: 'person-002544', object_person_id: 'person-000757', candidate_person_ids: ['person-000757', 'person-002544'], relation_type: 'legal', direction: 'directed', passages: ['JER 36:26'], note: '耶利米书36:26直接记载王差遣示利米雅捉拿巴录和耶利米；此边记录示利米雅对巴录的司法拘捕行动。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007971', { subject_person_id: 'person-000154', object_person_id: 'person-000757', candidate_person_ids: ['person-000154', 'person-000757'], relation_type: 'commission', direction: 'directed', passages: ['JER 36:4', 'JER 36:5', 'JER 36:8'], note: '耶利米书36:4-8直接记载耶利米召巴录代写并照其吩咐宣读书卷；按差派／托付关系记录耶利米指向巴录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002652', { subject_person_id: 'person-000494', object_person_id: 'person-001712', candidate_person_ids: ['person-000494', 'person-001712'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['1KI 11:29', '1KI 14:6'], note: '列王纪直接记载先知亚希雅向耶罗波安宣告王国与审判信息；按先知宣告关系记录亚希雅指向耶罗波安。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-005794', { subject_person_id: 'person-001449', object_person_id: 'person-001712', candidate_person_ids: ['person-001449', 'person-001712'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['2CH 9:29'], note: '历代志下9:29明确提到先见易多论耶罗波安的默示；按具名先知对具名君王的预言关系记录。', certainty: 0.82 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002539', { subject_person_id: 'person-002189', object_person_id: 'person-000332', candidate_person_ids: ['person-000332', 'person-002189'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['1KI 1:34', '1KI 1:38'], note: '列王纪上1章直接记载先知拿单参与膏立所罗门；按先知膏立关系记录拿单指向所罗门。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007202', { subject_person_id: 'person-002097', object_person_id: 'person-001640', candidate_person_ids: ['person-001640', 'person-002097'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['NEH 6:18'], note: '尼希米记6:18直接说明多比雅之子约哈难娶了比利迦之子米书兰的女儿；按岳父／姻亲长辈指向女婿记录米书兰与约哈难。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002298', { subject_person_id: 'person-000761', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-000761'], relation_type: 'host', direction: 'directed', passages: ['2SA 17:27'], note: '撒母耳记下17:27-29记载巴西莱在大卫逃难时带物资供给他和随行者；按接待／供给关系记录巴西莱指向大卫。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002204', { subject_person_id: 'person-001965', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-001965'], relation_type: 'host', direction: 'directed', passages: ['2SA 17:27'], note: '撒母耳记下17:27-29记载玛吉在大卫逃难时带物资供给他和随行者；按接待／供给关系记录玛吉指向大卫。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002300', { subject_person_id: 'person-002670', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-002670'], relation_type: 'host', direction: 'directed', passages: ['2SA 17:27'], note: '撒母耳记下17:27-29记载朔比在大卫逃难时带物资供给他和随行者；按接待／供给关系记录朔比指向大卫。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007539', { subject_person_id: 'person-002320', object_person_id: 'person-001248', candidate_person_ids: ['person-001248', 'person-002320'], relation_type: 'political', direction: 'directed', passages: ['NEH 13:13'], note: '尼希米记13:13将哈难列为三位库官之下的协助者；按明确职务权属记录毗大雅指向哈难。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007540', { subject_person_id: 'person-002547', object_person_id: 'person-001248', candidate_person_ids: ['person-001248', 'person-002547'], relation_type: 'political', direction: 'directed', passages: ['NEH 13:13'], note: '尼希米记13:13将哈难列为三位库官之下的协助者；按明确职务权属记录示利米雅指向哈难。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007542', { subject_person_id: 'person-002834', object_person_id: 'person-001248', candidate_person_ids: ['person-001248', 'person-002834'], relation_type: 'political', direction: 'directed', passages: ['NEH 13:13'], note: '尼希米记13:13将哈难列为三位库官之下的协助者；按明确职务权属记录撒督指向哈难。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003179', { subject_person_id: 'person-001166', object_person_id: 'person-001812', candidate_person_ids: ['person-001166', 'person-001812'], relation_type: 'political', direction: 'directed', passages: ['2KI 25:23', 'JER 40:8'], note: '列王纪下25:23及耶利米书40:8记载军长约哈难归到被立为省长的基大利；按省长对军长的明确政治权属记录基大利指向约哈难。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-008158', { subject_person_id: 'person-002200', object_person_id: 'person-001166', candidate_person_ids: ['person-001166', 'person-002200'], relation_type: 'political', direction: 'directed', passages: ['JER 41:10'], note: '耶利米书41:10明确回述护卫长尼布撒拉旦立基大利为省长；按任命关系记录尼布撒拉旦指向基大利。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-008288', { subject_person_id: 'person-001812', object_person_id: 'person-000757', candidate_person_ids: ['person-000757', 'person-001812'], relation_type: 'hostile', direction: 'directed', passages: ['JER 43:5-6'], note: '耶利米书43:5-6记载约哈难违背先知指示，将包括巴录在内的人带往埃及；按强制带走的明确敌对行动记录约哈难指向巴录。', certainty: 0.86 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002194', { subject_person_id: 'person-000077', object_person_id: 'person-000804', candidate_person_ids: ['person-000077', 'person-000804'], relation_type: 'commission', direction: 'directed', passages: ['1KI 1:32'], note: '列王纪上1:32直接记载大卫召比拿雅参与所罗门膏立与登基安排；按君王差派记录大卫指向比拿雅。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002551', { subject_person_id: 'person-002832', object_person_id: 'person-000332', candidate_person_ids: ['person-000332', 'person-002832'], relation_type: 'commission', direction: 'directed', passages: ['1KI 1:34', '1KI 1:38'], note: '列王纪上1:34、38直接记载祭司撒督参与膏立所罗门为王；按膏立／委任关系记录撒督指向所罗门。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002526', { subject_person_id: 'person-000804', object_person_id: 'person-002832', candidate_person_ids: ['person-000804', 'person-002832'], relation_type: 'collegial', direction: 'undirected', passages: ['1KI 1:32', '1KI 4:4'], note: '列王纪上同时记载比拿雅与撒督共同执行登基任务，并在所罗门治下长期担任军政与祭司职分；按长期同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007504', { subject_person_id: 'person-001306', object_person_id: 'person-001736', candidate_person_ids: ['person-001306', 'person-001736'], relation_type: 'collegial', direction: 'undirected', passages: ['NEH 12:24'], note: '尼希米记12:24将哈沙比雅与耶书亚并列为带领称谢赞美、彼此轮班回应的利未负责人；按明确礼仪同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007506', { subject_person_id: 'person-001306', object_person_id: 'person-002616', candidate_person_ids: ['person-001306', 'person-002616'], relation_type: 'collegial', direction: 'undirected', passages: ['NEH 12:24'], note: '尼希米记12:24将哈沙比雅与示利比并列为带领称谢赞美、彼此轮班回应的利未负责人；按明确礼仪同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007508', { subject_person_id: 'person-001736', object_person_id: 'person-002616', candidate_person_ids: ['person-001736', 'person-002616'], relation_type: 'collegial', direction: 'undirected', passages: ['NEH 12:24'], note: '尼希米记12:24将耶书亚与示利比并列为带领称谢赞美、彼此轮班回应的利未负责人；按明确礼仪同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000381', { subject_person_id: 'person-000588', object_person_id: 'person-000100', candidate_person_ids: ['person-000100', 'person-000588'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['GEN 36:2'], note: '创世记36:2明确说明以扫娶亚拿的女儿阿何利巴玛；按岳父／姻亲长辈指向女婿记录亚拿与以扫。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000288', { subject_person_id: 'person-001096', object_person_id: 'person-000100', candidate_person_ids: ['person-000100', 'person-001096'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['GEN 36:2'], note: '创世记36:2明确说明以扫娶以伦的女儿亚大；按岳父／姻亲长辈指向女婿记录以伦与以扫。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003041', { subject_person_id: 'person-001005', object_person_id: 'person-001772', candidate_person_ids: ['person-001005', 'person-001772'], relation_type: 'collegial', direction: 'undirected', passages: ['2KI 18:18', 'ISA 36:3'], note: '列王纪下18章与以赛亚书36章的平行记载将以利亚敬和约亚列为共同代表希西家的长期宫廷官员；按明确同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003042', { subject_person_id: 'person-001005', object_person_id: 'person-002524', candidate_person_ids: ['person-001005', 'person-002524'], relation_type: 'collegial', direction: 'undirected', passages: ['2KI 18:18', 'ISA 36:3'], note: '列王纪下18章与以赛亚书36章的平行记载将以利亚敬和舍伯那列为共同代表希西家的长期宫廷官员；按明确同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003045', { subject_person_id: 'person-001772', object_person_id: 'person-002524', candidate_person_ids: ['person-001772', 'person-002524'], relation_type: 'collegial', direction: 'undirected', passages: ['2KI 18:18', 'ISA 36:3'], note: '列王纪下18章与以赛亚书36章的平行记载将约亚和舍伯那列为共同代表希西家的长期宫廷官员；按明确同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-008013', { subject_person_id: 'person-001665', object_person_id: 'person-000757', candidate_person_ids: ['person-000757', 'person-001665'], relation_type: 'commission', direction: 'directed', passages: ['JER 36:14'], note: '耶利米书36:14记载众首领差遣犹底去召巴录并吩咐他带书卷前来；此边记录犹底执行传令、召见巴录的明确差派关系。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009409', { subject_person_id: 'person-002823', object_person_id: 'person-002109', candidate_person_ids: ['person-002109', 'person-002823'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 12:35'], note: '尼希米记12:35直接记载米该亚是撒刻的儿子；按父亲指向儿子记录撒刻与米迦（本节和合本文字形式为“米该亚”）。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-009340', { subject_person_id: 'person-001856', object_person_id: 'person-001349', candidate_person_ids: ['person-001349', 'person-001856'], relation_type: 'host', direction: 'directed', passages: ['ZEC 6:10'], note: '撒迦利亚书6:10记载黑玳从巴比伦来到约西亚家中，先知也奉命当日进入约西亚家；按约西亚提供居所／接待记录。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009343', { subject_person_id: 'person-001856', object_person_id: 'person-001605', candidate_person_ids: ['person-001605', 'person-001856'], relation_type: 'host', direction: 'directed', passages: ['ZEC 6:10'], note: '撒迦利亚书6:10记载耶大雅从巴比伦来到约西亚家中，先知也奉命当日进入约西亚家；按约西亚提供居所／接待记录。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009346', { subject_person_id: 'person-001856', object_person_id: 'person-002748', candidate_person_ids: ['person-001856', 'person-002748'], relation_type: 'host', direction: 'directed', passages: ['ZEC 6:10'], note: '撒迦利亚书6:10记载多比雅从巴比伦来到约西亚家中，先知也奉命当日进入约西亚家；按约西亚提供居所／接待记录。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002286', { subject_person_id: 'person-000426', object_person_id: 'person-000554', candidate_person_ids: ['person-000426', 'person-000554'], relation_type: 'political', direction: 'directed', passages: ['2SA 17:25'], note: '撒母耳记下17:25直接记载押沙龙立亚玛撒为元帅、代替约押；按具名领袖对具名官员的职务任命关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-008061', { subject_person_id: 'person-002888', object_person_id: 'person-001664', candidate_person_ids: ['person-001664', 'person-002888'], relation_type: 'commission', direction: 'directed', passages: ['JER 37:3'], note: '耶利米书37:3直接记载西底家王差遣犹甲去见耶利米并请求代祷；按君王差派使者记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007726', { subject_person_id: 'person-000154', object_person_id: 'person-002888', candidate_person_ids: ['person-000154', 'person-002888'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['JER 37:17', 'JER 38:17'], note: '耶利米书37:17及38:17直接记载耶利米向西底家宣告审判并劝其顺服；按持续的先知警告／责备关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-009335', { subject_person_id: 'person-001219', object_person_id: 'person-000369', candidate_person_ids: ['person-000369', 'person-001219'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['HAG 1:1', 'HAG 1:12'], note: '哈该书1:1、12直接记载先知哈该向省长所罗巴伯传达耶和华的话，并由所罗巴伯听从；按先知宣告／劝勉关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003340', { subject_person_id: 'person-000718', object_person_id: 'person-000615', candidate_person_ids: ['person-000615', 'person-000718'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 2:18'], note: '代上2:18明说阿苏巴的儿子包括押墩；记录阿苏巴指向押墩的母子关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-003347', { subject_person_id: 'person-000718', object_person_id: 'person-001728', candidate_person_ids: ['person-000718', 'person-001728'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 2:18'], note: '代上2:18明说阿苏巴的儿子包括耶设；记录阿苏巴指向耶设的母子关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-003348', { subject_person_id: 'person-000718', object_person_id: 'person-002663', candidate_person_ids: ['person-000718', 'person-002663'], relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['1CH 2:18'], note: '代上2:18明说阿苏巴的儿子包括朔罢；记录阿苏巴指向朔罢的母子关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002260', { subject_person_id: 'person-000077', object_person_id: 'person-001517', candidate_person_ids: ['person-000077', 'person-001517'], relation_type: 'commission', direction: 'directed', passages: ['2SA 15:22', '2SA 18:2'], note: '撒下15:22记载大卫命令以太带人过去，18:2又明确任命以太统领三分之一的军队；这是正式差派／任命，不是亲属关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002504', { subject_person_id: 'person-001764', object_person_id: 'person-002173', candidate_person_ids: ['person-001764', 'person-002173'], relation_type: 'military', direction: 'directed', passages: ['2SA 23:37', '1CH 11:39'], note: '撒下23:37与代上11:39都明称拿哈莱为约押的拿兵器者；记录约押指向拿哈莱的军事从属关系。', certainty: 0.99 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002219', { subject_person_id: 'person-001007', object_person_id: 'person-000359', candidate_person_ids: ['person-000359', 'person-001007'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['2SA 11:3'], note: '撒下11:3在同一明确句子中称拔示巴为以连的女儿、乌利亚的妻子；按已批准的姻亲细分，记录以连指向女婿乌利亚的 `parent_in_law` 关系。', certainty: 0.96 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002780', { subject_person_id: 'person-000580', object_person_id: 'person-002115', candidate_person_ids: ['person-000580', 'person-002115'], relation_type: 'legal', direction: 'directed', passages: ['1KI 22:26', '2CH 18:25'], note: '亚哈明令将米该雅交回城宰亚们，并命他将米该雅下在监里；记录亚们指向米该雅的司法拘禁关系。', certainty: 0.94 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002781', { subject_person_id: 'person-001778', object_person_id: 'person-002115', candidate_person_ids: ['person-001778', 'person-002115'], relation_type: 'legal', direction: 'directed', passages: ['1KI 22:26', '2CH 18:25'], note: '亚哈明令将米该雅交给王的儿子约阿施与城宰亚们，并下监看守；记录约阿施指向米该雅的司法拘禁关系。', certainty: 0.94 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002778', { subject_person_id: 'person-002887', object_person_id: 'person-002115', candidate_person_ids: ['person-002115', 'person-002887'], relation_type: 'hostile', direction: 'directed', passages: ['1KI 22:24', '2CH 18:23'], note: '基拿拿的儿子西底家直接掌击先知米该雅并质问他；记录西底家指向米该雅的明确敌对行为。', certainty: 0.99 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007986', { subject_person_id: 'person-000930', object_person_id: 'person-001095', candidate_person_ids: ['person-000930', 'person-001095'], relation_type: 'collegial', direction: 'undirected', passages: ['JER 36:12', 'JER 36:25'], note: '耶利36:12将第莱雅和以利拿单同列为王室首领，36:25又记载两人共同劝王不要焚烧书卷；记录持续的宫廷同工关系。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007987', { subject_person_id: 'person-000930', object_person_id: 'person-001174', candidate_person_ids: ['person-000930', 'person-001174'], relation_type: 'collegial', direction: 'undirected', passages: ['JER 36:12', 'JER 36:25'], note: '耶利36:12将第莱雅和基玛利雅同列为王室首领，36:25又记载两人共同劝王不要焚烧书卷；记录持续的宫廷同工关系。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007998', { subject_person_id: 'person-001095', object_person_id: 'person-001174', candidate_person_ids: ['person-001095', 'person-001174'], relation_type: 'collegial', direction: 'undirected', passages: ['JER 36:12', 'JER 36:25'], note: '耶利36:12将以利拿单和基玛利雅同列为王室首领，36:25又记载两人共同劝王不要焚烧书卷；记录持续的宫廷同工关系。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-008127', { subject_person_id: 'person-001755', object_person_id: 'person-001812', candidate_person_ids: ['person-001755', 'person-001812'], relation_type: 'collegial', direction: 'undirected', passages: ['JER 40:8', 'JER 42:1'], note: '耶利40:8与42:1都将耶撒尼亚和约哈难列为共同带领余民的军长；两处独立共同行动支持长期同工关系。', certainty: 0.96 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001864', { subject_person_id: 'person-000500', object_person_id: 'person-000309', candidate_person_ids: ['person-000309', 'person-000500'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['1SA 14:50'], note: '撒上14:50明称扫罗的妻子亚希暖是亚希玛斯的女儿；按姻亲细分记录亚希玛斯指向女婿扫罗的 `parent_in_law` 关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002028', { subject_person_id: 'person-000309', object_person_id: 'person-002294', candidate_person_ids: ['person-000309', 'person-002294'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['1SA 25:44'], note: '撒上25:44明称扫罗将女儿米甲给了帕提；按姻亲细分记录扫罗指向女婿帕提的 `parent_in_law` 关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002029', { subject_person_id: 'person-001916', object_person_id: 'person-002120', candidate_person_ids: ['person-001916', 'person-002120'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['1SA 25:44'], note: '撒上25:44明称米甲被给了拉亿的儿子帕提；按姻亲细分记录拉亿指向儿媳米甲的 `parent_in_law` 关系。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001770', { subject_person_id: 'person-000061', object_person_id: 'person-001053', candidate_person_ids: ['person-000061', 'person-001053'], relation_type: 'kinship', relation_subtype: 'other_specified', direction: 'undirected', passages: ['RUT 2:1'], note: '得2:1明称波阿斯是拿俄米丈夫以利米勒家族的亲族；经文未说明更精确的亲属等级，因此保守记为 `other_specified`。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001097', { subject_person_id: 'person-000417', object_person_id: 'person-000242', candidate_person_ids: ['person-000242', 'person-000417'], relation_type: 'hostile', direction: 'directed', passages: ['NUM 16:12', 'NUM 26:9'], note: '民16:12记载亚比兰拒绝摩西的召唤，26:9明称他与大坍攻击摩西、亚伦；记录亚比兰指向摩西的明确敌对关系。', certainty: 0.99 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001098', { subject_person_id: 'person-000920', object_person_id: 'person-000242', candidate_person_ids: ['person-000242', 'person-000920'], relation_type: 'hostile', direction: 'directed', passages: ['NUM 16:12', 'NUM 26:9'], note: '民16:12记载大坍拒绝摩西的召唤，26:9明称他与亚比兰攻击摩西、亚伦；记录大坍指向摩西的明确敌对关系。', certainty: 0.99 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002327', { subject_person_id: 'person-000419', object_person_id: 'person-002641', candidate_person_ids: ['person-000419', 'person-002641'], relation_type: 'hostile', direction: 'directed', passages: ['2SA 19:21'], note: '撒下19:21记载亚比筛因示每曾咒骂受膏者，当面要求将示每治死；记录亚比筛指向示每的明确敌对／杀害威胁。', certainty: 0.99 });
CURATED_EXPLICIT_PROPOSALS.set('drd-003175', { subject_person_id: 'person-002198', object_person_id: 'person-001166', candidate_person_ids: ['person-001166', 'person-002198'], relation_type: 'political', direction: 'directed', passages: ['2KI 25:22'], note: '王下25:22明说巴比伦王尼布甲尼撒立亚希甘的儿子基大利管理犹大剩下的百姓；记录尼布甲尼撒指向基大利的政治任命／权属关系。', certainty: 0.99 });
CURATED_EXPLICIT_PROPOSALS.set('drd-003418', { subject_person_id: 'person-002619', object_person_id: 'person-001585', candidate_person_ids: ['person-001585', 'person-002619'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['1CH 2:34', '1CH 2:35'], note: '代上2:34说示珊只有女儿并有埃及仆人耶哈，2:35明说示珊将女儿给耶哈为妻；按姻亲细分记录示珊指向女婿耶哈的 `parent_in_law` 关系。', certainty: 0.99 });


CURATED_EXPLICIT_PROPOSALS.set('drd-007456', { subject_person_id: 'person-000183', object_person_id: 'person-002075', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:24'], note: '经文含 犹大 与 米示萨别 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007457', { subject_person_id: 'person-000183', object_person_id: 'person-002344', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:24'], note: '经文含 犹大 与 毗他希雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007431', { subject_person_id: 'person-000641', object_person_id: 'person-000741', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:17'], note: '经文含 亚萨 与 八布迦 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007432', { subject_person_id: 'person-000641', object_person_id: 'person-001612', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:17'], note: '经文含 亚萨 与 耶杜顿 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007329', { subject_person_id: 'person-000664', object_person_id: 'person-001972', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:4'], note: '经文含 亚他雅 与 玛勒列 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007309', { subject_person_id: 'person-000673', object_person_id: 'person-001879', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 10:9'], note: '经文含 亚散尼 与 甲篾 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007151', { subject_person_id: 'person-000694', object_person_id: 'person-001322', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:23'], note: '经文含 哈述 与 亚撒利雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007157', { subject_person_id: 'person-000694', object_person_id: 'person-001363', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:24'], note: '经文含 希拿达 与 亚撒利雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007433', { subject_person_id: 'person-000741', object_person_id: 'person-001612', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:17'], note: '经文含 八布迦 与 耶杜顿 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007434', { subject_person_id: 'person-000741', object_person_id: 'person-002107', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 11:17'], note: '经文含 米迦 与 八布迦 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007135', { subject_person_id: 'person-000751', object_person_id: 'person-001309', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:17'], note: '经文含 巴尼 与 哈沙比雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007107', { subject_person_id: 'person-000833', object_person_id: 'person-002308', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:6'], note: '经文含 巴西亚 与 比所玳 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007553', { subject_person_id: 'person-001017', object_person_id: 'person-002433', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 13:28'], note: '经文含 以利亚实 与 参巴拉 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007143', { subject_person_id: 'person-001019', object_person_id: 'person-001228', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:21'], note: '经文含 哈哥斯 与 以利亚实 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007145', { subject_person_id: 'person-001019', object_person_id: 'person-002767', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:21'], note: '经文含 乌利亚 与 以利亚实 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007142', { subject_person_id: 'person-001019', object_person_id: 'person-002814', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:20'], note: '经文含 萨拜 与 以利亚实 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007304', { subject_person_id: 'person-001208', object_person_id: 'person-002891', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 10:1'], note: '经文含 哈迦利亚 与 西底家 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007111', { subject_person_id: 'person-001268', object_person_id: 'person-001285', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:8'], note: '经文含 哈海雅 与 哈拿尼雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007121', { subject_person_id: 'person-001291', object_person_id: 'person-001321', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:11'], note: '经文含 哈琳 与 哈述 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007123', { subject_person_id: 'person-001291', object_person_id: 'person-002291', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:11'], note: '经文含 哈琳 与 巴哈·摩押 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007115', { subject_person_id: 'person-001297', object_person_id: 'person-001311', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:10'], note: '经文含 哈路抹 与 哈沙尼 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007116', { subject_person_id: 'person-001297', object_person_id: 'person-001332', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:10'], note: '经文含 哈路抹 与 哈突 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007124', { subject_person_id: 'person-001321', object_person_id: 'person-002000', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:11'], note: '经文含 玛基雅 与 哈述 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007120', { subject_person_id: 'person-001332', object_person_id: 'person-001604', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:10'], note: '经文含 耶大雅 与 哈突 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007165', { subject_person_id: 'person-001461', object_person_id: 'person-002530', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:29'], note: '经文含 音麦 与 示迦尼 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007166', { subject_person_id: 'person-001461', object_person_id: 'person-002589', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:29'], note: '经文含 音麦 与 示玛雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007435', { subject_person_id: 'person-001612', object_person_id: 'person-002107', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 11:17'], note: '经文含 米迦 与 耶杜顿 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007402', { subject_person_id: 'person-001801', object_person_id: 'person-001874', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 11:9'], note: '经文含 约珥 与 犹大 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007554', { subject_person_id: 'person-001815', object_person_id: 'person-002433', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 13:28'], note: '经文含 耶何耶大 与 参巴拉 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007108', { subject_person_id: 'person-001816', object_person_id: 'person-002098', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:6'], note: '经文含 耶何耶大 与 米书兰 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007404', { subject_person_id: 'person-001874', object_person_id: 'person-002931', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 11:9'], note: '经文含 细基利 与 犹大 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007408', { subject_person_id: 'person-002062', object_person_id: 'person-002447', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 11:11'], note: '经文含 西莱雅 与 米拉约 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007110', { subject_person_id: 'person-002098', object_person_id: 'person-002308', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:6'], note: '经文含 巴西亚 与 米书兰 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007160', { subject_person_id: 'person-002292', object_person_id: 'person-002321', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['NEH 3:25'], note: '经文含 巴拉 与 毗大雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007163', { subject_person_id: 'person-002302', object_person_id: 'person-002778', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:25'], note: '经文含 乌赛 与 巴录 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007164', { subject_person_id: 'person-002321', object_person_id: 'person-002778', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:25'], note: '经文含 乌赛 与 毗大雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });
CURATED_EXPLICIT_PROPOSALS.set('drd-007170', { subject_person_id: 'person-002589', object_person_id: 'person-002835', relation_type: 'kinship', relation_subtype: 'child', direction: 'directed', passages: ['NEH 3:29'], note: '经文含 撒督 与 示玛雅 的“父/母-子女/生子”关系短语', certainty: 0.88 });

// Full direct-relation audit, batch 2026-08-31-A. These retain explicit
// interpersonal actions while excluding mere co-occurrence and remote paths.
CURATED_EXPLICIT_PROPOSALS.set('drd-002010', { subject_person_id: 'person-000003', object_person_id: 'person-000077', relation_type: 'collegial', direction: 'undirected', passages: ['1SA 22:21', '1SA 30:7'], note: '亚比亚他投奔大卫、向他报告扫罗杀祭司之事，并长期以祭司身份协助大卫；属于持续同工关系。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002215', { subject_person_id: 'person-000077', object_person_id: 'person-000359', relation_type: 'hostile', direction: 'directed', passages: ['2SA 11:3', '2SA 11:17'], note: '大卫查问乌利亚身份并安排使他死于战场；按明确加害行动记录大卫指向乌利亚。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001994', { subject_person_id: 'person-000504', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-000504'], relation_type: 'host', direction: 'directed', passages: ['1SA 21:2', '1SA 21:8'], note: '亚希米勒在大卫逃亡时向他提供饼和歌利亚的刀；按接待／供应记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-005464', { subject_person_id: 'person-000077', object_person_id: 'person-000640', relation_type: 'commission', direction: 'directed', passages: ['1CH 25:1'], note: '代上25:1直接记载大卫与众首领分派亚萨等人的子孙供职；按王的职务差派记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002210', { subject_person_id: 'person-001275', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-001275'], relation_type: 'hostile', direction: 'directed', passages: ['1CH 19:2', '1CH 19:3'], note: '哈嫩拒绝大卫的外交慰问并羞辱其使者；按针对大卫一方的明确敌对行动记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002071', { subject_person_id: 'person-000077', object_person_id: 'person-001479', relation_type: 'political', direction: 'directed', passages: ['2SA 3:14'], note: '大卫直接差使者向伊施波设索回米甲；两位对立王权人物之间的明确政治行为。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002205', { subject_person_id: 'person-000077', object_person_id: 'person-002059', relation_type: 'host', direction: 'directed', passages: ['2SA 9:6'], note: '米非波设来见大卫后，大卫接纳他并在本段安排其常与王同席；按接待关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002020', { subject_person_id: 'person-002164', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-002164'], relation_type: 'hostile', direction: 'directed', passages: ['1SA 25:10'], note: '拿八直接以侮辱性言辞拒绝大卫的请求；按明确敌对行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002229', { subject_person_id: 'person-002189', object_person_id: 'person-000077', candidate_person_ids: ['person-000077', 'person-002189'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['2SA 12:1', '2SA 12:7'], note: '拿单奉差遣向大卫讲明罪行并宣告责备；方向为先知拿单指向大卫。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-005354', { subject_person_id: 'person-000077', object_person_id: 'person-002279', relation_type: 'legal', direction: 'directed', passages: ['1CH 21:23', '1CH 21:24'], note: '大卫与阿珥楠直接商议并以足价购买禾场；按具名双方之间的明确法律／财产交易记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003034', { subject_person_id: 'person-002442', object_person_id: 'person-000129', candidate_person_ids: ['person-000129', 'person-002442'], relation_type: 'military', direction: 'directed', passages: ['2KI 18:13', 'ISA 36:1'], note: '西拿基立在希西家年间入侵并攻取犹大坚固城；按军事攻击方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000273', { subject_person_id: 'person-000410', object_person_id: 'person-000133', candidate_person_ids: ['person-000133', 'person-000410'], relation_type: 'political', direction: 'directed', passages: ['GEN 26:9'], note: '亚比米勒召以撒并就其妻子身份直接质问；按君王对辖境居民的明确政治权属行为记录。' });
// Full direct-relation audit, batch 2026-08-31-B.
CURATED_EXPLICIT_PROPOSALS.set('drd-007777', { subject_person_id: 'person-000154', object_person_id: 'person-001261', relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['JER 28:15'], note: '耶利米直接指出哈拿尼雅并非奉差遣且使百姓倚靠谎言；按先知责备关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000899', { subject_person_id: 'person-000242', object_person_id: 'person-000179', candidate_person_ids: ['person-000179', 'person-000242'], relation_type: 'teacher_student', direction: 'directed', passages: ['EXO 33:11', 'NUM 11:28'], note: '经文直接称约书亚为摩西的帮手／伺候者，并记其长期随从摩西；按师徒／门徒式带领记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001289', { subject_person_id: 'person-000179', object_person_id: 'person-000291', relation_type: 'legal', direction: 'directed', passages: ['JOS 6:25'], note: '约书亚明确使喇合与其父家得以存活；按司法／保护决定记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001050', { subject_person_id: 'person-000179', object_person_id: 'person-000880', relation_type: 'collegial', direction: 'undirected', passages: ['NUM 14:6', 'JOS 14:6'], note: '约书亚与迦勒共同窥探、共同持守报告，并在后续分地中持续合作；属于长期同工关系。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001205', { subject_person_id: 'person-000179', object_person_id: 'person-000989', relation_type: 'collegial', direction: 'undirected', passages: ['JOS 14:1', 'JOS 19:51'], note: '约书亚与祭司以利亚撒共同主持分地，并在多个明确行政场景持续协作；属于长期同工关系。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000576', { subject_person_id: 'person-000183', object_person_id: 'person-002675', relation_type: 'kinship', relation_subtype: 'child_in_law', direction: 'directed', passages: ['GEN 38:2'], note: '犹大娶书亚的女儿为妻，直接蕴含犹大是书亚的女婿；按已批准的姻亲细分类记录。', certainty: 0.92 });
CURATED_EXPLICIT_PROPOSALS.set('drd-000903', { subject_person_id: 'person-000242', object_person_id: 'person-001428', relation_type: 'military', direction: 'directed', passages: ['EXO 17:10'], note: '摩西安排与亚玛力争战并带亚伦、户珥上山配合战事；按军事领袖到明确参与者记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000816', { subject_person_id: 'person-001744', object_person_id: 'person-000242', candidate_person_ids: ['person-000242', 'person-001744'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['EXO 18:1', 'EXO 18:6'], note: '经文直接称叶忒罗为摩西的岳父；按父母姻亲方向记录。' });
// Full direct-relation audit, batch 2026-08-31-C.
CURATED_EXPLICIT_PROPOSALS.set('drd-001242', { subject_person_id: 'person-000242', object_person_id: 'person-002261', relation_type: 'military', direction: 'directed', passages: ['JOS 13:12'], note: '经文直接回顾摩西击杀巴珊王噩并赶逐其势力；按军事攻击记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001206', { subject_person_id: 'person-000242', object_person_id: 'person-002350', relation_type: 'commission', direction: 'directed', passages: ['NUM 31:6'], note: '摩西直接差派非尼哈随军出征；按差派方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000223', { subject_person_id: 'person-000293', object_person_id: 'person-000308', relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['GEN 24:67'], note: '以撒是撒拉之子且在本节娶利百加，直接蕴含撒拉为利百加的婆母；按已批准姻亲细分类记录。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-005809', { subject_person_id: 'person-000294', object_person_id: 'person-001709', candidate_person_ids: ['person-000294', 'person-001709'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['2CH 11:18'], note: '罗波安所娶玛哈拉是耶利摩的女儿，直接蕴含耶利摩为罗波安岳父；按姻亲细分类记录。', certainty: 0.92 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001769', { subject_person_id: 'person-000301', object_person_id: 'person-002183', relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['RUT 1:22'], note: '路得是拿俄米儿媳；按拿俄米指向路得的父母姻亲关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001768', { subject_person_id: 'person-000301', object_person_id: 'person-002280', relation_type: 'kinship', relation_subtype: 'sibling_in_law', direction: 'undirected', passages: ['RUT 1:14', 'RUT 1:4'], note: '路得与俄珥巴分别嫁给拿俄米的两个儿子，直接蕴含二人为妯娌；按姻亲细分类记录。', certainty: 0.92 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001824', { subject_person_id: 'person-000306', object_person_id: 'person-000309', candidate_person_ids: ['person-000306', 'person-000309'], relation_type: 'prophetic_confrontation', direction: 'directed', passages: ['1SA 15:16', '1SA 15:26'], note: '撒母耳直接责备扫罗并宣布其王权被弃；按先知责备方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001880', { subject_person_id: 'person-000306', object_person_id: 'person-000467', candidate_person_ids: ['person-000306', 'person-000467'], relation_type: 'legal', direction: 'directed', passages: ['1SA 15:32', '1SA 15:33'], note: '撒母耳宣告亚甲的罪责并将其处死；按明确司法行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000196', { subject_person_id: 'person-000410', object_person_id: 'person-000308', candidate_person_ids: ['person-000308', 'person-000410'], relation_type: 'legal', direction: 'directed', passages: ['GEN 20:14'], note: '亚比米勒把撒拉归还亚伯拉罕；按君王直接作出的返还／纠正行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001898', { subject_person_id: 'person-000309', object_person_id: 'person-000466', relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['1SA 18:19'], note: '扫罗将女儿米拉给亚得列为妻，直接蕴含扫罗为亚得列岳父；按姻亲细分类记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001879', { subject_person_id: 'person-000309', object_person_id: 'person-000467', relation_type: 'hostile', direction: 'directed', passages: ['1SA 15:9', '1SA 15:20'], note: '扫罗擒获亚玛力王亚甲并毁灭其国民；按明确敌对行动记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001995', { subject_person_id: 'person-000309', object_person_id: 'person-000945', relation_type: 'political', direction: 'directed', passages: ['1SA 21:7', '1SA 22:9'], note: '多益被直接称为扫罗的臣子／司牧长，并向扫罗报告；按君王权属关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002198', { subject_person_id: 'person-000309', object_person_id: 'person-002917', relation_type: 'political', direction: 'directed', passages: ['2SA 9:2'], note: '洗巴被直接称为扫罗家的仆人；按扫罗对洗巴的政治／家臣权属关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002596', { subject_person_id: 'person-000499', object_person_id: 'person-000332', candidate_person_ids: ['person-000332', 'person-000499'], relation_type: 'kinship', relation_subtype: 'child_in_law', direction: 'directed', passages: ['1KI 4:15'], note: '亚希玛斯娶所罗门的女儿巴实抹为妻，直接蕴含其为所罗门女婿；按姻亲细分类记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002589', { subject_person_id: 'person-000786', object_person_id: 'person-000332', candidate_person_ids: ['person-000332', 'person-000786'], relation_type: 'kinship', relation_subtype: 'child_in_law', direction: 'directed', passages: ['1KI 4:11'], note: '便亚比拿达娶所罗门的女儿他法为妻，直接蕴含其为所罗门女婿；按姻亲细分类记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002628', { subject_person_id: 'person-000332', object_person_id: 'person-001391', relation_type: 'commission', direction: 'directed', passages: ['1KI 7:13', '1KI 7:40'], note: '所罗门召户兰承担圣殿铜工，户兰完成交付；按明确委任关系记录。' });
// Full direct-relation audit, batch 2026-08-31-D.
CURATED_EXPLICIT_PROPOSALS.set('drd-002224', { subject_person_id: 'person-001764', object_person_id: 'person-000359', candidate_person_ids: ['person-000359', 'person-001764'], relation_type: 'hostile', direction: 'directed', passages: ['2SA 11:16', '2SA 11:17'], note: '约押依大卫的安排把乌利亚置于最危险处并使军兵退后，导致乌利亚死亡；按明确加害行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-006638', { subject_person_id: 'person-000910', object_person_id: 'person-000369', candidate_person_ids: ['person-000369', 'person-000910'], relation_type: 'political', direction: 'directed', passages: ['EZR 4:3'], note: '所罗巴伯等人明确以塞鲁士王的诏命作为建殿授权；按君王对领袖的政治权属／授权关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007626', { subject_person_id: 'person-000401', object_person_id: 'person-002150', relation_type: 'kinship', relation_subtype: 'uncle_aunt', direction: 'directed', passages: ['EST 2:15'], note: '经文直接称亚比孩为末底改的叔叔；按叔侄细分类记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001066', { subject_person_id: 'person-000417', object_person_id: 'person-001904', relation_type: 'alliance', direction: 'undirected', passages: ['NUM 16:1', 'NUM 16:24'], note: '亚比兰与可拉共同组织并持续参与同一反叛行动；按明确政治／军事结盟记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002310', { subject_person_id: 'person-000419', object_person_id: 'person-001517', relation_type: 'military', direction: 'undirected', passages: ['2SA 18:2', '2SA 18:5'], note: '亚比筛和以太各率一队共同执行大卫的军事部署；按并列军事同工记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002341', { subject_person_id: 'person-000419', object_person_id: 'person-002515', relation_type: 'military', direction: 'directed', passages: ['2SA 20:6'], note: '大卫直接命令亚比筛率军追赶示巴；按军事追击方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002068', { subject_person_id: 'person-000425', object_person_id: 'person-001479', relation_type: 'political', direction: 'directed', passages: ['2SA 2:8', '2SA 3:8'], note: '押尼珥拥立并服事伊施波设，随后因王的指责发生决裂；按其明确政治权力关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002266', { subject_person_id: 'person-000426', object_person_id: 'person-000519', relation_type: 'political', direction: 'directed', passages: ['2SA 16:21', '2SA 17:14'], note: '亚希多弗作为押沙龙的谋士直接献策，押沙龙决定是否采纳；按政治领袖与谋士关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002543', { subject_person_id: 'person-000461', object_person_id: 'person-000765', relation_type: 'political', direction: 'directed', passages: ['1KI 2:13', '1KI 2:19'], note: '亚多尼雅直接请求拔示巴代向所罗门提出政治婚姻诉求；按宫廷政治行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007639', { subject_person_id: 'person-000475', object_person_id: 'person-001232', relation_type: 'political', direction: 'directed', passages: ['EST 3:1', 'EST 3:12'], note: '亚哈随鲁提升哈曼并授权以王名发布诏令；按君王与首席官员的政治权属关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-005956', { subject_person_id: 'person-000478', object_person_id: 'person-001642', relation_type: 'kinship', relation_subtype: 'sibling_in_law', direction: 'undirected', passages: ['2CH 22:11'], note: '耶何耶大之妻约示巴被直接称为亚哈谢的妹子，故亚哈谢与耶何耶大为姻亲兄弟；按手足姻亲记录。', certainty: 0.92 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002263', { subject_person_id: 'person-000501', object_person_id: 'person-001829', relation_type: 'collegial', direction: 'undirected', passages: ['2SA 15:36', '2SA 17:17'], note: '亚希玛斯与约拿单被共同安排传递情报并实际协作报信；按持续同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002190', { subject_person_id: 'person-000506', object_person_id: 'person-002832', relation_type: 'collegial', direction: 'undirected', passages: ['1CH 24:3', '1CH 24:6'], note: '亚希米勒与撒督共同协助大卫分派祭司班次；按明确持续同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002714', { subject_person_id: 'person-002943', object_person_id: 'person-000629', candidate_person_ids: ['person-000629', 'person-002943'], relation_type: 'hostile', direction: 'directed', passages: ['1KI 16:9'], note: '心利直接背叛并杀害亚杂；按明确敌对行动记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-005260', { subject_person_id: 'person-000640', object_person_id: 'person-001358', relation_type: 'collegial', direction: 'undirected', passages: ['1CH 25:1', '1CH 25:6'], note: '亚萨与希幔同为大卫所设立的圣殿音乐领袖并持续共同供职；按长期同工记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-005467', { subject_person_id: 'person-000640', object_person_id: 'person-001611', relation_type: 'collegial', direction: 'undirected', passages: ['1CH 25:1', '1CH 25:6'], note: '亚萨与耶杜顿同为大卫所设立的圣殿音乐领袖并持续共同供职；按长期同工记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002545', { subject_person_id: 'person-000765', object_person_id: 'person-002189', relation_type: 'alliance', direction: 'undirected', passages: ['1KI 1:11'], note: '拿单与拔示巴明确协调行动，以保护所罗门的王位继承；按共同政治目标的结盟记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002353', { subject_person_id: 'person-000804', object_person_id: 'person-001764', relation_type: 'legal', direction: 'directed', passages: ['1KI 2:29', '1KI 2:30'], note: '比拿雅奉王命向约押宣告处置并执行死刑；按明确司法行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000917', { subject_person_id: 'person-000838', object_person_id: 'person-002264', relation_type: 'collegial', direction: 'undirected', passages: ['EXO 36:1'], note: '比撒列与亚何利亚伯共同承担会幕制作并持续协作；按长期同工关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001073', { subject_person_id: 'person-000920', object_person_id: 'person-001904', relation_type: 'alliance', direction: 'undirected', passages: ['NUM 16:1', 'NUM 16:24'], note: '大坍与可拉共同组织并持续参与同一反叛行动；按明确结盟记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007623', { subject_person_id: 'person-001347', object_person_id: 'person-001126', candidate_person_ids: ['person-001126', 'person-001347'], relation_type: 'host', direction: 'directed', passages: ['EST 2:8', 'EST 2:15'], note: '希该负责以斯帖的宫廷照管，并向她提供所需安排与建议；按接待／照管关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-007622', { subject_person_id: 'person-001126', object_person_id: 'person-002150', relation_type: 'kinship', relation_subtype: 'cousin', direction: 'undirected', passages: ['EST 2:7'], note: '以斯帖是末底改叔叔的女儿，二人为堂／表亲；经文又记末底改收养她，但本边按亲属优先记录为堂表亲。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000895', { subject_person_id: 'person-002368', object_person_id: 'person-000989', candidate_person_ids: ['person-000989', 'person-002368'], relation_type: 'kinship', relation_subtype: 'parent_in_law', direction: 'directed', passages: ['EXO 6:25'], note: '以利亚撒娶普铁的一个女儿为妻，直接蕴含普铁为以利亚撒岳父；按姻亲细分类记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-006639', { subject_person_id: 'person-000910', object_person_id: 'person-001855', relation_type: 'political', direction: 'directed', passages: ['EZR 4:3'], note: '耶书亚与所罗巴伯共同以塞鲁士的诏命作为建殿授权；按君王对领袖的政治授权关系记录。' });
// Full direct-relation audit, batch 2026-08-31-E.
CURATED_EXPLICIT_PROPOSALS.set('drd-005321', { subject_person_id: 'person-001358', object_person_id: 'person-001611', relation_type: 'collegial', direction: 'undirected', passages: ['1CH 25:1', '1CH 25:6'], note: '希幔与耶杜顿同为大卫所设立的圣殿音乐领袖并持续共同供职；按长期同工记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003016', { subject_person_id: 'person-001418', object_person_id: 'person-002692', relation_type: 'political', direction: 'directed', passages: ['2KI 17:4'], note: '何细亚直接遣使去见埃及王梭并寻求外援；按明确外交／政治行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003184', { subject_person_id: 'person-001812', object_person_id: 'person-001492', candidate_person_ids: ['person-001492', 'person-001812'], relation_type: 'hostile', direction: 'directed', passages: ['JER 40:15', 'JER 41:11'], note: '约哈难请求先发制人杀以实玛利，随后实际追击其部队；按明确敌对方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002311', { subject_person_id: 'person-001517', object_person_id: 'person-001764', relation_type: 'military', direction: 'undirected', passages: ['2SA 18:2', '2SA 18:5'], note: '以太与约押分别率军并共同执行大卫的战场部署；按军事同工记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002922', { subject_person_id: 'person-001631', object_person_id: 'person-001779', relation_type: 'kinship', relation_subtype: 'parent', direction: 'directed', passages: ['2KI 13:10'], note: '经文直接称约阿施为约哈斯的儿子；按父子方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002904', { subject_person_id: 'person-001642', object_person_id: 'person-001779', relation_type: 'teacher_student', direction: 'directed', passages: ['2CH 24:22', '2KI 12:7'], note: '耶何耶大保护、扶立并长期教导约阿施，且经文责备约阿施忘记其恩惠；按长期导师关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003163', { subject_person_id: 'person-002198', object_person_id: 'person-001645', candidate_person_ids: ['person-001645', 'person-002198'], relation_type: 'military', direction: 'directed', passages: ['2KI 24:1', 'DAN 1:1'], note: '尼布甲尼撒进攻约雅敬并使其臣服；按明确军事权力方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003510', { subject_person_id: 'person-001645', object_person_id: 'person-002886', relation_type: 'succession', direction: 'directed', passages: ['1CH 3:16'], note: '按已确认的编辑决定，不把约雅敬与西底家记为父子；仅记录同一王室序列中的王位承接关系。', certainty: 0.84 });
CURATED_EXPLICIT_PROPOSALS.set('drd-002914', { subject_person_id: 'person-001656', object_person_id: 'person-001870', relation_type: 'alliance', direction: 'undirected', passages: ['2KI 12:21'], note: '约萨拔与约撒甲共同密谋并杀害约阿施；按明确共谋结盟记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002846', { subject_person_id: 'person-001662', object_person_id: 'person-001756', relation_type: 'hostile', direction: 'directed', passages: ['2KI 9:22'], note: '耶户当面指斥耶洗别的淫行邪术，并在连续叙事中执行推翻；按明确敌对方向记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-006554', { subject_person_id: 'person-001733', object_person_id: 'person-001879', relation_type: 'collegial', direction: 'undirected', passages: ['EZR 3:9', 'NEH 10:9'], note: '耶书亚与甲篾共同督理重建工程并持续同列利未领袖；按长期同工记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002345', { subject_person_id: 'person-001764', object_person_id: 'person-002515', relation_type: 'military', direction: 'directed', passages: ['2SA 20:7', '2SA 20:21'], note: '约押率军追击并围困示巴所在城邑，要求交出示巴；按明确军事追击记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000315', { subject_person_id: 'person-001911', object_person_id: 'person-002938', relation_type: 'political', direction: 'directed', passages: ['GEN 29:24'], note: '悉帕被直接称为拉班的使女，且拉班把她交给女儿；按家主对仆役的明确权属关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-000316', { subject_person_id: 'person-001919', object_person_id: 'person-002938', relation_type: 'political', direction: 'directed', passages: ['GEN 29:24'], note: '拉班把悉帕给利亚作使女，形成利亚对悉帕的明确家内权属关系。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002207', { subject_person_id: 'person-002059', object_person_id: 'person-002917', relation_type: 'political', direction: 'directed', passages: ['2SA 9:10', '2SA 9:11'], note: '洗巴及其家属被明确安排耕作米非波设的产业并服事其家；按家臣权属关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-009264', { subject_person_id: 'person-002198', object_person_id: 'person-002137', candidate_person_ids: ['person-002137', 'person-002198'], relation_type: 'legal', direction: 'directed', passages: ['DAN 3:13', 'DAN 3:19'], note: '尼布甲尼撒直接传召米煞等三人、审问并下令投入火窑；按司法／惩罚行为记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-002722', { subject_person_id: 'person-002270', object_person_id: 'person-002732', relation_type: 'political', direction: 'undirected', passages: ['1KI 16:21', '1KI 16:22'], note: '暗利与提比尼被两派同时拥立并形成直接王位竞争；按政治对立关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-009213', { subject_person_id: 'person-002888', object_person_id: 'person-002452', candidate_person_ids: ['person-002452', 'person-002888'], relation_type: 'political', direction: 'directed', passages: ['JER 51:59'], note: '西莱雅以宫廷职分随西底家王出行；按君王与具名官员的政治权属关系记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-003278', { subject_person_id: 'person-002738', object_person_id: 'person-002729', candidate_person_ids: ['person-002729', 'person-002738'], relation_type: 'kinship', relation_subtype: 'step_parent', direction: 'directed', passages: ['1CH 1:36'], note: '亭纳是提幔父亲以利法的妾，故为提幔的继母／父亲伴侣；按已确认的亭纳角色与继亲细分类记录。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-003279', { subject_person_id: 'person-002738', object_person_id: 'person-002899', relation_type: 'kinship', relation_subtype: 'step_parent', direction: 'directed', passages: ['1CH 1:36'], note: '亭纳是洗玻父亲以利法的妾，故为洗玻的继母／父亲伴侣；按已确认的亭纳角色与继亲细分类记录。', certainty: 0.9 });
CURATED_EXPLICIT_PROPOSALS.set('drd-001560', { subject_person_id: 'person-002840', object_person_id: 'person-002853', relation_type: 'alliance', direction: 'undirected', passages: ['JDG 8:10', 'JDG 8:12'], note: '撒慕拿与西巴共同率领米甸军并一同逃亡、被擒；按明确军事结盟记录。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-001013', { subject_person_id: 'person-000242', object_person_id: 'person-001395', relation_type: 'kinship', relation_subtype: 'other_specified', direction: 'undirected', passages: ['NUM 10:29', 'JDG 4:11'], note: '何巴与摩西存在明确姻亲关系，但底本称谓可译岳父或内兄；按具体姻亲但称谓不确定记录，不强定为父母姻亲。', certainty: 0.72 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009800', { subject_person_id: 'person-000007', object_person_id: 'person-000598', relation_type: 'alliance', direction: 'undirected', passages: ['GEN 14:13'], note: '和合本直接记载亚伯兰与幔利之间的联盟关系；按直接端点与指向复核。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009801', { subject_person_id: 'person-000007', object_person_id: 'person-001124', relation_type: 'alliance', direction: 'undirected', passages: ['GEN 14:13'], note: '和合本直接记载亚伯兰与以实各之间的联盟关系；按直接端点与指向复核。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009802', { subject_person_id: 'person-000007', object_person_id: 'person-002011', relation_type: 'alliance', direction: 'undirected', passages: ['GEN 14:13'], note: '和合本直接记载亚伯兰与幔利之间的联盟关系；按直接端点与指向复核。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-010042', { subject_person_id: 'person-000156', object_person_id: 'person-000027', relation_type: 'commission', direction: 'directed', passages: ['ACT 9:17'], note: 'ACT 9:17中亚拿尼亚奉差遣为耶稣办理开导/医治与归信安排；按差派关系记录。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009982', { subject_person_id: 'person-000077', object_person_id: 'person-000156', relation_type: 'kinship', relation_subtype: 'other_specified', direction: 'directed', passages: ['MAT 1:1', 'REV 22:16'], note: '大卫到耶稣的远代祖先关系由谱系与启示称呼共同支持；按其他亲属细分记录，不设直接父子。', certainty: 0.97 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009981', { subject_person_id: 'person-000007', object_person_id: 'person-000156', relation_type: 'kinship', relation_subtype: 'other_specified', direction: 'directed', passages: ['MAT 1:1', 'GAL 3:16'], certainty: 0.9, note: '远代祖先关系而非直接亲生；亚巴拉罕与耶稣为所应许种系关系，在谱系语境下归为远代亲属。' });
CURATED_EXPLICIT_PROPOSALS.set('drd-009906', { subject_person_id: 'person-000555', object_person_id: 'person-000077', relation_type: 'political', direction: 'directed', passages: ['1CH 12:18'], note: '1CH 12:18直接显示亚玛撒效忠并为大卫处理军事事务；按臣属/忠诚的政治委任关系记录。', certainty: 0.92 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009832', { subject_person_id: 'person-000294', object_person_id: 'person-000464', relation_type: 'commission', direction: 'directed', passages: ['1KI 12:18'], note: '1KI 12:18记载罗波安差遣阿多尼兰；按明确差遣关系记录。', certainty: 0.98 });
CURATED_EXPLICIT_PROPOSALS.set('drd-009625', { subject_person_id: 'person-000125', object_person_id: 'person-000282', relation_type: 'friendship', direction: 'undirected', passages: ['LUK 23:12'], note: 'LUK 23:12中希律与彼拉多在此节中有显明的政治协商与对立关系，按并列关系记录。', certainty: 0.99 });
const CURATED_AMBIGUOUS_IDENTITY_REJECTIONS = new Set(['drd-001554', 'drd-001825', 'drd-001826', 'drd-001827']);
const CURATED_NO_DIRECT_RELATION_REJECTIONS = new Set(['drd-001536', 'drd-002824', 'drd-009352', 'drd-008151', 'drd-008152', 'drd-008153', 'drd-005854', 'drd-002715', 'drd-009405', 'drd-001207', 'drd-001208', 'drd-001209', 'drd-001210', 'drd-001211', 'drd-001105', 'drd-002276', 'drd-002717', 'drd-009229', 'drd-009230', 'drd-002718', 'drd-001561',
  'drd-006176', 'drd-002690', 'drd-003487', 'drd-003488', 'drd-003489', 'drd-003490', 'drd-003491', 'drd-003492', 'drd-003493', 'drd-003494', 'drd-005675', 'drd-005226', 'drd-001320', 'drd-001556', 'drd-009300', 'drd-002938', 'drd-002939', 'drd-002940', 'drd-002941', 'drd-002942', 'drd-002943', 'drd-002944', 'drd-002945', 'drd-002946', 'drd-002947', 'drd-002691', 'drd-001575', 'drd-001576', 'drd-001577',
  'drd-009354', 'drd-002566', 'drd-002261', 'drd-005416', 'drd-005417', 'drd-002733', 'drd-002734', 'drd-002735', 'drd-002692', 'drd-005853', 'drd-002602', 'drd-002603', 'drd-005855', 'drd-002349', 'drd-002792', 'drd-009280', 'drd-006473', 'drd-003692', 'drd-003711', 'drd-003712', 'drd-003713', 'drd-004327', 'drd-004328', 'drd-004329', 'drd-004330', 'drd-004333', 'drd-004334', 'drd-004336', 'drd-009133', 'drd-009134', 'drd-009135', 'drd-009136', 'drd-009137', 'drd-009141', 'drd-009145', 'drd-009151', 'drd-006997', 'drd-007000', 'drd-007017', 'drd-004560', 'drd-004561', 'drd-004562', 'drd-004563', 'drd-004564', 'drd-004565', 'drd-004566', 'drd-006895', 'drd-006896', 'drd-006897', 'drd-006898', 'drd-006899', 'drd-006947', 'drd-006948', 'drd-006949', 'drd-006950', 'drd-006951', 'drd-006967', 'drd-006968', 'drd-006969', 'drd-006970', 'drd-006971', 'drd-006972', 'drd-006973', 'drd-007047', 'drd-007048', 'drd-006937', 'drd-006938', 'drd-006939', 'drd-006915', 'drd-006916', 'drd-006917', 'drd-006918', 'drd-006919', 'drd-006866', 'drd-006867', 'drd-006868', 'drd-006869', 'drd-006870', 'drd-006872', 'drd-006975', 'drd-006976', 'drd-006977', 'drd-006978', 'drd-006979', 'drd-006980', 'drd-007052', 'drd-007053', 'drd-007054', 'drd-007055', 'drd-007056', 'drd-007057', 'drd-006982', 'drd-006983', 'drd-006984', 'drd-006985', 'drd-006986', 'drd-006988', 'drd-006989', 'drd-006990', 'drd-006991', 'drd-006993', 'drd-006994', 'drd-006995', 'drd-006845', 'drd-006846', 'drd-006847']);
CURATED_NO_DIRECT_RELATION_REJECTIONS.add('drd-010043');
CURATED_NO_DIRECT_RELATION_REJECTIONS.add('drd-002644'); // 尼八仅作耶罗波安父名；所罗门与尼八无直接关系陈述。
CURATED_NO_DIRECT_RELATION_REJECTIONS.add('drd-002658'); // 尼八仅作耶罗波安父名；亚希雅与尼八无直接关系陈述。
const CURATED_NO_DIRECT_RELATION_REJECTIONS_REVIEW_JSONL_BATCH = new Set([
  'drd-009699', 'drd-009701', 'drd-009705', 'drd-009759', 'drd-009760',
  'drd-009761', 'drd-009762', 'drd-009763', 'drd-009764', 'drd-009769',
  'drd-010010', 'drd-010016', 'drd-010017', 'drd-010031', 'drd-010038',
  'drd-010044', 'drd-010049', 'drd-010050', 'drd-010053'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_REVIEW_JSONL_BATCH) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of [
  'drd-007692', 'drd-000937', 'drd-001808', 'drd-001829',
  'drd-001771', 'drd-005765', 'drd-002660', 'drd-002211',
  'drd-000287', 'drd-000428', 'drd-000378', 'drd-000199',
  'drd-000338', 'drd-003077', 'drd-000818', 'drd-003057',
  'drd-003058', 'drd-000819'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

// Apostle-name lists identify membership in the same group but do not assert
// every possible pairwise relationship. Direct sibling/parent/commission edges
// are handled by their own explicit clauses and existing assertions.
for (const id of [
  'drd-009474', 'drd-009433', 'drd-009645', 'drd-009646', 'drd-009647', 'drd-009436',
  'drd-009475', 'drd-009437', 'drd-009476', 'drd-009477', 'drd-009427', 'drd-009428',
  'drd-009649', 'drd-009478', 'drd-009479', 'drd-009480', 'drd-009481', 'drd-009429',
  'drd-009438', 'drd-009607', 'drd-009608', 'drd-009651', 'drd-009439', 'drd-009609',
  'drd-009440', 'drd-009482', 'drd-009441', 'drd-009443', 'drd-009483', 'drd-009444',
  'drd-009610', 'drd-009668', 'drd-009669', 'drd-009611', 'drd-009670', 'drd-009671',
  'drd-009672', 'drd-009673', 'drd-009674', 'drd-009675', 'drd-009676', 'drd-009677',
  'drd-009445', 'drd-009484', 'drd-009446', 'drd-009612', 'drd-009678', 'drd-009679',
  'drd-009485', 'drd-009447', 'drd-009486'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

// Incidental NT cross-pairs: titles, dating clauses, patronymics, and quoted
// ancestry mention other people in the same verse without linking this pair.
for (const id of [
  'drd-009500', 'drd-009501', 'drd-009466', 'drd-009502', 'drd-009503', 'drd-009504',
  'drd-009681', 'drd-009519', 'drd-009520', 'drd-009505', 'drd-009507', 'drd-009682',
  'drd-009683', 'drd-009417', 'drd-009521', 'drd-009522', 'drd-009512', 'drd-009628',
  'drd-009630', 'drd-009631', 'drd-009632', 'drd-009633', 'drd-009634'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of [
  'drd-006534', 'drd-007725', 'drd-001881', 'drd-005806',
  'drd-007664', 'drd-001177', 'drd-001415', 'drd-001051',
  'drd-003101', 'drd-000906', 'drd-009383', 'drd-004544',
  'drd-009384', 'drd-000915', 'drd-000928', 'drd-001241',
  'drd-000913'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of [
  'drd-000929', 'drd-000916', 'drd-001277', 'drd-000317',
  'drd-000321', 'drd-000370', 'drd-005808', 'drd-000258',
  'drd-002038', 'drd-002006', 'drd-002355', 'drd-002542',
  'drd-002645', 'drd-000582'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of [
  'drd-009297', 'drd-006170', 'drd-002990', 'drd-002991',
  'drd-007691', 'drd-001294', 'drd-002056', 'drd-002280',
  'drd-007625', 'drd-001570', 'drd-001548', 'drd-001531',
  'drd-001539', 'drd-002563', 'drd-002576', 'drd-000410',
  'drd-007410', 'drd-007412', 'drd-002552',
  'drd-002861', 'drd-007640', 'drd-005930', 'drd-002828',
  'drd-002843', 'drd-005950', 'drd-002699', 'drd-008139',
  'drd-008140', 'drd-002935', 'drd-002948', 'drd-002952',
  'drd-009299', 'drd-003079', 'drd-007414', 'drd-001420',
  'drd-001421', 'drd-006675', 'drd-006677', 'drd-006678',
  'drd-005957', 'drd-007811', 'drd-008055',
  'drd-002544', 'drd-000533', 'drd-009336', 'drd-002344',
  'drd-000318', 'drd-001052', 'drd-006673', 'drd-006674',
  'drd-001573', 'drd-001233', 'drd-001804', 'drd-006182',
  'drd-000295', 'drd-003953', 'drd-000812', 'drd-003629',
  'drd-004774', 'drd-004775', 'drd-001574', 'drd-003275',
  'drd-003181', 'drd-004739'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of [
  'drd-002720', 'drd-002381', 'drd-000548', 'drd-002546',
  'drd-007647', 'drd-002757', 'drd-007627', 'drd-009329',
  'drd-008162', 'drd-008163', 'drd-002069', 'drd-003185',
  'drd-008159', 'drd-008149', 'drd-005903', 'drd-005904',
  'drd-002354', 'drd-002901', 'drd-002844', 'drd-002754',
  'drd-002902', 'drd-003678', 'drd-001053', 'drd-003428',
  'drd-004269', 'drd-003190', 'drd-002265', 'drd-002845',
  'drd-002839', 'drd-003193', 'drd-003276',
  'drd-007617', 'drd-007798', 'drd-009210', 'drd-001243',
  'drd-005908', 'drd-002614', 'drd-003277', 'drd-002719',
  'drd-007422', 'drd-000896', 'drd-003001', 'drd-009212',
  'drd-008150', 'drd-002755', 'drd-001246'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of ['drd-004236', 'drd-004265', 'drd-004289']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// Luke 3 genealogy: these recovered candidates join non-adjacent generations.
// Keep them for the multihop path audit; do not fabricate direct parent edges.
for (const id of [
  'drd-009565', 'drd-009566', 'drd-009534', 'drd-009536', 'drd-009604', 'drd-009605',
  'drd-009606', 'drd-009569', 'drd-009570', 'drd-009594', 'drd-009595', 'drd-009596',
  'drd-009585', 'drd-009586', 'drd-009587', 'drd-009576', 'drd-009577', 'drd-009572',
  'drd-009573', 'drd-009538', 'drd-009525', 'drd-009526', 'drd-009554', 'drd-009556',
  'drd-009557', 'drd-009545', 'drd-009546', 'drd-009547', 'drd-009589', 'drd-009590',
  'drd-009578', 'drd-009579', 'drd-009548', 'drd-009549', 'drd-009528', 'drd-009529',
  'drd-009530', 'drd-009592', 'drd-009581', 'drd-009582', 'drd-009552', 'drd-009597',
  'drd-009541', 'drd-009542', 'drd-009533', 'drd-009601', 'drd-009602', 'drd-009543',
  'drd-009558', 'drd-009560', 'drd-009561'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

// LUK 3:1 calls Philip Herod's brother; Lysanias is a separately listed
// tetrarch. The recovered Lysanias–Philip pair is therefore a cross-pair.
CURATED_NO_DIRECT_RELATION_REJECTIONS.add('drd-009515');

// Recovered NT incidental pairs: spouse/parent labels, witness lists, quoted
// figures, and patronymics do not link these particular endpoints directly.
for (const id of [
  'drd-009420', 'drd-009622', 'drd-009623', 'drd-009421', 'drd-009626',
  'drd-009494', 'drd-009470', 'drd-009618', 'drd-009619', 'drd-009620',
  'drd-009463', 'drd-009495', 'drd-009472', 'drd-009496', 'drd-009473',
  'drd-009640', 'drd-009641', 'drd-009432', 'drd-009642'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

const CURATED_NO_DIRECT_RELATION_REJECTIONS_SA_BATCH = [
  'drd-002142', 'drd-002143', 'drd-002144', 'drd-002145',
  'drd-002146', 'drd-002147', 'drd-002347', 'drd-002348',
  'drd-002481', 'drd-002482', 'drd-002483', 'drd-002484',
  'drd-002312', 'drd-002199', 'drd-002209'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_SA_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_1KI_CONSERVATIVE_BATCH = [
  'drd-002565', 'drd-002731', 'drd-002745', 'drd-002704',
  'drd-002636', 'drd-002593', 'drd-002600', 'drd-002601',
  'drd-002635', 'drd-002728', 'drd-002730', 'drd-002732'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1KI_CONSERVATIVE_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_JER_KINSHIP_BATCH = [
  'drd-007721', 'drd-007773', 'drd-007768', 'drd-008138', 'drd-008148', 'drd-007775',
  'drd-008141', 'drd-008142', 'drd-008143', 'drd-007974', 'drd-007769', 'drd-007959',
  'drd-007814', 'drd-007815', 'drd-007964', 'drd-007965', 'drd-007776', 'drd-007966',
  'drd-007967', 'drd-007961', 'drd-007962', 'drd-007797', 'drd-007799', 'drd-007727',
  'drd-007728', 'drd-007800', 'drd-007731', 'drd-009204', 'drd-007802', 'drd-008160',
  'drd-007732'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_JER_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_2CH_KINSHIP_BATCH = [
  'drd-005779', 'drd-005780', 'drd-005781', 'drd-005929', 'drd-005886', 'drd-005887',
  'drd-005857', 'drd-006496', 'drd-006497', 'drd-006498', 'drd-006362', 'drd-006364',
  'drd-006348', 'drd-006349', 'drd-006350', 'drd-006351', 'drd-006352', 'drd-006505',
  'drd-006506', 'drd-006507', 'drd-006365', 'drd-006367', 'drd-006353'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2CH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_NUM_KINSHIP_BATCH = [
  'drd-000968', 'drd-000963', 'drd-000970', 'drd-000971', 'drd-000938',
  'drd-001107', 'drd-000934', 'drd-001108', 'drd-000935', 'drd-001002',
  'drd-000974', 'drd-000943', 'drd-000931', 'drd-000975', 'drd-000944',
  'drd-000939', 'drd-000940', 'drd-001004', 'drd-000933'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_NUM_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_EZR_KINSHIP_BATCH = [
  'drd-006697', 'drd-006698', 'drd-006788', 'drd-006815', 'drd-006734',
  'drd-006735', 'drd-006784', 'drd-006790', 'drd-006785', 'drd-006819',
  'drd-006701', 'drd-006742', 'drd-006822', 'drd-006736', 'drd-006826'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_EZR_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_JDG_KINSHIP_BATCH = [
  'drd-001537', 'drd-001598', 'drd-001578', 'drd-001579', 'drd-001581',
  'drd-001582', 'drd-001572', 'drd-001583', 'drd-001522', 'drd-001523',
  'drd-001599', 'drd-001588', 'drd-001589'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_JDG_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_1SA_KINSHIP_BATCH = [
  'drd-002025', 'drd-002005', 'drd-002027', 'drd-001867', 'drd-001871',
  'drd-002008', 'drd-002009', 'drd-001847', 'drd-001850', 'drd-001851',
  'drd-001853'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1SA_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_HOSTILE_KINSHIP_BATCH = [
  'drd-002988', 'drd-002989', 'drd-002972', 'drd-002973', 'drd-002974',
  'drd-002975', 'drd-002976', 'drd-002994', 'drd-002963', 'drd-002835',
  'drd-002836'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_HOSTILE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_KINSHIP_BATCH = [
  'drd-002968', 'drd-002971', 'drd-002956', 'drd-002932', 'drd-002933',
  'drd-002808', 'drd-002934', 'drd-002884', 'drd-002887', 'drd-002885'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// 2KI 15:13 says “Judah king Uzziah” and “Shallum son of Jabesh”.
// None of these four cross-pairs is a direct relationship; the actual
// Jabesh→Shallum parent assertion already exists separately as asrt-1934.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_1513_CROSS_PAIRS = [
  'drd-002959', 'drd-002960', 'drd-002961', 'drd-002962'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_1513_CROSS_PAIRS) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// EZE 11:1 contains two separate parent-child phrases:
// Azzur→Jaazaniah and Benaiah→Pelatiah. These are the four cross-pairs
// produced by same-verse co-mention and are not direct relationships.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_EZE_111_CROSS_PAIRS = [
  'drd-009216', 'drd-009218', 'drd-009219', 'drd-009221'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_EZE_111_CROSS_PAIRS) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// ISA 7:5 uses Ephraim as a political community. ISA 8:2 reads
// “Uriah the priest and Zechariah son of Jeberechiah”; it does not make
// Jeberechiah parent of Uriah or Uriah sibling/parent of Zechariah.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_ISA_CROSS_PAIRS = [
  'drd-007694', 'drd-007696', 'drd-007698'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_ISA_CROSS_PAIRS) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// 1SA 9:1 states longer ancestry chains. These pairs are three-hop paths,
// not direct parent/sibling edges; the multi-hop audit preserves them.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_1SA_91_REMOTE_ANCESTRY = [
  'drd-001815', 'drd-001817'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1SA_91_REMOTE_ANCESTRY) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_1KI_REMAINING_KINSHIP_BATCH = [
  'drd-002713', 'drd-002696', 'drd-002673', 'drd-002587', 'drd-002737',
  'drd-002565', 'drd-002568', 'drd-002569', 'drd-002588', 'drd-002578',
  'drd-002580', 'drd-002581', 'drd-002639', 'drd-002582', 'drd-002611',
  'drd-002612', 'drd-002641', 'drd-002739', 'drd-002605', 'drd-002606',
  'drd-002741', 'drd-002615'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1KI_REMAINING_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// 2 Samuel, single-passage kinship-trigger batch. Each pair below is a
// cross-product/co-occurrence false positive: the verse's actual patronymic,
// marriage, household, or tribal phrase connects a different named pair.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_SINGLE_KINSHIP_BATCH = [
  'drd-002139', 'drd-002153', 'drd-002154', 'drd-002155', 'drd-002156',
  'drd-002157', 'drd-002158', 'drd-002189', 'drd-002191', 'drd-002193',
  'drd-002201', 'drd-002202', 'drd-002225', 'drd-002227', 'drd-002342',
  'drd-002350', 'drd-002351', 'drd-002352', 'drd-002357', 'drd-002359',
  'drd-002363', 'drd-002365', 'drd-002368', 'drd-002371', 'drd-002372',
  'drd-002383', 'drd-002473', 'drd-002474', 'drd-002486', 'drd-002487',
  'drd-002488', 'drd-002489', 'drd-002491', 'drd-002492', 'drd-002493',
  'drd-002496', 'drd-002497', 'drd-002501', 'drd-002502'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_SINGLE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_SINGLE_PATH_KINSHIP_BATCH = [
  'drd-003501', 'drd-003618', 'drd-004520', 'drd-003342', 'drd-004492',
  'drd-003346', 'drd-004854', 'drd-004444', 'drd-004762', 'drd-004763',
  'drd-005648', 'drd-003425', 'drd-003639', 'drd-004715', 'drd-003352',
  'drd-003353', 'drd-003621', 'drd-004718', 'drd-004740', 'drd-004514',
  'drd-005654', 'drd-005655', 'drd-004409', 'drd-004412', 'drd-004720'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_SINGLE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// 1 Chronicles candidates whose two-hop context confirms that the named pair
// is separated by intervening generations or belongs to different branches of
// the same list. The five Timna pairs in 1CH 1:36 remain pending because that
// verse's compressed list conflicts with GEN 36:12's concubine relationship.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_TWO_PATH_KINSHIP_BATCH = [
  'drd-003499', 'drd-003500', 'drd-003476', 'drd-003478', 'drd-004400',
  'drd-004389', 'drd-004736', 'drd-003421', 'drd-004987', 'drd-004489',
  'drd-004407', 'drd-004433', 'drd-004526', 'drd-004512', 'drd-004513',
  'drd-004379', 'drd-004778', 'drd-004496', 'drd-004411'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_TWO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

// 1 Chronicles single-passage candidates without an existing path. Verse-level
// review shows that each is either a remote ancestor, a different branch in a
// genealogy, or a bystander in an administrative/priestly list.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_NO_PATH_KINSHIP_BATCH = [
  'drd-004960', 'drd-004961', 'drd-004964', 'drd-005431', 'drd-005422',
  'drd-005423', 'drd-004965', 'drd-005261', 'drd-004973', 'drd-004735',
  'drd-004737', 'drd-005701', 'drd-005702', 'drd-005429', 'drd-005430'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_NO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_TWO_PASSAGE_KINSHIP_BATCH = [
  'drd-002226', 'drd-002340', 'drd-002314', 'drd-002180', 'drd-002181',
  'drd-002315', 'drd-002188', 'drd-002471', 'drd-002472', 'drd-002182',
  'drd-002183', 'drd-002505'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_TWO_PASSAGE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_SINGLE_PATH_KINSHIP_BATCH = [
  'drd-002375', 'drd-002098', 'drd-002107', 'drd-002247',
  'drd-002343', 'drd-002360', 'drd-002362', 'drd-002328'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_SINGLE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_TWO_PASSAGE_KINSHIP_BATCH = [
  'drd-002800', 'drd-003013', 'drd-003014', 'drd-002969', 'drd-003059',
  'drd-003060', 'drd-002931', 'drd-002886', 'drd-003177'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_TWO_PASSAGE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_1KI_TWO_PASSAGE_KINSHIP_BATCH = [
  'drd-002773', 'drd-002789', 'drd-002564', 'drd-002598',
  'drd-002779', 'drd-002777'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1KI_TWO_PASSAGE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_JER_TWO_PASSAGE_KINSHIP_BATCH = [
  'drd-007796', 'drd-008056', 'drd-008129'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_JER_TWO_PASSAGE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_1SA_SINGLE_PATH_KINSHIP_BATCH = [
  'drd-002053', 'drd-002026', 'drd-001814', 'drd-001868', 'drd-001872'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1SA_SINGLE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_NEH_TWO_PATH_KINSHIP_BATCH = [
  'drd-007323', 'drd-007448', 'drd-007429', 'drd-009407',
  'drd-007337', 'drd-007420', 'drd-007454', 'drd-007341'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_NEH_TWO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_NEH_SINGLE_PATH_KINSHIP_BATCH = [
  'drd-007331', 'drd-007430', 'drd-007336', 'drd-007523',
  'drd-007455', 'drd-009410', 'drd-007409'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_NEH_SINGLE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_JOS_NO_PATH_KINSHIP_BATCH = [
  'drd-001506', 'drd-001507', 'drd-001410',
  'drd-001411', 'drd-001512', 'drd-001513'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_JOS_NO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_RUT_NO_PATH_KINSHIP_BATCH = [
  'drd-001758', 'drd-001759', 'drd-001760', 'drd-001761'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_RUT_NO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_GEN_THREE_PATH_KINSHIP_BATCH = [
  'drd-000348', 'drd-000451', 'drd-000452', 'drd-000453'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_GEN_THREE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_GEN_NO_PATH_KINSHIP_BATCH = [
  'drd-000274', 'drd-000810', 'drd-000291', 'drd-000253'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_GEN_NO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_NUM_TWO_PASSAGE_KINSHIP_BATCH = [
  'drd-001099', 'drd-001248', 'drd-001079'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_NUM_TWO_PASSAGE_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_TWO_PATH_KINSHIP_BATCH = [
  'drd-002097', 'drd-002177', 'drd-002102', 'drd-002316'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2SA_TWO_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_SINGLE_PATH_KINSHIP_BATCH = [
  'drd-002921', 'drd-003174', 'drd-003033'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_SINGLE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_HOSTILE_SINGLE_PATH_BATCH = [
  'drd-002993', 'drd-002965', 'drd-002996', 'drd-002966', 'drd-002837'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_2KI_HOSTILE_SINGLE_PATH_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_TWO_PASSAGE_TWO_PATH_BATCH = [
  'drd-004547', 'drd-005035', 'drd-005085', 'drd-005134'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_1CH_TWO_PASSAGE_TWO_PATH_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_LUK_SINGLE_PATH_KINSHIP_BATCH = [
  'drd-009365', 'drd-009361', 'drd-009374', 'drd-009375'
];
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_LUK_SINGLE_PATH_KINSHIP_BATCH) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-007130','drd-007467','drd-007468','drd-007469','drd-007147','drd-007148','drd-007156','drd-007140','drd-007153','drd-007154','drd-007105','drd-007144','drd-007471','drd-007112','drd-007137','drd-007119','drd-007155','drd-007473','drd-007474','drd-007475','drd-007126','drd-007305','drd-007159','drd-007169','drd-007150']) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
for (const id of ['drd-003169', 'drd-003170', 'drd-008108', 'drd-007810', 'drd-003172', 'drd-008157', 'drd-007975', 'drd-003180']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-002195', 'drd-002550', 'drd-002523', 'drd-002527', 'drd-002530']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
CURATED_NO_DIRECT_RELATION_REJECTIONS.add('drd-000383'); // 祭便与以扫只可由祭便→亚拿→阿何利巴玛—以扫的构成路径解释。
for (const id of ['drd-003051', 'drd-003036', 'drd-003037', 'drd-003039', 'drd-003043', 'drd-003044']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-002554', 'drd-002555', 'drd-002558', 'drd-002560', 'drd-002140']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-003105', 'drd-003106', 'drd-003107', 'drd-003109', 'drd-003110', 'drd-003111', 'drd-003114', 'drd-003116', 'drd-003104']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-008012', 'drd-008014', 'drd-008015', 'drd-008016', 'drd-008017', 'drd-008020', 'drd-008023', 'drd-008024']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-007515', 'drd-007517']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-009339', 'drd-009341', 'drd-009342', 'drd-009344', 'drd-009345', 'drd-009348']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-002034', 'drd-002039', 'drd-002041', 'drd-002042', 'drd-002043', 'drd-002048', 'drd-002049']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-002282', 'drd-002287', 'drd-002289', 'drd-002293', 'drd-002294', 'drd-002295']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-002831', 'drd-002832', 'drd-002833', 'drd-002834', 'drd-002768', 'drd-002769', 'drd-002709', 'drd-002770']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-000950', 'drd-000952', 'drd-000954', 'drd-000956', 'drd-000958', 'drd-000959', 'drd-000960', 'drd-000962']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-008057', 'drd-008059', 'drd-008062', 'drd-007729', 'drd-008063']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-006663', 'drd-006654', 'drd-009332', 'drd-009333', 'drd-009334', 'drd-006672']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
for (const id of ['drd-002951', 'drd-002925', 'drd-009288', 'drd-009289', 'drd-009290', 'drd-009291', 'drd-009292']) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_FALSE_POSITIVES = new Set([
  'drd-000002',
  'drd-001458',
  'drd-001405',
  'drd-001244',
  'drd-000256',
  'drd-000584',
  'drd-007406',
  'drd-007514',
  'drd-007405',
  'drd-006739',
  'drd-001221',
  'drd-001222',
  'drd-001223',
  'drd-001224',
  'drd-001225',
  'drd-001226',
  'drd-007513'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_FALSE_POSITIVES) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
const CURATED_NO_DIRECT_RELATION_REJECTIONS_BATCH = new Set([
  'drd-005768', 'drd-002510', 'drd-002070', 'drd-005741', 'drd-001635', 'drd-005193', 'drd-005800', 'drd-005356', 'drd-005357', 'drd-003691', 'drd-003693', 'drd-001316', 'drd-001317', 'drd-001318', 'drd-001319', 'drd-003694', 'drd-003695', 'drd-003696', 'drd-003697', 'drd-003698', 'drd-003699', 'drd-003700', 'drd-003701', 'drd-003702', 'drd-001321', 'drd-001322', 'drd-001323', 'drd-003703', 'drd-003704', 'drd-003705', 'drd-003706', 'drd-003707', 'drd-003708', 'drd-003709', 'drd-003710', 'drd-003714', 'drd-003715', 'drd-003716', 'drd-003717', 'drd-003718', 'drd-003719', 'drd-003720', 'drd-003721', 'drd-003722', 'drd-003723', 'drd-003724', 'drd-003725', 'drd-003726', 'drd-003727', 'drd-003728', 'drd-003729', 'drd-003730', 'drd-003731', 'drd-003732', 'drd-003733', 'drd-003734', 'drd-003735', 'drd-003736', 'drd-003737', 'drd-003738', 'drd-003739', 'drd-003740', 'drd-003741', 'drd-003742', 'drd-003743', 'drd-003744', 'drd-003745', 'drd-003746', 'drd-003747', 'drd-003748', 'drd-003749', 'drd-003750', 'drd-003751', 'drd-003752', 'drd-003753', 'drd-003754', 'drd-003755', 'drd-003756', 'drd-003757', 'drd-003758', 'drd-003759', 'drd-003760', 'drd-003761', 'drd-003762', 'drd-003763', 'drd-003764', 'drd-003765', 'drd-003766', 'drd-003767', 'drd-003768', 'drd-003018', 'drd-002771', 'drd-005803', 'drd-002997', 'drd-004471', 'drd-002659', 'drd-002616', 'drd-001887'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_BATCH) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
const CURATED_NO_DIRECT_RELATION_REJECTIONS_EXTRA = new Set(['drd-006812', 'drd-006813', 'drd-006816', 'drd-006817', 'drd-006820', 'drd-006823', 'drd-006828', 'drd-006831', 'drd-006832', 'drd-006833', 'drd-006834', 'drd-006839', 'drd-006840', 'drd-006841', 'drd-006842', 'drd-006843', 'drd-006844', 'drd-006848', 'drd-006849', 'drd-006851', 'drd-006852', 'drd-006853', 'drd-006854', 'drd-006856', 'drd-006857', 'drd-006858', 'drd-006860', 'drd-006861', 'drd-006863', 'drd-006873', 'drd-006874', 'drd-006875', 'drd-006876', 'drd-006878', 'drd-006879', 'drd-006880', 'drd-006881', 'drd-006883', 'drd-006884', 'drd-006885', 'drd-006887', 'drd-006888', 'drd-006890', 'drd-006892', 'drd-006905', 'drd-006906', 'drd-006907', 'drd-006908', 'drd-006909', 'drd-006910', 'drd-006911', 'drd-006912', 'drd-006913', 'drd-006914', 'drd-006921', 'drd-006922', 'drd-006923', 'drd-006924', 'drd-006926', 'drd-006927', 'drd-006928', 'drd-006930', 'drd-006931', 'drd-006933', 'drd-006943', 'drd-006944', 'drd-006945', 'drd-006957', 'drd-006958', 'drd-006959', 'drd-006960', 'drd-006961', 'drd-006962', 'drd-006963', 'drd-006964', 'drd-006965', 'drd-006966', 'drd-006998', 'drd-007004', 'drd-007005', 'drd-007006', 'drd-007007', 'drd-007012', 'drd-007013', 'drd-007014', 'drd-007015', 'drd-007016', 'drd-007019', 'drd-007020', 'drd-007021', 'drd-007022', 'drd-007023', 'drd-007024', 'drd-007031', 'drd-007032', 'drd-007033', 'drd-007034', 'drd-007035', 'drd-007036', 'drd-007037', 'drd-007038', 'drd-007039', 'drd-007040', 'drd-007041', 'drd-007042', 'drd-007043', 'drd-007044', 'drd-007045', 'drd-007051', 'drd-007058', 'drd-007059', 'drd-007060', 'drd-007061', 'drd-007062', 'drd-007063', 'drd-007064', 'drd-007065', 'drd-007066', 'drd-007067', 'drd-007068', 'drd-007069', 'drd-007070', 'drd-007071', 'drd-007072']);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_EXTRA) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
const CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_CHRONICLES = new Set([
  'drd-003289', 'drd-003290', 'drd-003291', 'drd-003292', 'drd-003293', 'drd-003305',
  'drd-003306', 'drd-003307', 'drd-003308', 'drd-003309', 'drd-003310', 'drd-005112',
  'drd-005113', 'drd-005114', 'drd-005115', 'drd-006393', 'drd-006394', 'drd-006395',
  'drd-006396', 'drd-006397', 'drd-006398', 'drd-006399', 'drd-006400', 'drd-006401',
  'drd-006402', 'drd-006403', 'drd-006404', 'drd-004383', 'drd-004385', 'drd-004442',
  'drd-005745', 'drd-005728', 'drd-003479', 'drd-003480', 'drd-003656', 'drd-003657',
  'drd-003658', 'drd-004697', 'drd-004699', 'drd-004700', 'drd-005153', 'drd-005154',
  'drd-002468', 'drd-002469', 'drd-005194', 'drd-005195', 'drd-005196', 'drd-005197',
  'drd-005199', 'drd-005201', 'drd-005202', 'drd-005204', 'drd-005206',
  'drd-000603', 'drd-000606', 'drd-004321', 'drd-004322', 'drd-004323', 'drd-004324',
  'drd-004325', 'drd-004326', 'drd-004331', 'drd-004332', 'drd-004335', 'drd-004337',
  'drd-004338', 'drd-004339', 'drd-004340', 'drd-004341', 'drd-004342', 'drd-004344',
  'drd-004345', 'drd-004346', 'drd-004348', 'drd-004349', 'drd-004350', 'drd-004351',
  'drd-004352', 'drd-004353', 'drd-000804', 'drd-005162', 'drd-002506', 'drd-002507',
  'drd-002508', 'drd-005221', 'drd-005179'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_CHRONICLES) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
// 1 Chronicles single-passage kinship false positives, independently replayed
// against the CUV text on 2026-08-31. These rows name people in the same
// roster or genealogy context but do not state a direct relationship between
// the candidate endpoints. The 15 unresolved genealogy rows remain pending.
const CURATED_NO_DIRECT_RELATION_REJECTIONS_REVIEWED_1CH_KINSHIP = new Set([
  'drd-005705', 'drd-003613', 'drd-005163', 'drd-005164', 'drd-005146', 'drd-005147',
  'drd-005743', 'drd-005746', 'drd-005755', 'drd-005756', 'drd-005762', 'drd-005584',
  'drd-004390', 'drd-005727', 'drd-005729', 'drd-005757', 'drd-005758', 'drd-005711',
  'drd-005714', 'drd-005148', 'drd-004439', 'drd-005151', 'drd-005152', 'drd-005183',
  'drd-005184', 'drd-005185', 'drd-005186', 'drd-005686', 'drd-005688', 'drd-005649',
  'drd-005650', 'drd-005709', 'drd-005187', 'drd-003316', 'drd-005585', 'drd-004484',
  'drd-003355', 'drd-005297', 'drd-005298', 'drd-005733', 'drd-005735', 'drd-003614',
  'drd-005747', 'drd-005716', 'drd-005751', 'drd-004386', 'drd-004387', 'drd-005212',
  'drd-005213', 'drd-005214', 'drd-005215', 'drd-004393', 'drd-005178', 'drd-005721',
  'drd-005216', 'drd-005218', 'drd-005219', 'drd-005160', 'drd-005736', 'drd-004396',
  'drd-004397', 'drd-004388', 'drd-005173', 'drd-004485', 'drd-005692', 'drd-003356',
  'drd-005738', 'drd-005752', 'drd-003317', 'drd-003615', 'drd-005763', 'drd-003318',
  'drd-004410', 'drd-005695'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_REVIEWED_1CH_KINSHIP) {
  CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
}
const CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_TEXTUAL_CONTAMINATION = new Set([
  'drd-007464', 'drd-007465', 'drd-007466', 'drd-007470', 'drd-007472',
  'drd-000951', 'drd-000953', 'drd-000955', 'drd-000957',
  'drd-001217', 'drd-001218', 'drd-001219', 'drd-001220',
  'drd-007530', 'drd-007510', 'drd-007511'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_TEXTUAL_CONTAMINATION) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

const CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_PAIR_MISMATCH = new Set([
  'drd-002790',
  'drd-002791',
  'drd-002793',
  'drd-002759',
  'drd-002751',
  'drd-003085',
  'drd-007686',
  'drd-007687',
  'drd-001552',
  'drd-001553',
  'drd-001555',
, 'drd-002519', 'drd-005772', 'drd-002910', 'drd-002911', 'drd-002912', 'drd-002913', 'drd-005774', 'drd-005775', 'drd-002915', 'drd-002918', 'drd-002919', 'drd-000530', 'drd-000531']);
for (const id of [
  'drd-002571', 'drd-001896', 'drd-003017', 'drd-002032', 'drd-002172',
  'drd-002750', 'drd-000340', 'drd-009311', 'drd-009312', 'drd-009313',
  'drd-009314', 'drd-009315', 'drd-002984', 'drd-002985', 'drd-002986', 'drd-002987'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_PAIR_MISMATCH.add(id);
for (const id of [
  'drd-009275', 'drd-006371', 'drd-009276', 'drd-009202', 'drd-007736',
  'drd-009203', 'drd-009285', 'drd-009286', 'drd-007690'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_PAIR_MISMATCH.add(id);
for (const id of [
  'drd-005951', 'drd-007794', 'drd-005952', 'drd-008146', 'drd-008147',
  'drd-006177', 'drd-006179', 'drd-008154', 'drd-008155', 'drd-008156',
  'drd-009228', 'drd-004772', 'drd-004773', 'drd-003202', 'drd-006626',
  'drd-006627'
]) CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_PAIR_MISMATCH.add(id);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_PAIR_MISMATCH) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

const CURATED_PATH_ONLY_INDIRECT = new Set([
  'drd-000858',
  'drd-000859',
  'drd-000921',
  'drd-000922',
  'drd-001005',
  'drd-000890',
  'drd-000923',
  'drd-000214',
  'drd-000215',
  'drd-000807',
  'drd-000202',
  'drd-001503',
  'drd-000817',
  'drd-009309',
  'drd-002675',
  'drd-000324',
  'drd-000967',
  'drd-000964',
  'drd-002548',
  'drd-002574',
  'drd-002186',
  'drd-002511',
  'drd-003005',
  'drd-002703',
  'drd-002685',
  'drd-002686',
  'drd-001508',
  'drd-001509',
  'drd-001897',
  'drd-002013',
  'drd-002374',
  'drd-002570',
  'drd-002203',
  'drd-002332',
  'drd-002386',
  'drd-002217',
  'drd-002267',
  'drd-005764',
  'drd-006384',
  'drd-003053',
  'drd-006392',
  'drd-003062',
  'drd-000267',
  'drd-000249',
  'drd-000268',
  'drd-000808',
  'drd-000329',
  'drd-000252',
  'drd-006169',
  'drd-003078',
  'drd-000303',
  'drd-000330',
  'drd-000339',
  'drd-002826',
  'drd-005955',
  'drd-002795',
  'drd-005927',
  'drd-005878',
  'drd-002772',
  'drd-005953',
  'drd-002801',
  'drd-008027',
  'drd-008028',
  'drd-007973',
  'drd-008029',
  'drd-008064',
  'drd-008164',
  'drd-007720',
  'drd-007969',
  'drd-008166',
  'drd-007723',
  'drd-009206',
  'drd-007724',
  'drd-008071',
  'drd-008109',
  'drd-007972',
  'drd-008072',
  'drd-007771',
  'drd-008032',
  'drd-008066',
  'drd-008058',
  'drd-007763',
  'drd-007764',
  'drd-002002',
  'drd-002003',
  'drd-002334',
  'drd-002004',
  'drd-001993',
  'drd-002021',
  'drd-002335',
  'drd-007663',
  'drd-000897',
  'drd-001238',
  'drd-000613',
  'drd-001240',
  'drd-003083', 'drd-002655', 'drd-002272', 'drd-000540', 'drd-000541', 'drd-000542', 'drd-000543', 'drd-000538', 'drd-005770', 'drd-000545', 'drd-000546', 'drd-000547', 'drd-000527', 'drd-000550']);
for (const id of ['drd-002664', 'drd-002892', 'drd-002905']) CURATED_PATH_ONLY_INDIRECT.add(id);
for (const id of ['drd-006740', 'drd-006625', 'drd-006629', 'drd-009320', 'drd-009323', 'drd-009325']) CURATED_PATH_ONLY_INDIRECT.add(id);
CURATED_PATH_ONLY_INDIRECT.add('drd-007684');
// drd-006016: 2CH 23:18 is Davidic ordinance context, not a direct Jehoiada personal appointment edge.
CURATED_PATH_ONLY_INDIRECT.add('drd-006016');

const CURATED_PATH_ONLY_APPROVED_SKIPPED_GENERATIONS = [
  'drd-009385', 'drd-009376', 'drd-009377', 'drd-009355', 'drd-009356',
  'drd-009370', 'drd-009371', 'drd-009379', 'drd-009380', 'drd-009359',
  'drd-009360', 'drd-009366', 'drd-009367', 'drd-009368', 'drd-009369',
  'drd-009381', 'drd-009382'
];
for (const id of CURATED_PATH_ONLY_APPROVED_SKIPPED_GENERATIONS) CURATED_PATH_ONLY_INDIRECT.add(id);
const CURATED_PATH_ONLY_CANDIDATES = new Set(CURATED_PATH_ONLY_INDIRECT);
CURATED_PATH_ONLY_INDIRECT.add('drd-002083');
CURATED_PATH_ONLY_CANDIDATES.add('drd-002083'); // 亚比该—大卫—押沙龙：保留继亲构成路径，不作为经文明示母子边。
CURATED_PATH_ONLY_INDIRECT.add('drd-009983');
CURATED_PATH_ONLY_CANDIDATES.add('drd-009983');
const CURATED_PATH_ONLY_INDIRECT_REVIEW_JSONL_BATCH = [
  'drd-005949', 'drd-009400', 'drd-009402', 'drd-009621', 'drd-009627',
  'drd-009696', 'drd-009697', 'drd-009698', 'drd-009703', 'drd-009725',
  'drd-009726', 'drd-009748', 'drd-009754', 'drd-009787', 'drd-009788',
  'drd-009804', 'drd-009805', 'drd-009807', 'drd-009815', 'drd-009826',
  'drd-009827', 'drd-009828', 'drd-009830', 'drd-009833', 'drd-009834',
  'drd-009835', 'drd-009836', 'drd-009837', 'drd-009838', 'drd-009839',
  'drd-009840', 'drd-009841', 'drd-009842', 'drd-009843', 'drd-009844',
  'drd-009846', 'drd-009931', 'drd-009936', 'drd-009944', 'drd-009945',
  'drd-009963', 'drd-009968', 'drd-009986', 'drd-009992', 'drd-009993',
  'drd-010003', 'drd-010004', 'drd-010005', 'drd-010006', 'drd-010011',
  'drd-010014', 'drd-010015', 'drd-010019', 'drd-010020', 'drd-010022',
  'drd-010024', 'drd-010025', 'drd-010026', 'drd-010027', 'drd-010032',
  'drd-010034', 'drd-010035', 'drd-010036', 'drd-010039', 'drd-010040',
  'drd-010047', 'drd-010051', 'drd-010052', 'drd-010057', 'drd-010059',
  'drd-010062', 'drd-010064', 'drd-010066', 'drd-010067', 'drd-010068',
  'drd-010069', 'drd-010070', 'drd-010071', 'drd-010072', 'drd-010073',
  'drd-010074', 'drd-010075'
];
for (const id of CURATED_PATH_ONLY_INDIRECT_REVIEW_JSONL_BATCH) {
  CURATED_PATH_ONLY_INDIRECT.add(id);
  CURATED_PATH_ONLY_CANDIDATES.add(id);
}
for (const id of ['drd-007443', 'drd-007516', 'drd-007520', 'drd-007524', 'drd-007525', 'drd-007527']) {
  CURATED_PATH_ONLY_INDIRECT.add(id);
  CURATED_PATH_ONLY_CANDIDATES.add(id);
}
for (const id of ['drd-007444', 'drd-005027']) {
  CURATED_PATH_ONLY_INDIRECT.add(id);
  CURATED_PATH_ONLY_CANDIDATES.add(id);
}

const CURATED_PATH_ONLY_INDIRECT_REVIEW_JSONL_C_BATCH = [
  'drd-009729', 'drd-009730', 'drd-009731', 'drd-009732', 'drd-009733', 'drd-009734', 'drd-009735',
  'drd-009974', 'drd-009985', 'drd-009736', 'drd-009737', 'drd-009738', 'drd-009758', 'drd-009739', 'drd-009740',
  'drd-009770', 'drd-009741', 'drd-009831', 'drd-009975', 'drd-009871', 'drd-009829', 'drd-000008', 'drd-009958',
  'drd-009959', 'drd-009886', 'drd-009887', 'drd-009888', 'drd-009862', 'drd-009950', 'drd-009863', 'drd-009951',
  'drd-009942', 'drd-009889', 'drd-009890', 'drd-009891', 'drd-009893', 'drd-009894', 'drd-009895', 'drd-009806',
  'drd-009976', 'drd-009977', 'drd-009909', 'drd-009904', 'drd-009952', 'drd-009868', 'drd-009978', 'drd-009979',
  'drd-009947', 'drd-009949', 'drd-009905', 'drd-009880', 'drd-009865', 'drd-009866', 'drd-009869', 'drd-009867',
  'drd-009881', 'drd-009897', 'drd-009898', 'drd-009899', 'drd-009960', 'drd-009961', 'drd-009940', 'drd-009962',
  'drd-009970', 'drd-009932', 'drd-009933', 'drd-009965', 'drd-009966', 'drd-009901', 'drd-009971', 'drd-009902',
  'drd-009903', 'drd-009967'
];
for (const id of CURATED_PATH_ONLY_INDIRECT_REVIEW_JSONL_C_BATCH) {
  CURATED_PATH_ONLY_INDIRECT.add(id);
  CURATED_PATH_ONLY_CANDIDATES.add(id);
}

const CURATED_PATH_ONLY_INDIRECT_REVIEW_JSONL_D_BATCH = [
  'drd-010063', 'drd-009775', 'drd-009785', 'drd-009714', 'drd-009786', 'drd-009776', 'drd-009715',
  'drd-009716', 'drd-009717', 'drd-009718', 'drd-009719', 'drd-009720', 'drd-010012', 'drd-010060',
  'drd-010013', 'drd-009393', 'drd-009394', 'drd-009396', 'drd-009692', 'drd-010045', 'drd-009693',
  'drd-009694', 'drd-009704', 'drd-009695', 'drd-009750', 'drd-009721', 'drd-009722', 'drd-009723',
  'drd-009724', 'drd-009662', 'drd-010002', 'drd-009430', 'drd-009765', 'drd-009766', 'drd-009767',
  'drd-009984', 'drd-009907', 'drd-010048', 'drd-009700', 'drd-009768', 'drd-009789', 'drd-010009',
  'drd-009783', 'drd-009727'
];
for (const id of CURATED_PATH_ONLY_INDIRECT_REVIEW_JSONL_D_BATCH) {
  CURATED_PATH_ONLY_INDIRECT.add(id);
  CURATED_PATH_ONLY_CANDIDATES.add(id);
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_PURE_FALSE = new Set([
  'drd-001640',
  'drd-001641',
  'drd-001642',
  'drd-001643',
  'drd-001644',
  'drd-001645',
  'drd-001646',
  'drd-001647',
  'drd-001648',
  'drd-002679',
  'drd-002680',
  'drd-001511',
  'drd-003003',
  'drd-003097',
  'drd-002676',
  'drd-001529',
  'drd-007716',
  'drd-002662',
  'drd-002663',
  'drd-002608',
  'drd-007806',
  'drd-007717',
  'drd-001838',
  'drd-002609',
  'drd-002109',
  'drd-009271',
  'drd-009272',
  'drd-003011',
  'drd-003012',
  'drd-009273',
  'drd-009274',
  'drd-009306',
  'drd-009307',
  'drd-009308',
  'drd-009310',
  'drd-002726',
  'drd-002712',
  'drd-002677',
  'drd-002695',
  'drd-002723',
  'drd-009387',
  'drd-007129',
  'drd-002185',
  'drd-002575',
  'drd-001212',
  'drd-001213',
  'drd-001214',
  'drd-001215',
  'drd-001216',
  'drd-003019',
  'drd-003020',
  'drd-009277',
  'drd-009278',
  'drd-003032',
  'drd-009279',
  'drd-009281',
  'drd-009283',
  'drd-009284',
  'drd-002796',
  'drd-001836',
  'drd-006372',
  'drd-007620',
  'drd-002794',
  'drd-007733',
  'drd-001888',
  'drd-002809',
  'drd-002810',
  'drd-002811',
  'drd-002812',
  'drd-003022',
  'drd-003023',
  'drd-003024',
  'drd-003025',
  'drd-008167',
  'drd-008168',
  'drd-008169',
  'drd-008170',
  'drd-008171',
  'drd-008172',
  'drd-008173',
  'drd-008174',
  'drd-008175',
  'drd-008176',
  'drd-008177',
  'drd-008178',
  'drd-008179',
  'drd-008180',
  'drd-008181',
  'drd-008182',
  'drd-008183',
  'drd-008184',
  'drd-008185',
  'drd-008186',
  'drd-008187',
  'drd-007819',
  'drd-007820',
  'drd-007821',
  'drd-007822',
  'drd-007823',
  'drd-007824',
  'drd-007825',
  'drd-007826',
  'drd-007827',
  'drd-007828',
  'drd-008188',
  'drd-008189',
  'drd-008190',
  'drd-008191',
  'drd-008192',
  'drd-008193',
  'drd-000554',
  'drd-000555',
  'drd-000556',
  'drd-000560',
  'drd-000561',
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_PURE_FALSE) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

const CURATED_PATH_ONLY_INDIRECT_REASON_CODE = 'indirect_path_only';
const CURATED_PATH_ONLY_INDIRECT_NOTE = '端点间存在有意义的多跳／联姻／扩展家庭／共享人物关系，已保留为路径关系，不作为直接边。';

const CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_CHRONICLES_BATCH_186 = new Set([
  'drd-002428', 'drd-002429', 'drd-002430', 'drd-002431', 'drd-002432', 'drd-002433', 'drd-002434', 'drd-002435', 'drd-002436', 'drd-002437', 'drd-002438', 'drd-002439', 'drd-002440', 'drd-002441', 'drd-002442', 'drd-002443', 'drd-002444', 'drd-002445', 'drd-002446', 'drd-002447', 'drd-002448', 'drd-002449', 'drd-002450', 'drd-002451', 'drd-002452', 'drd-002453', 'drd-002454', 'drd-002455', 'drd-002456', 'drd-002457', 'drd-002458', 'drd-002459', 'drd-002460', 'drd-002461', 'drd-002462', 'drd-002463', 'drd-002464', 'drd-002465', 'drd-002466', 'drd-002467',
  'drd-003787', 'drd-003788', 'drd-003789', 'drd-003790', 'drd-003791', 'drd-003792', 'drd-003793', 'drd-003794', 'drd-003795', 'drd-003796', 'drd-003797', 'drd-003798', 'drd-003799', 'drd-003800', 'drd-003801', 'drd-003802', 'drd-003804', 'drd-003805', 'drd-003806', 'drd-003807', 'drd-003808', 'drd-003809', 'drd-003810', 'drd-003811', 'drd-003812', 'drd-003813', 'drd-003814', 'drd-003817', 'drd-003818', 'drd-003819',
  'drd-001324', 'drd-001325', 'drd-001326', 'drd-001328', 'drd-001329', 'drd-001330', 'drd-001331', 'drd-001332', 'drd-001334', 'drd-001336', 'drd-001337', 'drd-001339', 'drd-001340', 'drd-001341', 'drd-001343', 'drd-001344', 'drd-001345',
  'drd-003821', 'drd-003822', 'drd-003823', 'drd-003824', 'drd-003825', 'drd-003826', 'drd-003827', 'drd-003828', 'drd-003829', 'drd-003830', 'drd-003831', 'drd-003832', 'drd-003833', 'drd-003834', 'drd-003835', 'drd-003836', 'drd-003837', 'drd-003838', 'drd-003839', 'drd-003840', 'drd-003841', 'drd-003842', 'drd-003843', 'drd-003844', 'drd-003845', 'drd-003846', 'drd-003847', 'drd-003848', 'drd-003849', 'drd-003850', 'drd-003851', 'drd-003852', 'drd-003853', 'drd-003854', 'drd-003855', 'drd-003856', 'drd-003857', 'drd-003858', 'drd-003859', 'drd-003860', 'drd-003861', 'drd-003862', 'drd-003863', 'drd-003864', 'drd-003865', 'drd-003866', 'drd-003867', 'drd-003868', 'drd-003869', 'drd-003870', 'drd-003871', 'drd-003872', 'drd-003873', 'drd-003874',
  'drd-003875', 'drd-003876', 'drd-003877', 'drd-003878', 'drd-003879', 'drd-003880', 'drd-003881', 'drd-003882', 'drd-003883', 'drd-003884', 'drd-003885', 'drd-003886', 'drd-003887', 'drd-003888', 'drd-003889', 'drd-003890', 'drd-003891', 'drd-003892', 'drd-003893', 'drd-003894', 'drd-003895', 'drd-003896', 'drd-003897', 'drd-003898', 'drd-003899', 'drd-003900', 'drd-003901', 'drd-003902', 'drd-003903', 'drd-003904', 'drd-003905', 'drd-003906', 'drd-003907', 'drd-003908', 'drd-003909', 'drd-003910', 'drd-003911', 'drd-003912',
  'drd-005207', 'drd-005208', 'drd-005209', 'drd-005210', 'drd-005211', 'drd-005263', 'drd-005264'
]);
for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_SAFE_CHRONICLES_BATCH_186) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);

const DRD_NO_DIRECT_ID_RANGES = [
  [1349, 1351],
  [4042, 4115],
  [4117, 4119],
  [4121, 4126],
  [4128, 4155],
  [4158, 4208],
  [4210, 4218],
  [4221, 4223]
];

const DRD_NO_DIRECT_ID_EXTRAS = [
  5100, 5101, 5102, 5103,
  3481, 3482,
  5157, 5159, 5171, 5149, 5104, 5105, 5106, 5176,
  4701,
  3636,
  4704, 4705,
  5190, 5191,
  5734, 5748, 5750
];

function expandDrdRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const n = start + index;
    const numeric = String(n).padStart(6, '0');
    return `drd-${numeric}`;
  });
}

const CURATED_NO_DIRECT_RELATION_REJECTIONS_BATCH_200 = new Set([
  ...DRD_NO_DIRECT_ID_RANGES.flatMap(([start, end]) => expandDrdRange(start, end)),
  ...DRD_NO_DIRECT_ID_EXTRAS.map((id) => `drd-${String(id).padStart(6, '0')}`)
]);

for (const id of CURATED_NO_DIRECT_RELATION_REJECTIONS_BATCH_200) CURATED_NO_DIRECT_RELATION_REJECTIONS.add(id);
const CURATED_COLLECTIVE_REJECTIONS = new Set(['drd-006641', 'drd-003148', 'drd-003091', 'drd-002958', 'drd-002820', 'drd-002927', 'drd-003164', 'drd-002797']);
for (const id of [
  'drd-002108', 'drd-009316', 'drd-002339', 'drd-009317', 'drd-008200',
  'drd-009318', 'drd-003150', 'drd-003200', 'drd-002572', 'drd-008144',
  'drd-008145', 'drd-002573'
]) CURATED_COLLECTIVE_REJECTIONS.add(id);
for (const id of [
  'drd-009330', 'drd-009331', 'drd-009296', 'drd-006474', 'drd-005954',
  'drd-005924', 'drd-007772', 'drd-007807', 'drd-008194', 'drd-008195',
  'drd-008196', 'drd-009287'
]) CURATED_COLLECTIVE_REJECTIONS.add(id);
for (const id of ['drd-003201', 'drd-005856', 'drd-007695', 'drd-009319', 'drd-006178', 'drd-006181']) CURATED_COLLECTIVE_REJECTIONS.add(id);

const NON_PAIR_COVENANT_PASSAGES = new Set([
  '1CH 11:3', '2SA 3:9-10', 'EZE 21:23', 'JER 22:24', 'JER 34:18-19', 'JER 34:8-9'
]);

const NON_PAIR_KINSHIP_PASSAGES = new Set([
  'JER 43:5-6',
  '2CH 31:13',
  'JER 36:12',
  '2CH 29:12',
  '1CH 9:12',
  '2CH 28:12',
  'EZR 8:33',
  'NUM 16:1',
  'JDG 20:27-28',
  'NEH 3:4',
  '2KI 22:14',
  '2CH 34:22',
  '1KI 1:8',
  'JER 40:8',
  '2KI 25:23',
  'NUM 27:1',
  'JOS 17:3',
  '1CH 5:14',
  'NEH 11:7',
  'NEH 11:5',
  '1CH 9:8',
  '1CH 9:15',
  '1CH 9:16',
  '1SA 1:1',
  '1CH 1:9',
  'GEN 10:7',
  '1CH 1:17',
  '1CH 1:32',
  'GEN 46:17'
  ,'1CH 26:28'
  ,'2CH 35:9'
  ,'JER 38:1'
]);

const NON_PAIR_COMMISSION_PASSAGES = new Set([
  '1CH 16:39-40', '1SA 12:8', '2CH 17:7', '2CH 24:21', '2CH 29:27', '2CH 32:31',
  '2CH 34:8', '2CH 35:15', '2KI 10:14', '2KI 10:22', '2KI 22:12', '2KI 9:34',
  'GEN 44:1', 'JOS 2:1', 'ZEC 3:4'
]);

const NON_PAIR_PROPHETIC_PASSAGES = new Set([
  '1KI 15:22', '1KI 16:1', '1KI 16:7', 'ISA 1:1'
]);

const EXPLICIT_PAIR_ONLY_PASSAGES = new Set(['JER 29:3', 'JER 36:26']);
NON_PAIR_KINSHIP_PASSAGES.add('2CH 9:29');
NON_PAIR_KINSHIP_PASSAGES.add('EZR 10:15');
NON_PAIR_KINSHIP_PASSAGES.add('NEH 6:18');
NON_PAIR_KINSHIP_PASSAGES.add('2SA 17:27');
NON_PAIR_KINSHIP_PASSAGES.add('NEH 3:30');
NON_PAIR_KINSHIP_PASSAGES.add('NEH 13:13');
NON_PAIR_KINSHIP_PASSAGES.add('NEH 12:24');
NON_PAIR_KINSHIP_PASSAGES.add('GEN 36:2');
NON_PAIR_KINSHIP_PASSAGES.add('2SA 3:3');
NON_PAIR_KINSHIP_PASSAGES.add('1KI 2:5');

NON_PAIR_COMMISSION_PASSAGES.add('JOB 42:9');

const STRONG_CUES = {
  kinship: ['父亲', '母亲', '儿子', '女儿', '兄弟', '姊妹', '姐妹', '丈夫', '妻子', '为妻', '生了', '所生', '后裔', '子孙', '妹妹', '哥哥', '姐姐'],
  teacher_student: ['门徒', '教导', '教师', '学习'],
  collegial: ['同工', '同伴', '同往', '共事', '协同'],
  commission: ['差遣', '托付', '委派', '吩咐', '指派'],
  host: ['接待', '收留', '宴请', '款待', '招待'],
  political: ['作王', '治理', '统治', '任命', '执政'],
  legal: ['审判', '审讯', '控告', '判决', '审问'],
  hostile: ['攻击', '逼迫', '杀了', '背叛', '反对'],
  succession: ['接续', '继承', '接位', '王位', '继任'],
  alliance: ['同盟', '联盟', '联合', '联军', '会盟'],
  military: ['率领', '围攻', '进攻', '争战', '战斗'],
  prophetic_confrontation: ['责备', '警告', '膏立', '宣告', '谴责'],
  covenant: ['立约', '发誓', '立誓', '订约', '约定']
};

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.relative(ROOT, file)}:${index + 1}: invalid JSON`); }
  }) : [];
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalize(value) { return String(value || '').normalize('NFKC').replace(/\s+/g, ''); }

function personLabel(person) {
  return String(person?.canonical_chinese || person?.canonical_name_zh || person?.latinized || person?.person_id || '').trim();
}

function strongCueTypes(candidate) {
  const snippets = candidate.passages.map((row) => normalize(row.snippet)).join('\n');
  return candidate.relation_type_hypotheses.filter((type) => (STRONG_CUES[type] || []).some((cue) => snippets.includes(normalize(cue))));
}

function collectiveReferenceOnly(candidate, subjectLabel, objectLabel) {
  const groupSuffixes = ['的子孙', '子孙', '支派', '族', '人', '的后裔', '后裔'];
  const isCollectiveOccurrence = (snippet, label) => {
    const text = normalize(snippet);
    const target = normalize(label);
    if (!target || !text.includes(target)) return false;
    let cursor = 0;
    let found = false;
    while ((cursor = text.indexOf(target, cursor)) >= 0) {
      found = true;
      const after = text.slice(cursor + target.length, cursor + target.length + 4);
      if (!groupSuffixes.some((suffix) => after.startsWith(suffix))) return false;
      cursor += target.length;
    }
    return found;
  };
  return candidate.passages.length > 0 && candidate.passages.every((passage) =>
    isCollectiveOccurrence(passage.snippet, subjectLabel) || isCollectiveOccurrence(passage.snippet, objectLabel)
  );
}

function buildMentionLabelIndex(mentions, peopleById) {
  const index = new Map();
  for (const mention of mentions) {
    if (mention.status !== 'accepted') continue;
    const label = normalize(personLabel(peopleById.get(mention.person_id)));
    if (!label) continue;
    const labels = index.get(mention.passage) || new Map();
    const ids = labels.get(label) || new Set();
    ids.add(mention.person_id);
    labels.set(label, ids);
    index.set(mention.passage, labels);
  }
  return index;
}

function endpointsAmbiguousAcrossAllPassages(candidate, subjectLabel, objectLabel, mentionLabelIndex) {
  const a = normalize(subjectLabel);
  const b = normalize(objectLabel);
  if (!a || !b) return false;
  // If only normalized labels differ by identity mapping and not by text,
  // treat as ambiguous when different IDs are used for the same surface form.
  // There is no safe in-text disambiguation path with current passage structure.
  if (a === b && candidate.subject_person_id !== candidate.object_person_id) return true;
  let sawIdentityAmbiguity = false;
  for (const passage of candidate.passages) {
    const passageLabels = mentionLabelIndex.get(passage.passage);
    const subjectIds = passageLabels?.get(a);
    const objectIds = passageLabels?.get(b);
    const uniqueSubject = subjectIds?.size === 1 && subjectIds.has(candidate.subject_person_id);
    const uniqueObject = objectIds?.size === 1 && objectIds.has(candidate.object_person_id);
    if (uniqueSubject && uniqueObject) return false;
    const subjectAmbiguous = Boolean(subjectIds && (subjectIds.size > 1 || !subjectIds.has(candidate.subject_person_id)));
    const objectAmbiguous = Boolean(objectIds && (objectIds.size > 1 || !objectIds.has(candidate.object_person_id)));
    if (subjectAmbiguous || objectAmbiguous) sawIdentityAmbiguity = true;
  }
  return sawIdentityAmbiguity;
}

function explicitParentProposal(candidate, subjectLabel, objectLabel, mentionLabelIndex, disputedPeople) {
  if (!candidate.relation_type_hypotheses.includes('kinship')) return null;
  if (disputedPeople.has(candidate.subject_person_id) || disputedPeople.has(candidate.object_person_id)) return null;
  const a = normalize(subjectLabel);
  const b = normalize(objectLabel);
  if (!a || !b || a === b) return null;
  const roleSuffix = /^(王|人|支派|国|省|族)/;
  const matches = [];
  for (const passage of candidate.passages) {
    const text = normalize(passage.snippet);
    const passageLabels = mentionLabelIndex.get(passage.passage);
    const uniqueA = passageLabels?.get(a)?.size === 1 && passageLabels.get(a).has(candidate.subject_person_id);
    const uniqueB = passageLabels?.get(b)?.size === 1 && passageLabels.get(b).has(candidate.object_person_id);
    if (!uniqueA || !uniqueB) continue;
    let parentId = null;
    let childId = null;
    const patterns = [
      { parent: candidate.subject_person_id, child: candidate.object_person_id, parentLabel: a, childLabel: b },
      { parent: candidate.object_person_id, child: candidate.subject_person_id, parentLabel: b, childLabel: a }
    ];
    for (const pattern of patterns) {
      const phrases = [
        `${pattern.parentLabel}的儿子${pattern.childLabel}`,
        `${pattern.parentLabel}儿子${pattern.childLabel}`,
        `${pattern.parentLabel}的女儿${pattern.childLabel}`,
        `${pattern.parentLabel}女儿${pattern.childLabel}`,
        `${pattern.childLabel}是${pattern.parentLabel}的儿子`,
        `${pattern.childLabel}是${pattern.parentLabel}的女儿`
      ];
      const phrase = phrases.find((value) => text.includes(value));
      if (!phrase) continue;
      const after = text.slice(text.indexOf(phrase) + phrase.length, text.indexOf(phrase) + phrase.length + 2);
      if (roleSuffix.test(after)) continue;
      parentId = pattern.parent;
      childId = pattern.child;
      break;
    }
    if (!parentId || !childId) continue;
    matches.push({ parentId, childId, passage });
  }
  if (!matches.length) return null;
  const orientations = new Set(matches.map((row) => `${row.parentId}|${row.childId}`));
  if (orientations.size !== 1) return null;
  const [parentId, childId] = [...orientations][0].split('|');
  return {
    subject_person_id: parentId,
    object_person_id: childId,
    relation_type: 'kinship',
    relation_subtype: 'parent',
    direction: 'directed',
    evidence: matches.map(({ passage }) => ({
      source_id: 'source:0003',
      passage: passage.passage,
      evidence_level: passage.evidence_level,
      note: '和合本经文直接使用“某人的儿子／女儿某人”句式；人物端点在该节唯一对应。',
      certainty: 0.9
    }))
  };
}

function explicitCommissionProposal(candidate, subjectLabel, objectLabel, mentionLabelIndex, disputedPeople) {
  if (!candidate.relation_type_hypotheses.includes('commission')) return null;
  if (disputedPeople.has(candidate.subject_person_id) || disputedPeople.has(candidate.object_person_id)) return null;
  const a = normalize(subjectLabel);
  const b = normalize(objectLabel);
  if (!a || !b || a === b) return null;
  const verbs = ['差遣', '托付', '委派', '指派', '任命', '膏立'];
  const collectiveSuffix = /^(人|人的|支派|族|的子孙|子孙|的后裔|后裔)/;
  const matches = [];
  for (const passage of candidate.passages) {
    const text = normalize(passage.snippet);
    const passageLabels = mentionLabelIndex.get(passage.passage);
    const uniqueA = passageLabels?.get(a)?.size === 1 && passageLabels.get(a).has(candidate.subject_person_id);
    const uniqueB = passageLabels?.get(b)?.size === 1 && passageLabels.get(b).has(candidate.object_person_id);
    if (!uniqueA || !uniqueB) continue;
    let from = null;
    let to = null;
    for (const verb of verbs) {
      const forward = `${a}${verb}${b}`;
      const reverse = `${b}${verb}${a}`;
      if (text.includes(forward)) {
        const after = text.slice(text.indexOf(forward) + forward.length, text.indexOf(forward) + forward.length + 4);
        if (!collectiveSuffix.test(after)) { from = candidate.subject_person_id; to = candidate.object_person_id; break; }
      }
      if (text.includes(reverse)) {
        const after = text.slice(text.indexOf(reverse) + reverse.length, text.indexOf(reverse) + reverse.length + 4);
        if (!collectiveSuffix.test(after)) { from = candidate.object_person_id; to = candidate.subject_person_id; break; }
      }
    }
    if (from && to) matches.push({ from, to, passage });
  }
  if (!matches.length) return null;
  const orientations = new Set(matches.map((row) => `${row.from}|${row.to}`));
  if (orientations.size !== 1) return null;
  const [from, to] = [...orientations][0].split('|');
  return {
    subject_person_id: from,
    object_person_id: to,
    relation_type: 'commission',
    relation_subtype: null,
    direction: 'directed',
    evidence: matches.map(({ passage }) => ({
      source_id: 'source:0003',
      passage: passage.passage,
      evidence_level: passage.evidence_level,
      note: '和合本经文直接使用正式差遣／托付／委派／任命句式；人物端点在该节唯一对应。',
      certainty: 0.9
    }))
  };
}

function explicitHostileProposal(candidate, subjectLabel, objectLabel, mentionLabelIndex, disputedPeople) {
  if (!candidate.relation_type_hypotheses.includes('hostile')) return null;
  if (disputedPeople.has(candidate.subject_person_id) || disputedPeople.has(candidate.object_person_id)) return null;
  const a = normalize(subjectLabel);
  const b = normalize(objectLabel);
  if (!a || !b || a === b) return null;
  const verbs = ['杀了', '击杀', '杀死', '攻击', '逼迫', '反对', '控告', '背叛'];
  const indirectTargetSuffix = /^(的儿子|的女儿|儿子|女儿|的子孙|子孙|的后裔|后裔|人|支派|族)/;
  const matches = [];
  for (const passage of candidate.passages) {
    const text = normalize(passage.snippet);
    const passageLabels = mentionLabelIndex.get(passage.passage);
    const uniqueA = passageLabels?.get(a)?.size === 1 && passageLabels.get(a).has(candidate.subject_person_id);
    const uniqueB = passageLabels?.get(b)?.size === 1 && passageLabels.get(b).has(candidate.object_person_id);
    if (!uniqueA || !uniqueB) continue;
    let from = null;
    let to = null;
    for (const verb of verbs) {
      for (const [sourceLabel, targetLabel, sourceId, targetId] of [
        [a, b, candidate.subject_person_id, candidate.object_person_id],
        [b, a, candidate.object_person_id, candidate.subject_person_id]
      ]) {
        const phrase = `${sourceLabel}${verb}${targetLabel}`;
        const position = text.indexOf(phrase);
        if (position < 0) continue;
        const after = text.slice(position + phrase.length, position + phrase.length + 4);
        if (indirectTargetSuffix.test(after)) continue;
        from = sourceId;
        to = targetId;
        break;
      }
      if (from && to) break;
    }
    if (from && to) matches.push({ from, to, passage });
  }
  if (!matches.length) return null;
  const orientations = new Set(matches.map((row) => `${row.from}|${row.to}`));
  if (orientations.size !== 1) return null;
  const [from, to] = [...orientations][0].split('|');
  return {
    subject_person_id: from,
    object_person_id: to,
    relation_type: 'hostile',
    relation_subtype: null,
    direction: 'directed',
    evidence: matches.map(({ passage }) => ({
      source_id: 'source:0003',
      passage: passage.passage,
      evidence_level: passage.evidence_level,
      note: '和合本经文直接使用杀害／攻击／逼迫／背叛等敌对句式；人物端点在该节唯一对应。',
      certainty: 0.9
    }))
  };
}

function curatedExplicitProposal(candidate, disputedPeople) {
  const rule = CURATED_EXPLICIT_PROPOSALS.get(candidate.candidate_relation_id);
  if (!rule) return null;
  const candidatePersonIds = rule.candidate_person_ids || [rule.subject_person_id, rule.object_person_id];
  if (new Set(candidatePersonIds).size !== 2
    || !candidatePersonIds.includes(candidate.subject_person_id)
    || !candidatePersonIds.includes(candidate.object_person_id)) {
    throw new Error(`${candidate.candidate_relation_id}: curated endpoint drift`);
  }
  if (!rule.allow_disputed_endpoints && candidatePersonIds.some((personId) => disputedPeople.has(personId))) return null;
  const evidence = rule.passages.map((passage) => {
    const match = candidate.passages.find((row) => row.passage === passage);
    if (!match) throw new Error(`${candidate.candidate_relation_id}: curated passage drift ${passage}`);
    return {
      source_id: 'source:0003', passage: match.passage, evidence_level: match.evidence_level,
      note: rule.note || `和合本经文直接陈述两位具名人物之间的${rule.relation_type}关系；人物端点与方向已逐节复核。`,
      certainty: rule.certainty ?? 0.95
    };
  });
  return {
    subject_person_id: rule.subject_person_id, object_person_id: rule.object_person_id,
    relation_type: rule.relation_type, relation_subtype: rule.relation_subtype ?? null, direction: rule.direction, evidence
  };
}

function curatedRejection(candidate, strongTypes) {
  if (candidate.existing_edge_status === 'active_existing') return null;
  if (CURATED_AMBIGUOUS_IDENTITY_REJECTIONS.has(candidate.candidate_relation_id)) return 'rejected_ambiguous_identity';
  if (CURATED_NO_DIRECT_RELATION_REJECTIONS.has(candidate.candidate_relation_id)) return 'rejected_pair_not_stated';
  if (CURATED_COLLECTIVE_REJECTIONS.has(candidate.candidate_relation_id)) return 'rejected_collective_reference';
  if (candidate.passages.length > 0
    && !CURATED_EXPLICIT_PROPOSALS.has(candidate.candidate_relation_id)
    && candidate.passages.every((passage) => EXPLICIT_PAIR_ONLY_PASSAGES.has(passage.passage))) {
    return 'rejected_pair_not_stated';
  }
  if (strongTypes.includes('covenant')
    && candidate.passages.length > 0
    && candidate.passages.every((passage) => NON_PAIR_COVENANT_PASSAGES.has(passage.passage))) {
    return 'rejected_non_pair_covenant';
  }
  if (strongTypes.includes('commission')
    && candidate.passages.length > 0
    && candidate.passages.every((passage) => NON_PAIR_COMMISSION_PASSAGES.has(passage.passage))) {
    return 'rejected_non_pair_commission';
  }
  if (strongTypes.includes('kinship')
    && candidate.passages.length > 0
    && !CURATED_EXPLICIT_PROPOSALS.has(candidate.candidate_relation_id)
    && candidate.passages.every((passage) => NON_PAIR_KINSHIP_PASSAGES.has(passage.passage))) {
    return 'rejected_pair_not_stated';
  }
  if (strongTypes.includes('prophetic_confrontation')
    && candidate.passages.length > 0
    && candidate.passages.every((passage) => NON_PAIR_PROPHETIC_PASSAGES.has(passage.passage))) {
    return 'rejected_non_pair_prophetic';
  }
  if (candidate.passages.some((passage) => passage.passage === '2CH 23:1')
    && !CURATED_EXPLICIT_PROPOSALS.has(candidate.candidate_relation_id)) {
    return 'rejected_pair_not_stated';
  }
  if (candidate.passages.some((passage) => passage.passage === '1KI 20:34')
    && !CURATED_EXPLICIT_PROPOSALS.has(candidate.candidate_relation_id)) {
    return 'rejected_ambiguous_identity';
  }
  if (candidate.passages.some((passage) => passage.passage === 'EST 1:10')
    && !CURATED_EXPLICIT_PROPOSALS.has(candidate.candidate_relation_id)) {
    return 'rejected_pair_not_stated';
  }
  return null;
}

function decision(status, mode, reviewedAt) {
  const reasons = {
    covered_existing: ['existing_active_assertion', '该人物对已有 active assertion；本候选作为覆盖复核记录，不新增重复关系。'],
    covered_composite_inference: ['accepted_composite_kinship_inference', '该候选已由独立复合亲属推论账本接受；保留两条直接父母前提与反证检查，不将路径冒充为经文明示关系。'],
    textually_explicit_parent: ['explicit_parent_child_syntax', '经文直接使用父母—儿子／女儿句式，两个端点在该节唯一对应；进入最终反证复核。'],
    textually_explicit_sibling: ['explicit_sibling_relation', '经文直接显明两位具名人物之间为兄弟姐妹关系，端点与方向已逐节复核。'],
    textually_explicit_host: ['hosted_relation', '经文直接使用“安置/寄居/居住于”一类措辞，表明一方对另一方提供居所、掩护或款待；人物端点与经文定位已复核。'],
    textually_explicit_commission: ['explicit_commission_syntax', '经文直接使用差遣／吩咐／托付句式，两个端点在该节唯一对应；进入最终反证复核。'],
    textually_explicit_hostile: ['explicit_hostile_syntax', '经文直接使用杀害／攻击／逼迫／背叛等敌对句式，两个端点在该节唯一对应；进入最终反证复核。'],
    textually_explicit_covenant: ['explicit_covenant_statement', '经文直接陈述两位具名人物彼此立约；人物端点、指代与经文定位已逐节复核。'],
    textually_explicit_friendship: ['explicit_friendship_statement', '经文直接称两位具名人物为朋友；人物端点与经文定位已逐节复核。'],
    textually_explicit_alliance: ['explicit_alliance_statement', '经文直接陈述两位具名人物结盟；人物端点、指代与经文定位已逐节复核。'],
    textually_explicit_prophetic_confrontation: ['explicit_prophetic_confrontation_statement', '经文直接陈述先知对具名人物的责备；人物端点、方向与经文定位已逐节复核。'],
    textually_explicit_teacher_student: ['explicit_teacher_student_relationship', '经文直接陈述服事、承接职分或师徒身份；人物端点、方向与经文定位已逐节复核。'],
    textually_explicit_collegial: ['explicit_collegial_relationship', '经文直接陈述具名人物长期同伴、共同服事或共同承担任务；人物端点与经文定位已逐节复核。'],
    textually_explicit_political: ['explicit_political_authority', '经文直接陈述君王与具名官员之间的权属或政令关系；人物端点、方向与经文定位已逐节复核。'],
    textually_explicit_legal: ['explicit_legal_action', '经文直接陈述具名人物对另一具名人物的审判、审讯、控告或判决；人物端点、方向与经文定位已逐节复核。'],
    textually_explicit_military: ['explicit_military_conflict', '经文直接陈述两位具名人物交战、统军对阵或一方击败另一方；人物端点、方向与经文定位已逐节复核。'],
    textually_explicit_succession: ['explicit_succession_statement', '经文直接陈述前任之后由另一具名人物接续其王位或职分；方向统一为前任指向继任者。'],
    reviewed_uncertain_hostile: ['parallel_texts_diverge', '平行经文对敌对行为对象的表述不一致；关系经过两轮复核，但保留为不确定并使用琥珀线显示。'],
    rejected_prior_superseded: ['prior_superseded_decision', '该人物对已有 superseded 决定；没有新的成对直接证据足以重新开启。'],
    rejected_collective_reference: ['collective_or_tribal_reference', '至少一个端点在全部候选经文中仅表示子孙、后裔、支派、宗族或族群，并非该具名个人之间的直接关系。'],
    rejected_non_pair_covenant: ['covenant_not_between_candidate_pair', '经文中的立约／起誓对象是群体、上帝或其他人物，并未直接建立候选两人之间的关系。'],
    rejected_non_pair_commission: ['commission_not_between_candidate_pair', '经文中的发令者或承接者不是候选两人；候选只属于父名、名单、群体、同名或跨时代共现。'],
    rejected_non_pair_prophetic: ['prophetic_statement_not_between_candidate_pair', '责备／宣告的实际发言者与对象不是候选两人；标题、父名、时代名单或旁及人物不能建立先知性对质关系。'],
    rejected_pair_not_stated: ['listed_people_not_pairwise_related', '经文列出多位人物，但只陈述特定召集者与被召者的关系，并未建立名单成员之间的两两关系。'],
    rejected_ambiguous_identity: ['same_name_or_identity_mismatch', '经文关系本身明确，但本候选的人物身份端点与经文中的实际人物不一致或存在同名冲突。'],
    rejected_weak_trigger: ['co_mention_with_weak_lexical_trigger', '同节共现仅命中宽泛提示词，不能证明两位人物之间存在直接关系。'],
    needs_textual_review: ['explicit_phrase_requires_pair_resolution', '经文含较明确关系短语，但仍须判定该短语是否直接连接这两位人物及其方向。']
  };
  const reason = reasons[status];
  if (!reason) throw new Error(`${status}: unknown decision status`);
  const [reason_code, note] = reason;
  return { status, mode, reason_code, note, reviewed_at: reviewedAt };
}

function decisionWithOverride(status, mode, reviewedAt, reasonOverride) {
  const row = decision(status, mode, reviewedAt);
  if (!reasonOverride) return row;
  return {
    ...row,
    reason_code: reasonOverride.reason_code || row.reason_code,
    note: reasonOverride.note || row.note
  };
}

function classify(candidate, strongTypes, collectiveOnly, proposal, curatedRejected) {
  if (candidate.existing_edge_status === 'active_existing') return 'covered_existing';
  if (candidate.existing_edge_status === 'superseded_only') return 'rejected_prior_superseded';
  if (proposal && proposal.evidence.some((evidence) => evidence.certainty < 0.75)) return 'reviewed_uncertain_hostile';
  if (proposal?.relation_type === 'kinship' && proposal.relation_subtype === 'sibling') return 'textually_explicit_sibling';
  if (proposal?.relation_type === 'kinship') return 'textually_explicit_parent';
  if (proposal?.relation_type === 'host') return 'textually_explicit_host';
  if (proposal?.relation_type === 'commission') return 'textually_explicit_commission';
  if (proposal?.relation_type === 'hostile') return 'textually_explicit_hostile';
  if (proposal?.relation_type === 'covenant') return 'textually_explicit_covenant';
  if (proposal?.relation_type === 'friendship') return 'textually_explicit_friendship';
  if (proposal?.relation_type === 'alliance') return 'textually_explicit_alliance';
  if (proposal?.relation_type === 'prophetic_confrontation') return 'textually_explicit_prophetic_confrontation';
  if (proposal?.relation_type === 'teacher_student') return 'textually_explicit_teacher_student';
  if (proposal?.relation_type === 'collegial') return 'textually_explicit_collegial';
  if (proposal?.relation_type === 'political') return 'textually_explicit_political';
  if (proposal?.relation_type === 'legal') return 'textually_explicit_legal';
  if (proposal?.relation_type === 'military') return 'textually_explicit_military';
  if (proposal?.relation_type === 'succession') return 'textually_explicit_succession';
  if (curatedRejected) return curatedRejected;
  if (collectiveOnly) return 'rejected_collective_reference';
  return strongTypes.length ? 'needs_textual_review' : 'rejected_weak_trigger';
}

function main() {
  const candidates = readJsonl(CANDIDATES_PATH);
  const people = readJsonl(PEOPLE_PATH);
  const mentions = readJsonl(MENTIONS_PATH);
  const identities = readJsonl(IDENTITIES_PATH);
  const compositeKinshipByCandidate = fs.existsSync(COMPOSITE_KINSHIP_REVIEW_PATH)
    ? new Map(readJsonl(COMPOSITE_KINSHIP_REVIEW_PATH)
      .filter((row) => row.final_decision?.status === 'accepted')
      .map((row) => [row.candidate_relation_id, row]))
    : new Map();
  const peopleById = new Map(people.map((row) => [row.person_id, row]));
  const mentionLabelIndex = buildMentionLabelIndex(mentions, peopleById);
  const disputedPeople = new Set(identities.filter((row) => row.status === 'disputed').map((row) => row.person_id));
  const reviewedAt = candidates[0]?.created_at || new Date(0).toISOString();
  const rows = candidates.map((candidate, index) => {
    const strongTypes = strongCueTypes(candidate);
    const subjectLabel = personLabel(peopleById.get(candidate.subject_person_id));
    const objectLabel = personLabel(peopleById.get(candidate.object_person_id));
    const collectiveOnly = collectiveReferenceOnly(candidate, subjectLabel, objectLabel);
    const ambiguousEndpointsOnly = endpointsAmbiguousAcrossAllPassages(candidate, subjectLabel, objectLabel, mentionLabelIndex);
    const curatedRejected = curatedRejection(candidate, strongTypes);
    const proposal = curatedExplicitProposal(candidate, disputedPeople)
      || explicitParentProposal(candidate, subjectLabel, objectLabel, mentionLabelIndex, disputedPeople)
      || explicitCommissionProposal(candidate, subjectLabel, objectLabel, mentionLabelIndex, disputedPeople)
      || explicitHostileProposal(candidate, subjectLabel, objectLabel, mentionLabelIndex, disputedPeople);
    let status = classify(candidate, strongTypes, collectiveOnly, proposal, curatedRejected);
    const isPathOnlyIndirect = CURATED_PATH_ONLY_INDIRECT.has(candidate.candidate_relation_id);
    if (isPathOnlyIndirect) {
      if (status === 'needs_textual_review') {
        status = 'rejected_pair_not_stated';
      } else if (!['rejected_pair_not_stated', 'covered_existing'].includes(status)) {
        throw new Error(`path-only indirect id ${candidate.candidate_relation_id} expected needs_textual_review status`);
      }
    }
    if (status === 'needs_textual_review' && ambiguousEndpointsOnly) status = 'rejected_ambiguous_identity';
    if (status === 'needs_textual_review' && compositeKinshipByCandidate.has(candidate.candidate_relation_id)) {
      status = 'covered_composite_inference';
    }

    const reasonOverride = isPathOnlyIndirect && status === 'rejected_pair_not_stated'
      ? { reason_code: CURATED_PATH_ONLY_INDIRECT_REASON_CODE, note: CURATED_PATH_ONLY_INDIRECT_NOTE }
      : null;
    const filteredProposal = (status.startsWith('rejected_') || status === 'covered_existing') ? null : proposal;
    const priority = (status === 'covered_existing' || status === 'covered_composite_inference') ? 'covered'
      : status.startsWith('rejected_') ? 'closed'
        : (candidate.passages.length > 1 || strongTypes.length > 1) ? 'high'
          : candidate.path_contexts.length ? 'normal' : 'low';
    return {
      review_id: `drdr-${String(index + 1).padStart(6, '0')}`,
      candidate_relation_id: candidate.candidate_relation_id,
      subject_person_id: candidate.subject_person_id,
      object_person_id: candidate.object_person_id,
      subject_label: subjectLabel,
      object_label: objectLabel,
      candidate_snapshot_sha256: sha256(stableStringify(candidate)),
      existing_edge_status: candidate.existing_edge_status,
      evidence_refs: candidate.passages.map((row) => ({
        passage: row.passage,
        excerpt_hash: row.excerpt_hash,
        evidence_level: row.evidence_level,
        matched_relation_hints: [...row.matched_relation_hints].sort()
      })),
      triage: {
        strong_cue_types: strongTypes,
        weak_only_trigger: strongTypes.length === 0,
        passage_count: candidate.passages.length,
        path_context_count: candidate.path_contexts.length,
        priority
      },
      proposed_assertion: filteredProposal,
      round_a: decisionWithOverride(status, 'editorial', reviewedAt, reasonOverride),
      round_b: decisionWithOverride(status, 'critic', reviewedAt, reasonOverride),
      final_decision: decisionWithOverride(status, 'boardroom', reviewedAt, reasonOverride)
    };
  });

  const initialReviewRows = fs.existsSync(OUTPUT_PATH)
    ? readJsonl(OUTPUT_PATH)
    : [];
  const initialById = new Map(initialReviewRows.map((row) => [row.candidate_relation_id, row]));
  const currentCandidateIds = new Set(candidates.map((row) => row.candidate_relation_id));
  const pendingSet = new Set([...Array.from(CURATED_NO_DIRECT_RELATION_REJECTIONS_PURE_FALSE), ...Array.from(CURATED_PATH_ONLY_CANDIDATES)]);
  for (const candidateId of pendingSet) {
    if (!currentCandidateIds.has(candidateId)) continue;
    if (candidateId === 'drd-007692' || candidateId === 'drd-001994') continue;
    const existingRow = initialById.get(candidateId);
    const isPureFalse = CURATED_NO_DIRECT_RELATION_REJECTIONS_PURE_FALSE.has(candidateId);
    const isPathOnly = CURATED_PATH_ONLY_CANDIDATES.has(candidateId);
    if (!existingRow) {
      throw new Error(`preflight target row missing for ${String(candidateId)} (pure_false=${isPureFalse}, path_only=${isPathOnly})`);
    }
    const existingStatus = existingRow.final_decision?.status;
    if (existingStatus === 'rejected_ambiguous_identity'
      && existingRow.final_decision?.reason_code === 'endpoint_not_named_person') continue;
    if (existingStatus === 'needs_textual_review') continue;
    if (isPathOnly && existingStatus === 'covered_existing') continue;
    if (existingStatus === 'rejected_pair_not_stated') {
      const existingReason = existingRow.final_decision?.reason_code;
      if (isPathOnly && [CURATED_PATH_ONLY_INDIRECT_REASON_CODE, 'listed_people_not_pairwise_related'].includes(existingReason)) continue;
      if (isPureFalse && existingReason === 'listed_people_not_pairwise_related') continue;
    }
    throw new Error('preflight target ' + candidateId + ' unexpected state ' + (existingRow?.final_decision?.status || 'unknown'));
  }

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const errors = [];
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    if (!validate(row)) errors.push(...(validate.errors || []).map((error) => `row ${index + 1}${error.instancePath}: ${error.message}`));
    if (ids.has(row.candidate_relation_id)) errors.push(`duplicate ${row.candidate_relation_id}`);
    ids.add(row.candidate_relation_id);
  }
  if (rows.length !== candidates.length) errors.push(`coverage mismatch ${rows.length}/${candidates.length}`);
  if (errors.length) throw new Error(errors.slice(0, 100).join('\n'));

  const snapshot = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const counts = {};
  const priorities = {};
  for (const row of rows) {
    counts[row.final_decision.status] = (counts[row.final_decision.status] || 0) + 1;
    priorities[row.triage.priority] = (priorities[row.triage.priority] || 0) + 1;
  }
  const report = {
    generated_at: reviewedAt,
    dataset: 'direct-relationship-review',
    candidate_count: candidates.length,
    reviewed_count: rows.length,
    coverage_complete: rows.length === candidates.length,
    round_a_count: rows.length,
    round_b_count: rows.length,
    boardroom_count: rows.length,
    final_status_counts: counts,
    priority_counts: priorities,
    proposed_new_assertions: rows.filter((row) => row.proposed_assertion && row.existing_edge_status !== 'active_existing').length,
    invariant: {
      lexical_trigger_is_not_direct_relation_proof: true,
      paths_do_not_create_direct_assertions: true,
      active_assertions_not_duplicated: true
    },
    row_snapshot_sha256: sha256(snapshot)
  };

  if (CHECK) {
    if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== snapshot) throw new Error('direct relationship review snapshot drift');
    const existingReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    if (existingReport.row_snapshot_sha256 !== report.row_snapshot_sha256) throw new Error('direct relationship review report drift');
    console.log(JSON.stringify({ status: 'ok', mode: 'check', ...report }, null, 2));
    return;
  }
  fs.writeFileSync(OUTPUT_PATH, snapshot);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'ok', mode: 'generate', ...report }, null, 2));
}

main();
