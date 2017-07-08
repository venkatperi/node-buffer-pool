module.exports = function ( obj, release ) {
  if ( obj._refCount || obj._ref || obj._unref ) {
    throw new Error( "Already refCount enabled or name clash?" );
  }

  obj._refCount = 0;
  obj._ref = () => obj._refCount++;
  obj._refRelease = release ? release : () => {};
  obj._unref = () => {
    if ( obj._refCount > 0 ) {
      obj._refCount--;
      if ( obj._refCount === 0 ) {
        obj._refRelease( obj );
      }
    }
  };
}