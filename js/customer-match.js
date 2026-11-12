const stallAddress = /(?:第)?\d+排(?:第)?\d+号$/u;
const customerSeparators = /[\s,、;:·•/()\[\]【】.。—-]+/u;

function customerNameParts(name) {
  return String(name ?? '').normalize('NFKC').toLowerCase().split(customerSeparators).filter(Boolean);
}

function joinedCustomerName(parts) {
  // Keep numeric groups distinct: a stall such as 1-23 must not collapse into 12-3.
  return parts.reduce((key, part) => key + (/\d$/.test(key) && /^\d/.test(part) ? '-' : '') + part, '')
    .replace(/第?(\d+)排第?(\d+)号$/u, '$1排$2号');
}

function customerNameForms(parts) {
  const key = joinedCustomerName(parts);
  if (parts.length === 2 && parts.every(part => /\p{L}/u.test(part))) {
    return [key, joinedCustomerName([parts[1], parts[0]])];
  }
  return [key];
}

function customerNames(customer) {
  return [customer.name, ...(Array.isArray(customer.aliases) ? customer.aliases : [])].filter(Boolean);
}

function matchesCustomerForms(input, stored) {
  return stored.some(key => {
    if (input.includes(key)) return true;
    const withoutAddress = key.replace(stallAddress, '');
    return key !== withoutAddress && withoutAddress.length >= 2 && input.includes(withoutAddress);
  });
}

// A transport label can precede many different recipients. These are delivery
// terms, not customer mappings. Unknown place names are inferred from the roster.
const transportEnd = /(?:货拉拉|物流|货运|配送|专线|车队|班车|车)$/u;
const transportPrefix = /^(.+?(?:物流|货运|配送|专线|车队|班车|车)|货拉拉)(.+)$/u;
const bareService = /^(?:货拉拉|物流|货运|配送|专线|车队|班车|顺风车|送货车)$/u;
const localityEnd = /(?:省|市|县|镇|街道|市场|园区)$/u;

function profile(customer) {
  const labels = customerNames(customer).map(value => {
    const parts = customerNameParts(value);
    const forms = customerNameForms(parts);
    return { parts, forms, key: forms[0] };
  });
  return { customer, labels };
}

function sharedContext(key, profiles) {
  if (key.length < 2) return false;
  let owners = 0;
  let extended = false;
  const includesContext = label => label.key.startsWith(key) || label.parts.includes(key);
  for (const person of profiles) {
    if (!person.labels.some(includesContext)) continue;
    owners++;
    extended ||= person.labels.some(label => includesContext(label) && label.key !== key);
    if (extended && owners >= 2) return true;
  }
  return false;
}

function contextKind(key, profiles) {
  if (transportEnd.test(key)) return 'transport';
  if (localityEnd.test(key) || sharedContext(key, profiles)) return 'place';
  return '';
}

function splitContext(parts, profiles) {
  if (parts.length === 2) {
    const first = contextKind(parts[0], profiles);
    const second = contextKind(parts[1], profiles);
    if (first === 'transport' && second !== 'transport') return { kind: first, recipient: parts[1] };
    if (second === 'transport' && first !== 'transport') return { kind: second, recipient: parts[0] };
    if (first && !second) return { kind: first, recipient: parts[1] };
    if (second && !first) return { kind: second, recipient: parts[0] };
  }
  if (parts.length === 1) {
    const transport = parts[0].match(transportPrefix);
    if (transport) return { kind: 'transport', recipient: transport[2] };
    // A known standalone location may be glued to the start of the recipient.
    const prefixes = new Set();
    for (const person of profiles) for (const label of person.labels) {
      if (label.key.length >= 2 && label.key !== parts[0] && parts[0].startsWith(label.key)) prefixes.add(label.key);
    }
    for (const prefix of [...prefixes].sort((a,b) => b.length - a.length)) {
      if (sharedContext(prefix, profiles)) return { kind: 'place', recipient: parts[0].slice(prefix.length) };
    }
  }
  return null;
}

function wholeMatches(name, parts, profiles) {
  const exact = profiles.filter(person => person.customer.name === name);
  if (exact.length) return exact;
  const input = customerNameForms(parts);
  const normalized = [];
  const aliases = [];
  const contextual = [];
  for (const person of profiles) {
    const [canonical, ...other] = person.labels;
    if (!canonical) continue;
    if (canonical.key === input[0]) normalized.push(person);
    else if (matchesCustomerForms(input, canonical.forms)) contextual.push(person);
    if (other.some(label => matchesCustomerForms(input, label.forms))) aliases.push(person);
  }
  return [...new Set([...(normalized.length ? normalized : contextual), ...aliases])];
}

function namesRecipient(label, recipient) {
  if (label.key === recipient) return true;
  if (label.parts.length === 2 && label.parts.includes(recipient)) {
    return label.parts.some(part => part !== recipient && transportEnd.test(part));
  }
  return label.key.match(transportPrefix)?.[2] === recipient;
}

