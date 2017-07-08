const crypto = require( 'crypto' );

module.exports = function shortId() {
  return crypto.randomBytes( 12 ).toString( "base64" );
}
