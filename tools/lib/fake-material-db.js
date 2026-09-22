'use strict';
function fakeDb(seed) {
  let state = structuredClone(seed), failCollection = '', tail = Promise.resolve();
  function collection(data, name) {
    data[name] ||= {};
    let filter = {}, offset = 0, limit = 100;
    const query = {
      doc(key) { return {
        async get() { return { data: data[name][key] ? [{ ...data[name][key], _id: key }] : [] }; },
        async set(record) { if (name === failCollection) throw new Error('injected failure'); data[name][key] = structuredClone(record); },
        async update(record) { if (name === failCollection) throw new Error('injected failure'); data[name][key] = { ...data[name][key], ...structuredClone(record) }; }
      }; },
      where(value) { filter = value; return query; }, orderBy() { return query; },
      skip(value) { offset = value; return query; }, limit(value) { limit = value; return query; },
      async get() { return { data: Object.entries(data[name]).sort().map(([key,v]) => ({ ...v, _id: key }))
        .filter(v => Object.entries(filter).every(([k,x]) => v[k] === x)).slice(offset, offset + limit) }; }
    };
    return query;
  }
  return {
    collection: name => collection(state, name), serverDate: () => '2026-09-05T00:00:00Z',
    async createCollection(name) { state[name] ||= {}; },
    runTransaction(handler) {
      const result = tail.then(async () => { const draft = structuredClone(state); const result = await handler({ collection: name => collection(draft,name) }); state = draft; return result; });
      tail = result.catch(() => {}); return result;
    },
    data: () => state, failOn: name => { failCollection = name; }
  };
}

module.exports={fakeDb};
