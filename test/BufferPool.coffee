assert = require( 'assert' )
BufferPool = require( '..' )
Q = require 'q'

size = 16 * 1024 * 1024
pool = undefined

maxItOut = ( cb ) ->
  bufs = []
  next = ->
    pool.getBuffer( ).then ( buf ) ->
      bufs.push buf
      return process.nextTick next if (pool.count < pool.capacity)
      cb( buf, bufs )

  next( )

describe 'BufferPool', ->

  beforeEach ->
    pool = new BufferPool( )

  it 'defaults', ->
    assert pool.size is 0
    assert pool.available is 0
    assert pool.borrowed is 0
    assert pool.max is 100
    assert pool.min is 0

  it "can't change buffer size", ->
    x = -> pool.bufferSize = 100
    assert.throws x, Error

  it 'has stats', ->
    assert pool.stats isnt undefined

  describe 'dummy buffer', ->
    it 'is plain old Buffer', ->
      size = pool.bufferSize / 2
      pool.getBuffer( size ).then ( buf ) ->
        assert buf.length is size
        assert buf._unref is undefined
        assert pool.available is 0
        assert pool.borrowed is 0
        assert pool.size is 0

  describe 'pooled buffer', ->
    it 'default size is pool size', ( ) ->
      pool.getBuffer( ).then ( buf ) ->
        assert buf.length is pool.bufferSize

    it 'allocate', ( ) ->
      pool.getBuffer( ).then ( buf ) ->
        assert buf._unref isnt undefined
        assert buf._ref isnt undefined
        assert buf._refCount is 1
        assert pool.available is 0
        assert pool.borrowed is 1
        assert pool.size is 1
        stats = pool.stats
        assert stats['create'].count is 1
        assert stats['get:pool'].count is 1
        assert stats['release'] is undefined

    it 'release', ( ) ->
      verify = ->
        assert pool.available is 1
        assert pool.borrowed is 0
        assert pool.size is 1
        stats = pool.stats
        assert stats['create'].count is 1
        assert stats['get:pool'].count is 1
        assert stats['release'].count is 1

      pool.getBuffer( )
        .then ( buf ) -> buf._unref( )
        .then verify

