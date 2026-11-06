// A retry of an unchanged save reuses its record IDs for this page session.
export function createSaveIntents() {
  const intents = new Map();
  return {
    records(scope, rows) {
      const signature = JSON.stringify(rows);
      let intent = intents.get(scope);
      if (!intent || intent.signature !== signature) {
        intent = {signature,records:rows.map(row=>({...row,id:crypto.randomUUID()}))};
        intents.set(scope,intent);
      }
      return intent.records.map(row=>({...row}));
    },
    complete(scope) { intents.delete(scope); }
  };
}
