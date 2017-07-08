module.exports = () => {
  let hr = process.hrtime();
  return hr[0] * 1e9 + hr[1];
}
