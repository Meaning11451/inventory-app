// A retry of an unchanged save reuses its record IDs, including restored batches.
export function createSaveIntents(initial = []) {
  const intents = new Map();
  const withoutIds = records => records.map(({id, ...row}) => row);
  const withoutDates = rows => rows.map(({recorded_at, ...row}) => row);
  for (const entry of Array.isArray(initial) ? initial : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [scope, intent] = entry;
    if (typeof scope !== 'string' || !Array.isArray(intent?.records) || !intent.records.length) continue;
    if (!intent.records.every(row => row && typeof row.id === 'string' && /^[0-9a-f-]{36}$/i.test(row.id))) continue;
    if (intent.signature !== JSON.stringify(withoutIds(intent.records))) continue;
    intents.set(scope, { signature: intent.signature, records: intent.records.map(row=>({...row})) });
  }
  return {
    records(scope, rows, { preserveDate = false } = {}) {
      const signature = JSON.stringify(rows);
      let intent = intents.get(scope);
      const sameBatch = intent && preserveDate &&
        JSON.stringify(withoutDates(withoutIds(intent.records))) === JSON.stringify(withoutDates(rows));
      if (!intent || (intent.signature !== signature && !sameBatch)) {
        intent = {signature,records:rows.map(row=>({...row,id:crypto.randomUUID()}))};
        intents.set(scope,intent);
      }
      return intent.records.map(row=>({...row}));
    },
    complete(scope) { intents.delete(scope); },
    snapshot(scopes) {
      return [...intents].filter(([scope])=>scopes.includes(scope)).map(([scope,intent])=>
        [scope, { signature: intent.signature, records: intent.records.map(row=>({...row})) }]);
    }
  };
}
