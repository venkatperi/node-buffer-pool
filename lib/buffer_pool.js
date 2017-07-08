const assert = require( 'assert' );
const EventEmitter = require( 'events' ).EventEmitter;
const measured = require( 'measured' );
const refCount = require( './ref_count' );
const genericPool = require( 'generic-pool' );

function getFactory( pool ) {
  return {
    create : () => {
      pool._stats.meter('create').mark();
      let buf = Buffer.allocUnsafe( pool.bufferSize );
      refCount( buf, () => pool._releaseBuffer( buf ) );
      return buf;
    },

    destroy : ( buf ) => {
      pool._stats.meter('destroy').mark();
    }
  }
}
const props = ['spareResourceCapacity', 'size', 'available', 'borrowed', 'pending', 'max', 'min'];

class BufferPool extends EventEmitter {

  constructor( opts ) {
    super();

    opts = opts || {};
    opts.max = opts.max || 100;

    this._bufferSize = opts.bufferSize || 64 * 1024;
    delete opts.bufferSize;

    this._pool = genericPool.createPool( getFactory( this ), opts );
    this._stats = measured.createCollection();

    //pass through pool properties
    let self = this;
    props.forEach( ( p ) => Object.defineProperty( this, p, {get : () => self._pool[p]} ) );
  }

  get stats() {
    return this._stats.toJSON();
  }

  get bufferSize() {
    return this._bufferSize;
  }

  set bufferSize( v ) {
    throw new Error( "Buffer size must be set in constructor" );
  }

  getBuffer( size, opts ) {
    if ( typeof size === 'object' ) {
      opts = size;
      size = undefined;
    }

    opts = opts || {};

    size = typeof size === 'undefined' ? this._bufferSize : size;

    if ( typeof size !== 'number' ) {
      throw new Error( 'size must be a positive number' );
    }

    return size < this._bufferSize
        ? this._getDummyBuffer( size )
        : this._getPoolBuffer( opts.priority );
  }

  drain() {
    return this._pool.drain();
  }

  _getPoolBuffer( priority ) {
    this._stats.meter('get:pool').mark();
    return this._pool.acquire( priority ).then( ( buf ) => {
      buf._ref();
      return buf;
    } );
  }

  _getDummyBuffer( size ) {
    this._stats.meter('get:dummy').mark();
    return Promise.resolve( Buffer.allocUnsafe( size ) );
  }

  _releaseBuffer( buf ) {
    this._stats.meter('release').mark();
    return this._pool.release( buf );
  }
}

module.exports = BufferPool;

