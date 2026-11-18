// Headless check of makeKnight + syncGear with stubbed THREE/DOM.
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; } }
class Obj {
  constructor() { this.children = []; this.position = new V3(); this.rotation = new V3(); this.visible = true; }
  add(...os) { for (const o of os) { o.parent = this; this.children.push(o); } }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); }
  traverse(f) { f(this); for (const c of [...this.children]) if (c.traverse) c.traverse(f); }
  clone() { const m = new Mesh(this.geometry, this.material); m.position.set(this.position.x, this.position.y, this.position.z); return m; }
}
class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
class Mat { constructor(o) { Object.assign(this, o || {}); } }
class Lambert extends Mat { constructor(o) { super(o); this.isMeshLambertMaterial = true; } }
const Geo = class { constructor(...a) { this.args = a; } };
const THREE = {
  Group: class extends Obj {}, Mesh,
  MeshLambertMaterial: Lambert, MeshBasicMaterial: class extends Mat {},
  SphereGeometry: Geo, CylinderGeometry: Geo, ConeGeometry: Geo, TorusGeometry: Geo, BoxGeometry: Geo, CircleGeometry: Geo,
};
const documentStub = { createElement: () => ({ className: '', innerHTML: '', style: {}, querySelector: () => ({ style: {}, textContent: '' }), remove() {} }) };
const $stub = () => ({ appendChild() {}, style: {}, classList: { contains: () => true, toggle() {}, add() {}, remove() {} } });
const esc = (s) => String(s);
let catalog = {
  dragon_sword: { style: 'melee' }, magic_shortbow: { style: 'ranged' }, mystic_staff: { style: 'magic' },
  barrows_dragon_helm: { color: '#8e2f24' }, ahrims_staff: { style: 'magic' }, karils_crossbow: { style: 'ranged' },
};

// extract box() + shadowify() + the HERALDIC..syncGear region
function grab(startMarker, endMarker) {
  const i = html.indexOf(startMarker); if (i < 0) throw new Error('missing ' + startMarker);
  const j = html.indexOf(endMarker, i); if (j < 0) throw new Error('missing end ' + endMarker);
  return html.slice(i, j);
}
const code = [
  'const THREE = arguments[0], document = arguments[1], $ = arguments[2], esc = arguments[3];',
  'let catalog = arguments[4];',
  'const scene = null; const interactives = [];',
  grab('function box(', '/* box() with a ready material'),
  grab('function shadowify(', '/* Flickering brazier lights'),
  grab('const HERALDIC=', '/* ---- Stage 6: Tree Guardians'),
  'return { makeKnight, syncGear, gearColorFor, weaponShape };',
].join('\n');
const api = new Function(code)(THREE, documentStub, $stub, esc, catalog);
const { makeKnight, syncGear, gearColorFor, weaponShape } = api;

const count = (o) => { let n = 0; o.traverse((x) => { if (x.isMesh) n++; }); return n; };
const EMPTY = { head: null, body: null, legs: null, feet: null, weapon: null, shield: null, cape: null, hands: null, amulet: null };

// colour + shape resolution
if (gearColorFor('dragon_sword') !== 0xc22f2f) throw new Error('dragon colour wrong');
if (gearColorFor('smith_rune_sword_u2') !== 0x4a90d9) throw new Error('smith rune colour wrong');
if (gearColorFor('barrows_dragon_helm') !== 0x8e2f24) throw new Error('barrows catalog colour wrong');
if (weaponShape('magic_shortbow') !== 'bow' || weaponShape('mystic_staff') !== 'staff' || weaponShape('torags_hammers') !== 'hammers') throw new Error('weapon shape wrong');
console.log('PASS colour + weapon-shape resolution');

// bare knight (appearance chosen, like Derek's account)
const av = makeKnight(false, 'Tester', { skin: 1, hair: 1, beard: 2, gender: 'male', torso: 0, arms: 0, legs: 0, feet: 0, chosen: true });
syncGear(av, { username: 'Tester', worn: { ...EMPTY } });
if (count(av.gearAnchors.armR) !== 0) throw new Error('bare knight is holding something');
if (av.tabardMesh.visible !== true) throw new Error('bare knight tabard hidden');
if (!av.hairParts.every((h) => h.visible)) throw new Error('bare knight hair hidden');
console.log('PASS bare knight: empty hands, tabard + hair showing');

// fully geared knight
syncGear(av, { username: 'Tester', worn: { head: 'dragon_helm', body: 'dragon_platebody', legs: 'dragon_platelegs', feet: 'barrows_dragon_boots', weapon: 'dragon_sword', shield: 'dragon_shield', cape: 'fire_cape', hands: null, amulet: null } });
for (const k of ['head', 'body', 'legL', 'legR', 'footL', 'footR', 'armR', 'armL', 'cape']) {
  if (count(av.gearAnchors[k]) === 0) throw new Error('geared knight missing meshes on ' + k);
}
if (av.tabardMesh.visible !== false) throw new Error('platebody should hide the tabard');
if (!av.hairParts.every((h) => !h.visible)) throw new Error('helm should hide the hair');
console.log('PASS geared knight: every anchor dressed, tabard + hair covered');

// weapon shape swaps
syncGear(av, { username: 'Tester', worn: { ...EMPTY, weapon: 'magic_shortbow' } });
if (count(av.gearAnchors.armR) === 0 || count(av.gearAnchors.armL) !== 0) throw new Error('bow not in right hand only');
syncGear(av, { username: 'Tester', worn: { ...EMPTY, weapon: 'torags_hammers' } });
if (count(av.gearAnchors.armL) === 0) throw new Error('Torag offhand hammer missing');
syncGear(av, { username: 'Tester', worn: { ...EMPTY, weapon: 'ahrims_staff' } });
if (count(av.gearAnchors.armR) === 0) throw new Error('staff missing');
console.log('PASS weapon swaps: bow / twin hammers / staff');

// hood + skirt pieces, then back to bare
syncGear(av, { username: 'Tester', worn: { ...EMPTY, head: 'ahrims_hood', legs: 'guthans_chainskirt' } });
if (count(av.gearAnchors.head) === 0 || count(av.gearAnchors.body) === 0) throw new Error('hood/skirt missing');
if (count(av.gearAnchors.legL) !== 0) throw new Error('skirt should not add leg guards');
syncGear(av, { username: 'Tester', worn: { ...EMPTY } });
if (count(av.pivot) <= 0) throw new Error('knight vanished');
for (const k of Object.keys(av.gearAnchors)) if (count(av.gearAnchors[k]) !== 0) throw new Error('gear left behind on ' + k);
if (av.tabardMesh.visible !== true || !av.hairParts.every((h) => h.visible)) throw new Error('ungear did not restore the bare look');
console.log('PASS hood + chainskirt, and ungearing restores the bare look');

// classic (no-appearance) knight also builds + dresses
const av2 = makeKnight(true, 'Classic', null);
syncGear(av2, { username: 'Classic', worn: { ...EMPTY, weapon: 'steel_sword', head: 'steel_helm' } });
if (count(av2.gearAnchors.armR) === 0 || count(av2.gearAnchors.head) === 0) throw new Error('classic knight gear missing');
console.log('PASS classic knight builds and dresses');
console.log('ALL GEAR TESTS PASSED');
