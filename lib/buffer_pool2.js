const EventEmitter = require( 'events' ).EventEmitter;
const shortId = require( './short_id' );
const measured = require( 'measured' );
const hrtime = require( './hrtime' );
const refCount = require( './ref_count' );

function _nop() {}

class BufferPool extends EventEmitter {

  constructor( opts = {} ) {
    super();

    this._id = shortId();
    this._size = opts.size || 64 * 1024 * 1024;
    this._capacity = opts.capacity || 100;
    this._freeBuffers = {};
    this._usedBuffers = {};
    this.count = 0;
    this.nextId = 0;
    this._stats = measured.createCollection();
  }

  get stats() {
    return this._stats.toJSON();
  }

  get size() {
    return this._size;
  }

  set size( v ) {
    throw new Error( "Size must be set in constructor" );
  }

  get capacity() {
    return this._capacity;
  }

  set capacity( v ) {
    if ( v < this.count ) {
      throw new Error( "Can't reduce capacity below allocated" );
    }
    this._capacity = v;
  }

  get numAvailable() {
    return Object.keys( this._freeBuffers ).length;
  }

  get numUsed() {
    return Object.keys( this._usedBuffers ).length;
  }

  get available() {
    return Object.values( this._freeBuffers );
  }

  getBuffer( opts, cb ) {
    this._stats.meter( 'getBuffer' ).mark();
    let self = this;

    if ( typeof opts === 'function' ) {
      cb = opts;
      opts = {};
    }

    let size = opts.size || this.size;
    let timeout = opts.timeout === undefined ? Infinity : opts.timeout;

    if ( typeof timeout !== 'number' || timeout < 0 ) {
      throw new Error( 'timeout must be a number >= 0' )
    }

    if ( typeof size !== 'number' || size <= 0 ) {
      throw new Error( 'size must be a positive integer' )
    }

    if ( typeof cb !== 'function' ) {
      throw new Error( 'callback must be a function' );
    }

    let _cb = ( buf ) => setImmediate( cb, buf );

    // smaller than our size, return a dummy buffer
    // or no free buffers and not yet at capacity, so alloc a new pooled buffer
    if ( size < this.size || (!this.numAvailable && this.count < this.capacity ) ) {
      return _cb( this._actuallyAlloc( size ) );
    }

    // if we have buffers, return most recently released buffer
    if ( this.numAvailable ) {
      return _cb( this._getFreeBuffer() );
    }

    // no buffer so far,
    // if no timeout specified, invoke callback immediately
    if ( timeout === 0 ) {
      return _cb( null );
    }

    let timer = null;
    let clearTimer = () => {
      if ( timer ) {
        clearTimeout( timer );
        timer = null;
      }
    };

    // listen for 'free' events and try grabbing a buffer
    // in case we don't get a buffer in case another listener
    // grabbed the last one, queue up another listener
    // until we get one, or a timeout kicks in and kills us
    let listener = () => self.getBuffer( ( buf ) => {
      if ( buf ) {
        clearTimer();
        return _cb( buf );
      }
      process.nextTick( () => self.once( 'free', listener ) )
    }, 0 );

    // actually listen for a free buffer
    this.once( 'free', listener );

    // if we timeout, remove the free listener and emit an error
    if ( timeout !== Math.Infinity ) {
      timer = setTimeout( () => {
        self.removeListener( 'once', listener );
        self.emit( 'error', new Error( 'timeout waiting for buffer in getBuffer()' ) );
      }, timeout );
    }
  }

  _actuallyAlloc( size ) {
    let self = this;
    let buf = Buffer.allocUnsafe( size );
    buf.dummy = size < this.size;
    buf.id = `${this._id}${this.nextId++}`;
    buf.refCount = 0;

    if ( buf.dummy ) {
      this._stats.meter( 'alloc_dummy' ).mark();
      buf.ref = buf.unref = _nop;
    }
    else {
      this._stats.meter( 'alloc_pool' ).mark();
      buf.ref = () => buf.refCount++;
      buf.unref = () => {
        if ( buf.refCount > 0 ) {
          buf.refCount--;
          if ( buf.refCount === 0 ) {
            setImmediate( self._releaseBuffer.bind( self, buf ) );
          }
        }
      };
      this._freeBuffers[buf.id] = buf;
      this.count++;
      this._useBuffer( buf );
      this.emit( 'allocate' );
    }
    return buf;
  }

  purgeBuffer( buf ) {
    if ( !this._freeBuffers[buf.id] ) {
      throw new Error( 'Buffer is not free/available' );
    }
    delete this._freeBuffers[buf.id];
  }

  lastUsed( time ) {
    let now = hrtime()
    return this.available.filter( ( x ) => now - x.lastUsed > time * 1e9 );
  }

  _releaseBuffer( buf ) {
    if ( !buf.dummy && !(this._usedBuffers[buf.id] ||
                         this._freeBuffers[buf.id] ) ) {
      return this.emit( 'error', 'Can\'t release buffer that\'s not ours.' )
    }
    this._freeBuffer( buf );
  }

  _freeBuffer( buf ) {
    this._stats.meter( 'buffer_free' ).mark();
    buf.refCount = 0;
    if ( !buf.dummy ) {
      delete this._usedBuffers[buf.id];
      this._freeBuffers[buf.id] = buf;
      buf.refCount = 0;
      buf.lastUsed = hrtime();
      this.emit( 'free' );
    }
  }

  _getFreeBuffer() {
    let bufs = this.available;
    if ( bufs.length ) {
      return this._useBuffer( bufs[bufs.length - 1] );
    }
  }

  _useBuffer( buf ) {
    this._stats.meter( 'buffer_use' ).mark();
    if ( !buf.dummy ) {
      delete this._freeBuffers[buf.id];
      this._usedBuffers[buf.id] = buf;
    }
    buf.ref();
    return buf;
  }
}

module.exports = BufferPool;

