var Readable = require('stream').Readable;
var util = require('util');

function List(list, opts) {
  Readable.call(this, opts);
  this.list   = list;
  this.index  = 0;
}

util.inherits(List, Readable);

List.prototype._read = function() {
  var line, item;

  do {
    item = this.list[this.index++];
    
    if (item) line = item + "\n";
    else      break;

  } while (this.push(line));

  this.push(null);
};

module.exports = function (obj) {
  return new List(obj);
};
