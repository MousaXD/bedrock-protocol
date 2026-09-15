const assert = require('assert')
const getRaknet = require('../src/rak')

describe('RakNet backend selection', () => {
  it('supports the pure JavaScript backend explicitly', () => {
    const backend = getRaknet('jsp-raknet')
    assert.equal(typeof backend.RakClient, 'function')
  })

  it('supports automatic backend selection', () => {
    const backend = getRaknet('auto')
    assert.equal(typeof backend.RakClient, 'function')
  })

  it('rejects unknown backend names', () => {
    assert.throws(() => getRaknet('definitely-not-a-backend'), /Unknown RakNet backend/)
  })
})
