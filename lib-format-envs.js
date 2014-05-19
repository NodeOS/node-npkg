var Readable = require('stream').Readable;
var util = require('util');

function Env(obj, opts) {
  Readable.call(this, opts);
  this.obj  = obj;
  this.keys = Object.keys(obj);
}

util.inherits(Env, Readable);

Env.prototype._read = function() {
  var line, key;

  do {
    key  = this.keys.pop();
    
    if (key) line = util.format("%s=%s\n", key, this.obj[key]);
    else     break;

  } while (this.push(line));

  this.push(null);
};

module.exports = function (obj) {
  return new Env(obj);
};