function confidentMatches(name, parts, profiles) {
  const input = joinedCustomerName(parts);
  const whole = wholeMatches(name, parts, profiles);
  if (whole.length === 1) {
    // Even an explicitly remembered alias is only a suggestion if other shops
    // use it as a route or location. The full shop name still selects the shop.
    const isAlias = whole[0].labels[0].key !== input;
    const standalone = parts.length === 1 || whole[0].labels.some(label => label.parts.length === 1 && label.key === input);
    if (bareService.test(input) || (isAlias && standalone && sharedContext(input, profiles))) return [];
  }
  if (whole.length) return whole;
  const context = splitContext(parts, profiles);
  if (context?.kind !== 'transport') return [];
  const recipient = context.recipient;
  if (recipient.length < 2 || !/^\p{L}+$/u.test(recipient) || localityEnd.test(recipient) ||
      /^(?:\p{L})(?:总|哥|姐|老板|师傅|经理)$/u.test(recipient)) return [];
  // A complete recipient seen on a different truck may travel on this one too.
  // Likewise look for a second card that names the person with another address.
  const possible = profiles.filter(person => person.labels.some(label => label.key.includes(recipient)));
  if (possible.length !== 1) return [];
  return possible[0].labels.some(label => namesRecipient(label, recipient)) ? possible : [];
}

export function matchingCustomers(name, customers = []) {
  const parts = customerNameParts(name);
  if (!parts.length) return [];
  return confidentMatches(name, parts, customers.map(profile)).map(person => person.customer);
}

export function findCustomer(name, customers = []) {
  const matches = matchingCustomers(name, customers);
  return matches.length === 1 ? matches[0] : null;
}

// Only suggestions use typo tolerance. One missing, different, or transposed character
// can be a different person; the order must never be assigned based on that alone.
function oneNameEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let index = 0;
  while (index < a.length && a[index] === b[index]) index++;
  if (a.length > b.length) return a.slice(index + 1) === b.slice(index);
  if (b.length > a.length) return a.slice(index) === b.slice(index + 1);
  return a.slice(index + 1) === b.slice(index + 1) ||
    (a[index] === b[index + 1] && a[index + 1] === b[index] && a.slice(index + 2) === b.slice(index + 2));
}

function customerSuggestionScore(input, candidate) {
  const short = Math.min(input.length, candidate.length);
  const long = Math.max(input.length, candidate.length);
  if (short < 2) return 0;
  if (input === candidate) return 100;
  if (input.includes(candidate) || candidate.includes(input)) return 60 + 30 * short / long;
  if (short >= 3 && oneNameEdit(input, candidate)) return 75;
  if (short >= 4 && short === long) {
    // No separator tells us which part is the location; offer both orders for review.
    const cut = (candidate + candidate).indexOf(input, 1);
    if (cut >= 2 && cut <= short - 2) return 85;
  }
  return 0;
}

function recipientSuggestionScore(label, recipient) {
  if (recipient.length < 2) return 0;
  if (namesRecipient(label, recipient)) return 150;
  if (label.key.includes(recipient)) return 115;
  if (recipient.length < 3 || /(?:师傅|老板|经理)$/u.test(recipient)) return 0;
  const alternatives = [label.key, ...label.parts, label.key.match(transportPrefix)?.[2]];
  return alternatives.some(word => word && word.length >= 3 &&
    !transportEnd.test(word) && !localityEnd.test(word) && oneNameEdit(recipient, word)) ? 75 : 0;
}

export function suggestedCustomers(name, customers = []) {
  const parts = customerNameParts(name);
  if (!parts.length) return [];
  const profiles = customers.map(profile);
  const strong = confidentMatches(name, parts, profiles).map(person => person.customer);
  const context = splitContext(parts, profiles);
  const inputs = customerNameForms(parts).flatMap(key => [key, key.replace(stallAddress, '')]);
  const fragments = parts.length > 1 ? [...new Set(parts.filter(part => part.length >= 2 && /\p{L}/u.test(part)))] : [];
  const frequency = new Map();
  const suggestions = [];
  for (const { customer, labels } of profiles) {
    if (strong.includes(customer)) continue;
    let score = 0;
    const matched = new Set();
    for (const label of labels) {
      // When the message actually names a recipient, the route alone provides
      // no reason to suggest the previous passenger on that same truck.
      if (context) {
        score = Math.max(score, recipientSuggestionScore(label, context.recipient));
        continue;
      }
      for (const form of label.forms) {
        const base = form.replace(stallAddress, '');
        for (const part of fragments) {
          if (base.includes(part)) matched.add(part);
        }
        for (const input of inputs) {
          score = Math.max(score, customerSuggestionScore(input, form), customerSuggestionScore(input, base));
        }
      }
    }
    if (score || matched.size) suggestions.push({ customer, score, matched });
    for (const part of matched) frequency.set(part, (frequency.get(part) || 0) + 1);
  }
  // A shared name can identify useful choices even when the delivery route changed.
  // Let a rare fragment outrank a locality repeated across many customers.
  for (const item of suggestions) {
    if (!item.matched.size) continue;
    let fragmentScore = 40 + 8 * Math.min(2, item.matched.size);
    for (const part of item.matched) fragmentScore += Math.min(4, part.length) * 3 / Math.sqrt(frequency.get(part));
    item.score = Math.max(item.score, fragmentScore);
  }
  suggestions.sort((a, b) => b.score - a.score);
  return [...strong, ...suggestions.slice(0, Math.max(0, 8 - strong.length)).map(item => item.customer)];
}

export function isCustomerStallHeading(name) {
  return stallAddress.test(joinedCustomerName(customerNameParts(name)));
}
