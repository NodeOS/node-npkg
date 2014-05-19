var fs = require('fs');

// try to load a file, and parse it into an object
// if that fails, just return an empty object
// this shouldn't throw an error
// it's a big boy, it deals with it's own problems
module.exports = function graceful(file) {
  var config;
  try {
    config = JSON.parse(
      fs.readFileSync(file, 'utf-8')
    );
  } catch (e) {
    // default empty config
    config = {};
  }
  return config;
}
