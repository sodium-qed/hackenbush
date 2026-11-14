import { otherSide } from './rules.js';
import { cleanName } from './session.js';

const computerNames = ['Fern', 'Cedar'];

export function entrantName(value) {
  const name = cleanName(typeof value === 'string' ? value.normalize('NFC') : '');
  return name.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, '') ? name : '';
}

export function defaultNickname(index) {
  return computerNames[index === 1 ? 1 : 0];
}

function secureCoin() {
  return globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & 1;
}

/** The first coin chooses the opening entrant. A second chooses the opening
 * color in colored games. Tests may inject independent zero/one coin values. */
export function drawSeats(config = {}, variant = 'green', coin = secureCoin) {
  const linked = config.opponent === 'link';
  const entrants = [0, 1].map(index => {
    const input = config.entrants?.[index];
    const defaultKind = config.opponent === 'computer' && index === 1 ? 'computer' : 'human';
    const computer = !linked && (input?.kind ?? defaultKind) === 'computer';
    const kind = computer ? 'computer' : 'human';
    const fallback = kind === 'computer' ? defaultNickname(index) : 'Guest ' + (index ? 'B' : 'A');
    return { name: entrantName(input?.name) || fallback, kind };
  });

  const first = Number(coin()) >= 0.5 ? 1 : 0;
  const colored = variant === 'redblue';
  const firstSide = colored && Number(coin()) >= 0.5 ? 'red' : 'blue';
  const colors = first === 0 ? [firstSide, otherSide(firstSide)] : [otherSide(firstSide), firstSide];
  const players = { [colors[0]]: entrants[0], [colors[1]]: entrants[1] };
  const hasComputer = entrants.some(entrant => entrant.kind === 'computer');
  const opponent = linked ? 'link' : hasComputer ? 'computer' : 'local';
  let host = config.hostIndex === 1 ? 1 : 0;
  if (entrants[0].kind !== entrants[1].kind) host = entrants.findIndex(entrant => entrant.kind === 'human');
  return { players, firstSide, opponent, seat: colors[host] };
}
