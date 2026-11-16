// One- or two-sentence summary of a building, built only from City of Chicago
// records with a fixed template (no AI), e.g.
//   "An Italianate two- or three-flat built in the 1880s, designed by Lutken & Thisslew.
//    The City's Historic Resources Survey rated it Orange: potentially significant to its
//    surrounding community."

// CHRS building types -> natural phrases for use mid-sentence
const TYPE_PHRASES = {
  '2-3 Flat': 'two- or three-flat',
  'Bath House': 'bathhouse',
  Club: 'club building',
  Commercial: 'commercial building',
  'Commercial/Residential': 'mixed commercial and residential building',
  Courtyard: 'courtyard building',
  'Elevated Station': "'L' station",
  'Fieldhouse/Gym': 'fieldhouse',
  'Fire House': 'firehouse',
  'Gate House': 'gatehouse',
  'Governmental/Administrative': 'government building',
  Institutional: 'institutional building',
  'Institutional/Residential': 'institutional residence',
  Manufacturing: 'manufacturing building',
  Maritime: 'maritime structure',
  'Multi-Residential': 'apartment building',
  Office: 'office building',
  'Park Miscellaneous': 'park structure',
  Railroad: 'railroad structure',
  'Religious Miscellaneous': 'religious building',
  'Single Family Residence': 'single-family house',
  'Urban Furniture': 'street fixture',
  Utility: 'utility building',
};

const CHRS_PHRASES = {
  Red: 'potentially significant to Chicago, Illinois, or the nation',
  Orange: 'potentially significant to its surrounding community',
};

const typePhrase = (type) => (type ? TYPE_PHRASES[type] ?? type.toLowerCase() : null);

const article = (phrase) => (/^[aeiou]/i.test(phrase) ? 'An' : 'A');

function yearPhrase(year) {
  if (!year) return null;
  if (/^\d{4}s$/.test(year)) return `in the ${year}`; // 1880s
  return `in ${year}`; // 1925, 1873-94
}

/**
 * @param {object} b building from getNearby()
 * @param {object[]} styles effective styles ({ name }) for the building
 * @returns {string | null}
 */
export function summarize(b, styles = b.styles) {
  const sentences = [];

  const style = styles[0]?.name ?? null;
  const noun = typePhrase(b.type) ?? (style || b.yearBuilt || b.architect ? 'building' : null);
  if (noun) {
    const subject = [style, noun].filter(Boolean).join(' ');
    let s = `${article(subject)} ${subject}`;
    const when = yearPhrase(b.yearBuilt);
    if (when) s += ` ${noun.endsWith('building') ? 'constructed' : 'built'} ${when}`;
    if (b.architect) s += `, designed by ${b.architect}`;
    sentences.push(`${s.replace(/\.$/, '')}.`); // no double period after an initial
  }

  if (b.landmarkDate) sentences.push(`It was designated a Chicago Landmark in ${b.landmarkDate.slice(0, 4)}.`);
  if (b.nationalRegister === 'National Historic Landmark') sentences.push('It is a National Historic Landmark.');
  else if (b.nationalRegister) sentences.push('It is listed on the National Register of Historic Places.');
  if (b.chrsColor && CHRS_PHRASES[b.chrsColor]) {
    sentences.push(`The City's Historic Resources Survey rated it ${b.chrsColor}: ${CHRS_PHRASES[b.chrsColor]}.`);
  }

  return sentences.length ? sentences.join(' ') : null;
}
